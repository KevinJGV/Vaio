// Implementación Telegram del puerto ProactiveResume (turnos proactivos, Nivel C). Bindeada AL TURNO: cierra sobre
// el `req` original + chatId/threadId + el agente y el cliente. Cuando la tarea en background COMPLETA, re-entra el
// loop del agente con la duda original (turno sintético) y manda la respuesta INICIADA por el agente. El turno
// sintético lleva `resume: null` → guard ANTI-LOOP (un turno proactivo no dispara otro). best-effort: nunca tira,
// no bloquea el turno actual (Inv #1). Ver docs/superpowers/specs/2026-06-16-proactive-turns-design.md.

import type { TurnRequest } from "@vaio/contracts"
import type { Agent } from "../../core/agent.js"
import type { Logger } from "../../ports/logger.js"
import type { ProactiveResume } from "../../ports/proactive.js"
import type { TraceSink } from "../../ports/trace.js"
import type { TelegramClient } from "./client.js"

/** Prefijo del mensaje proactivo (corto; la respuesta del modelo sigue). */
function proactivePrefix(locale: string): string {
  return locale === "en" ? "✅ Done — " : "✅ Listo — "
}

export function createTelegramResume(deps: {
  agent: Agent
  client: TelegramClient
  logger: Logger
  sink: TraceSink
  /** El turno ORIGINAL (conversationKey/userText/locale/principalId/trusted): la duda a re-responder. */
  req: TurnRequest
  chatId: number
  threadId?: number
  /** Inyectable (randomUUID en prod; determinista en test). */
  newRequestId: () => string
}): ProactiveResume {
  const prefix = proactivePrefix(deps.req.locale ?? "es")
  const thread =
    deps.threadId !== undefined ? { messageThreadId: deps.threadId } : {}

  return {
    resume(task, opts) {
      const label = opts?.label ?? "tarea"
      // No bloquea el turno actual: el catch del completar vive fuera del hilo del turno.
      void task
        .then(async () => {
          deps.logger.info(
            { label, chatId: deps.chatId },
            "tg: turno proactivo (resume)"
          )
          // Turno SINTÉTICO: re-pregunta la duda original, ahora que la tarea terminó. `resume: null` = ANTI-LOOP.
          const synthetic: TurnRequest = { ...deps.req }
          const { text } = await deps.agent.respond(synthetic, {
            logger: deps.logger,
            sink: deps.sink,
            requestId: deps.newRequestId(),
            resume: null,
          })
          const answer = await text
          await deps.client.sendMessage(deps.chatId, prefix + answer, thread)
        })
        .catch((err) => {
          // best-effort: el turno original ya respondió "ya voy"; un fallo acá no rompe nada (Inv #1).
          deps.logger.warn(
            { label, err: err instanceof Error ? err.message : String(err) },
            "tg: turno proactivo (resume) falló"
          )
        })
    },
  }
}
