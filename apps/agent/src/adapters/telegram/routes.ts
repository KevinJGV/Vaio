// Canal Telegram (adapter de entrada): webhook POST /tg. Boundary de auth = el secret_token del
// header (NO el x-agent-key del canal web). Filtra por allowlist, deduplica por update_id, ACKea 200
// rápido y procesa el turno en BACKGROUND (Telegram reintenta ante respuestas lentas/no-2xx). La
// entrega es no-streaming: drena `text` del core y manda el mensaje (troceado a 4096).

import { randomUUID } from "node:crypto"
import type { InputAttachment, TurnRequest } from "@vaio/contracts"
import type { Hono } from "hono"
import { type Agent, courtesy } from "../../core/agent.js"
import { shouldSpeak, stripForSpeech } from "../../core/speech-policy.js"
import type { Logger } from "../../ports/logger.js"
import type { ResolvedMedia } from "../../ports/media.js"
import type { SpeechSynthesizer } from "../../ports/speech.js"
import type { TraceSink } from "../../ports/trace.js"
import type { Variables } from "../http/types.js"
import type { TelegramClient } from "./client.js"
import type { TelegramMedia } from "./media.js"
import {
  conversationKeyFor,
  isOwnerId,
  type NormalizeResult,
  normalizeUpdate,
} from "./normalize.js"

export interface TelegramDeps {
  /** null → el agente degrada a cortesía (sin OpenRouter configurado). */
  agent: Agent | null
  client: TelegramClient
  allowedIds: Set<number>
  webhookSecret: string
  /** Id de Telegram de Kevin (owner). Solo ese id resuelve a `trusted` (perfil pleno). */
  ownerId?: number
  sink: TraceSink
  /** Descarga de media (audio/voz + imágenes). undefined = sin multimodal → se ignoran adjuntos. */
  media?: TelegramMedia
  /** Síntesis de voz (TTS). undefined = Vaio solo responde por texto. */
  speech?: SpeechSynthesizer
}

type Turn = Extract<NormalizeResult, { kind: "turn" }>
type Unsupported = Extract<NormalizeResult, { kind: "unsupported" }>
const DEDUPE_CAP = 1000

/** Mensaje cortés ante un media que aún no soportamos (doc/PDF/video). */
function unsupportedMessage(locale: "es" | "en"): string {
  return locale === "en"
    ? "I can't handle that kind of file yet — I work with text, voice notes and images. Send me one of those? 🙏"
    : "Todavía no manejo ese tipo de archivo — trabajo con texto, notas de voz e imágenes. ¿Me mandás alguno de esos? 🙏"
}

