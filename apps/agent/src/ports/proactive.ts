// Puerto de TURNOS PROACTIVOS (Nivel C): el seam que deja a Vaio RETOMAR solo tras una tarea en background.
// Un action dispara una tarea larga y la registra acá; al COMPLETAR, el adapter del canal re-entra el loop del
// agente con la duda original y entrega la respuesta INICIADA por el agente (Telegram-first; el web no puede push
// tras cerrar el turno → null). El core depende de este puerto; la re-entrada/push vive en el adapter (Inv #4).
// Ver docs/superpowers/specs/2026-06-16-proactive-turns-design.md.

import type { Channel } from "@vaio/contracts"

export interface ProactiveResume {
  /** Registra una tarea en background; al COMPLETAR re-entra el loop con la duda original y entrega la respuesta
   *  por el canal. best-effort: NO bloquea el turno actual, NUNCA tira (Inv #1). Canal sin push (web) → null
   *  (el llamador usa `?.` → no-op). `label` = solo para observabilidad. */
  resume(task: Promise<unknown>, opts?: { label?: string }): void
}

/** Insumo para re-entrar el loop en una conversación ARBITRARIA (no la del turno vivo): la del visitante que
 *  escaló. Generaliza `ProactiveResume` para `escalate` — cuando Kevin responde (otro chat, días después), Vaio
 *  retoma al visitante en SU hilo con la respuesta de Kevin inyectada. */
export interface ResumeConversationInput {
  /** Conversación origen (la del visitante) a retomar — la MISMA conversationKey con que se persistió. */
  conversationKey: string
  channel: Channel
  locale?: string
  /** Lo que el visitante había preguntado (para encuadrar el turno sintético). */
  originalQuestion: string
  /** El insumo nuevo a transmitir (la respuesta de Kevin/owner). */
  injectedAnswer: string
  /** Routing del canal (Telegram: chatId/threadId del visitante). Sin chatId (web) → no-op limpio. */
  routing?: { chatId?: number; threadId?: number }
}

/** Re-entra el loop del agente en una conversación CONCRETA (la del visitante origen), inyectando un insumo
 *  nuevo (la respuesta de Kevin) y entregando el resultado a SU hilo. best-effort, no tira; web → no-op.
 *  Complementa a ProactiveResume (ése cierra sobre el turno actual; éste apunta a otra conversación).
 *  Devuelve si la respuesta LLEGÓ de verdad al visitante (`delivered`) → el llamador confirma honesto al owner
 *  ("se lo transmití" solo si fue real). `delivered:false` = canal sin push (web) o el envío falló. */
export interface ConversationResumer {
  resumeConversation(
    input: ResumeConversationInput
  ): Promise<{ delivered: boolean }>
}
