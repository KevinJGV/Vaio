// Adapter HTTP (canal de entrada): rutas Hono finas. El routing vive acá; la lógica en el core.
// Un middleware asigna un requestId por request y crea un child logger ({ requestId }) para
// correlacionar logs operativos (request.start/finish) con los eventos de traza del agente.
// Fase 2 sumará canales (Telegram/correo) como otros adapters sobre el mismo core.

import { randomUUID } from "node:crypto"
import {
  chatBodySchema,
  type InputAttachment,
  type TurnRequest,
} from "@vaio/contracts"
import { Hono } from "hono"
import { type Agent, courtesy } from "../../core/agent.js"
import type { Logger } from "../../ports/logger.js"
import type { ResolvedMedia } from "../../ports/media.js"
import type { TraceSink } from "../../ports/trace.js"
import { mountTelegram, type TelegramDeps } from "../telegram/routes.js"
import { agentAuth } from "./auth.js"
import type { Variables } from "./types.js"

export interface RouteDeps {
  agentApiKey: string | undefined
  /** null → /chat degrada a respuesta de cortesía (sin OpenRouter configurado). */
  agent: Agent | null
  logger: Logger
  sink: TraceSink
  /** Presente → se monta el webhook /tg del canal Telegram (ausente → no se monta). */
  telegram?: TelegramDeps
  /** Límite de tamaño por adjunto (base64 web). Default 20MB. */
  mediaMaxBytes?: number
}

export function buildApp({
  agentApiKey,
  agent,
  logger,
  sink,
  telegram,
  mediaMaxBytes = 20 * 1024 * 1024,
}: RouteDeps): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  // Correlación + logs de request/response para TODO el servicio. /health a debug (evita ruido
  // por los health-checks de Railway).
  app.use("*", async (c, next) => {
    const requestId = randomUUID()
    const log = logger.child({ requestId })
    c.set("requestId", requestId)
    c.set("log", log)
    const startedAt = Date.now()
    const health = c.req.path === "/health"
    const start = { method: c.req.method, path: c.req.path }
    if (health) log.debug(start, "request.start")
    else log.info(start, "request.start")
    await next()
    const fin = { status: c.res.status, durationMs: Date.now() - startedAt }
    if (health) log.debug(fin, "request.finish")
    else log.info(fin, "request.finish")
  })

  app.get("/health", (c) => c.json({ ok: true, service: "vaio" }))

  app.use("/chat", agentAuth(agentApiKey))

  // POST /chat  { messages: [{role, content}], locale?: "es"|"en", conversationId? }  → stream
  app.post("/chat", async (c) => {
    const log = c.get("log")
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid json" }, 400)
    }
    const parsed = chatBodySchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: "bad request" }, 400)
    }
    const locale = parsed.data.locale ?? "es"

    if (!agent) {
      return c.text(courtesy(locale), 200)
    }
    // El portafolio aún manda el historial completo; el core ahora lo persiste server-side, así
    // que tomamos solo el último mensaje del usuario y el resto lo reconstruye la memoria por
    // conversationKey. (Cuando se cablee el portafolio, el contrato se angosta a un solo mensaje.)
    const userText = parsed.data.messages.at(-1)?.content ?? ""
    // Adjuntos web: base64 inline → bytes. El que exceda el límite se descarta (degradación).
    const resolved: ResolvedMedia[] = []
    for (const a of parsed.data.attachments) {
      const buf = Buffer.from(a.dataBase64, "base64")
      if (buf.byteLength === 0 || buf.byteLength > mediaMaxBytes) {
        log.warn(
          { kind: a.kind, size: buf.byteLength },
          "web attachment descartado"
        )
        continue
      }
      resolved.push({
        kind: a.kind,
        mediaType: a.mediaType,
        ref: `web-inline:${randomUUID()}`,
        ...(a.caption ? { caption: a.caption } : {}),
        data: new Uint8Array(buf),
      })
    }
    if (!userText && resolved.length === 0) {
      return c.json({ error: "bad request" }, 400)
    }
    try {
      // El core arma el stream con degradación incluida (cortesía si el modelo falla) e
      // instrumenta el turno vía el sink (los eventos comparten requestId con estos logs).
      const attachments: InputAttachment[] = resolved.map((r) => ({
        kind: r.kind,
        mediaType: r.mediaType,
        ref: r.ref,
        ...(r.caption ? { caption: r.caption } : {}),
      }))
      const req: TurnRequest = {
        channel: "web",
        conversationKey: parsed.data.conversationId ?? randomUUID(),
        userText,
        attachments,
        locale,
        principalId: "web",
        trusted: false,
      }
      const ctx = { logger: log, sink, requestId: c.get("requestId") }
      const { stream } = await agent.respond(req, ctx, resolved)
      return new Response(stream, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      })
    } catch (err) {
      log.error(
        { err: err instanceof Error ? err.message : String(err) },
        "/chat setup error"
      )
      return c.text(courtesy(locale), 200)
    }
  })

  // Canal Telegram (webhook /tg) — solo si el wiring lo proveyó (token+secret+allowlist presentes).
  if (telegram) {
    mountTelegram(app, telegram)
  }

  return app
}