export function mountTelegram(
  app: Hono<{ Variables: Variables }>,
  deps: TelegramDeps
): void {
  const seen = new Set<number>() // dedupe de update_id (in-memory; seam a persistir)

  const replyUnsupported = async (norm: Unsupported): Promise<void> => {
    const send: { messageThreadId?: number } = {
      messageThreadId: norm.threadId,
    }
    try {
      await deps.client.sendMessage(
        norm.chatId,
        unsupportedMessage(norm.locale),
        send
      )
    } catch {
      // si ni eso sale, ya está logueado aguas arriba; no rompemos el ACK.
    }
  }

  const handleTurn = async (
    norm: Turn,
    requestId: string,
    log: Logger
  ): Promise<void> => {
    // Responder dentro del topic/hilo del que vino el mensaje (si aplica).
    const send: { messageThreadId?: number } = {
      messageThreadId: norm.threadId,
    }
    try {
      await deps.client.sendChatAction(norm.chatId, "typing", send)
      if (!deps.agent) {
        await deps.client.sendMessage(norm.chatId, courtesy(norm.locale), send)
        return
      }
      // Bajar los adjuntos (I/O en el adapter). El que no se pueda bajar se descarta (degradación);
      // el core decide transcribir/describir o pasar nativo con los que sí llegaron.
      const resolved: ResolvedMedia[] = []
      for (const att of norm.attachments) {
        const r = deps.media ? await deps.media.download(att) : null
        if (r) resolved.push(r)
      }
      // Si traía media pero NADA se pudo bajar y no hay texto, no hay turno útil → cortesía.
      if (
        norm.attachments.length > 0 &&
        resolved.length === 0 &&
        norm.text === ""
      ) {
        await deps.client.sendMessage(norm.chatId, courtesy(norm.locale), send)
        return
      }
      const attachments: InputAttachment[] = resolved.map((r) => ({
        kind: r.kind,
        mediaType: r.mediaType,
        ref: r.ref,
      }))
      const req: TurnRequest = {
        channel: "telegram",
        // 1 topic = 1 conversación (su propia ventana de contexto); DM plano = clave por chat.
        conversationKey: conversationKeyFor(norm.chatId, norm.threadId),
        userText: norm.text,
        attachments,
        locale: norm.locale,
        principalId: String(norm.fromId),
        // Sólo el owner (Kevin) es de confianza → perfil pleno; el resto = visitante capado.
        trusted: isOwnerId(deps.ownerId, norm.fromId),
      }
      const { text } = await deps.agent.respond(
        req,
        { logger: log, sink: deps.sink, requestId },
        resolved
      )
      const reply = await text
      // Salida de voz (TTS): default texto; voz si entró voz (espejo) o el usuario la pidió.
      const wantsVoice =
        deps.speech != null &&
        shouldSpeak({
          inboundHadAudio: resolved.some((m) => m.kind === "audio"),
          userText: norm.text,
        })
      if (wantsVoice && deps.speech) {
        const spoken = await deps.speech.synthesize(
          stripForSpeech(reply),
          norm.locale
        )
        if (spoken) {
          const ok = await deps.client.sendAudio(norm.chatId, spoken.audio, {
            ...send,
            mediaType: spoken.mediaType,
          })
          if (ok) return
          // si el envío de audio falla, caemos a texto (nunca dejamos al usuario sin respuesta).
        }
      }
      await deps.client.sendMessage(norm.chatId, reply, send)
    } catch (err) {
      log.error(
        { err: err instanceof Error ? err.message : String(err) },
        "telegram handleTurn falló"
      )
      try {
        await deps.client.sendMessage(norm.chatId, courtesy(norm.locale), send)
      } catch {
        // si ni la cortesía sale, lo dejamos: ya logueamos el error original.
      }
    }
  }

  app.post("/tg", async (c) => {
    const secret = c.req.header("x-telegram-bot-api-secret-token")
    if (secret !== deps.webhookSecret) {
      return c.json({ error: "unauthorized" }, 401)
    }
    let update: unknown
    try {
      update = await c.req.json()
    } catch (err) {
      // Webhook con body no-JSON: antes era invisible. Dejamos rastro (y ACK para que Telegram no reintente).
      c.get("log")?.warn(
        { err: String(err) },
        "tg: update no-JSON (ack sin procesar)"
      )
      return c.json({ ok: true })
    }
    const norm = normalizeUpdate(update, deps.allowedIds)
    if (norm.kind === "ignore") {
      return c.json({ ok: true }) // no-text / sin from / no allowlisted → sin llamar al modelo
    }
    if (seen.has(norm.updateId)) {
      return c.json({ ok: true }) // duplicado (retry de Telegram)
    }
    seen.add(norm.updateId)
    if (seen.size > DEDUPE_CAP) {
      const oldest = seen.values().next().value
      if (oldest !== undefined) seen.delete(oldest)
    }
    if (norm.kind === "unsupported") {
      // Media no soportado (doc/PDF/video): respondemos cortés, no ignoramos en silencio.
      void replyUnsupported(norm)
      return c.json({ ok: true })
    }
    // ACK rápido + trabajo en background (Telegram reintenta si tardamos).
    void handleTurn(norm, c.get("requestId") ?? randomUUID(), c.get("log"))
    return c.json({ ok: true })
  })
}
