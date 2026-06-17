// Implementación Telegram del puerto ConversationResumer: retoma una conversación ARBITRARIA (la del visitante que
// escaló una duda), no la del turno actual. Cuando Kevin responde una escalada, el inbound llama acá: re-entra el
// loop del agente en la conversación ORIGEN (rehidrata sola por conversationKey vía ConversationStore), inyectando
// la respuesta de Kevin como nota del sistema, y entrega el resultado en la VOZ de Vaio al hilo del visitante.
// Anti-loop: el turno sintético corre con `resume: null` + `toolDenylist: ["escalate"]` (no re-escala). best-effort:
// nunca tira (Inv #1); web (sin chatId de routing) → no-op limpio. Ver 2026-06-16-escalate-owner-notifier-design.md.

import type { TurnRequest } from "@vaio/contracts"
import type { Agent } from "../../core/agent.js"
import type { Logger } from "../../ports/logger.js"
import type {
  ConversationResumer,
  ResumeConversationInput,
} from "../../ports/proactive.js"
import type { TraceSink } from "../../ports/trace.js"
import type { TelegramClient } from "./client.js"

/** Nota del sistema que encuadra el turno sintético: el modelo transmite la respuesta de Kevin en su voz, sin
 *  inventar ni mencionar el mecanismo interno. */
function framing(input: ResumeConversationInput): string {
  const locale = input.locale === "en" ? "en" : "es"
  return locale === "en"
    ? `[System note] Earlier the visitor asked: «${input.originalQuestion}». Kevin (the owner) answered: «${input.injectedAnswer}». Relay that answer to the visitor in YOUR voice, naturally and directly, without inventing anything beyond what Kevin said. Don't mention that you escalated or this internal mechanism.`
    : `[Nota del sistema] El visitante había preguntado: «${input.originalQuestion}». Kevin (el owner) respondió: «${input.injectedAnswer}». Transmitile esa respuesta al visitante en TU voz, natural y directa, sin inventar nada más allá de lo que Kevin dijo. No menciones que escalaste ni este mecanismo interno.`
}

export function createTelegramConversationResumer(deps: {
  agent: Agent
  client: TelegramClient
  logger: Logger
  sink: TraceSink
  /** Inyectable (randomUUID en prod; determinista en test). */
  newRequestId: () => string
}): ConversationResumer {
  return {
    async resumeConversation(input) {
      const chatId = input.routing?.chatId
      // Web (sin push) → no-op limpio: el cierre va por el fact (la próxima consulta lo recupera).
      if (chatId === undefined) {
        deps.logger.info(
          { channel: input.channel },
          "resumeConversation: sin push (web) → no-op"
        )
        return { delivered: false }
      }
      const thread =
        input.routing?.threadId !== undefined
          ? { messageThreadId: input.routing.threadId }
          : {}
      try {
        deps.logger.info(
          { channel: input.channel, chatId },
          "tg: retomo cross-conversation (escalada respondida)"
        )
        // Turno SINTÉTICO dirigido a la conversación del VISITANTE (rehidrata por conversationKey). Actor sintético
        // (no es el visitante ni Kevin), perfil visitante (trusted:false). Anti-loop: resume:null + denylist escalate.
        const synthetic: TurnRequest = {
          channel: input.channel,
          conversationKey: input.conversationKey,
          userText: framing(input),
          attachments: [],
          locale: input.locale === "en" ? "en" : "es",
          principalId: "system:escalate-resume",
          trusted: false,
        }
        const { text } = await deps.agent.respond(synthetic, {
          logger: deps.logger,
          sink: deps.sink,
          requestId: deps.newRequestId(),
          resume: null,
          toolDenylist: ["escalate"],
        })
        const answer = await text
        // `delivered` = el mensaje LLEGÓ de verdad (message_id presente) → el inbound confirma honesto al owner.
        const messageId = await deps.client.sendMessage(chatId, answer, thread)
        return { delivered: messageId !== undefined }
      } catch (err) {
        // best-effort (Inv #1): un fallo acá no rompe nada; reportamos no-entregado para no mentirle al owner.
        deps.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "tg: retomo cross-conversation falló"
        )
        return { delivered: false }
      }
    },
  }
}
