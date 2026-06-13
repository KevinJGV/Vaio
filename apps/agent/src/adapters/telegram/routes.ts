// Canal Telegram (adapter de entrada): webhook POST /tg. Boundary de auth = el secret_token del
// header (NO el x-agent-key del canal web). Filtra por allowlist, deduplica por update_id, ACKea 200
// rápido y procesa el turno en BACKGROUND (Telegram reintenta ante respuestas lentas/no-2xx). La
// entrega es no-streaming: drena `text` del core y manda el mensaje (troceado a 4096).

import { randomUUID } from "node:crypto"
import type { TurnRequest } from "@vaio/contracts"
import type { Hono } from "hono"
import { type Agent, courtesy } from "../../core/agent.js"
import type { Logger } from "../../ports/logger.js"
import type { TraceSink } from "../../ports/trace.js"
import type { Variables } from "../http/types.js"
import type { TelegramClient } from "./client.js"
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
}

type Turn = Extract<NormalizeResult, { kind: "turn" }>
const DEDUPE_CAP = 1000

export function mountTelegram(
  app: Hono<{ Variables: Variables }>,
  deps: TelegramDeps
): void {
  const seen = new Set<number>() // dedupe de update_id (in-memory; seam a persistir)

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
      const req: TurnRequest = {
        channel: "telegram",
        // 1 topic = 1 conversación (su propia ventana de contexto); DM plano = clave por chat.
        conversationKey: conversationKeyFor(norm.chatId, norm.threadId),
        userText: norm.text,
        locale: norm.locale,
        principalId: String(norm.fromId),
        // Sólo el owner (Kevin) es de confianza → perfil pleno; el resto = visitante capado.
        trusted: isOwnerId(deps.ownerId, norm.fromId),
      }
      const { text } = await deps.agent.respond(req, {
        logger: log,
        sink: deps.sink,
        requestId,
      })
      await deps.client.sendMessage(norm.chatId, await text, send)
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
    } catch {
      return c.json({ ok: true }) // ack: update inválido, no reintentar
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
    // ACK rápido + trabajo en background (Telegram reintenta si tardamos).
    void handleTurn(norm, c.get("requestId") ?? randomUUID(), c.get("log"))
    return c.json({ ok: true })
  })
}
