// Puerto de la MEMORIA CONVERSACIONAL (memoria de producto, distinta de la traza de dev).
// El core depende de esta interfaz; el adapter concreto es Drizzle+Neon (adapters/neon-conversation.ts).
// Diseñado para que el core cargue el historial server-side por (channel, threadKey) — el canal NO
// manda todo el historial (Telegram solo trae el último mensaje). Los tipos son INTERNOS al agente
// (forma de persistencia), no parte del contrato wire de @vaio/contracts.

import type { Channel, Usage } from "@vaio/contracts"

export type { Channel }

/** Un mensaje persistido de una conversación (el resumen vive en la conversación, no acá). */
export interface StoredMessage {
  role: "user" | "assistant"
  content: string
}

/** Contexto cargado server-side para construir un turno. */
export interface ConversationContext {
  /** Id interno estable de la conversación. */
  conversationId: string
  /** Resumen rodante de los turnos viejos ("" si no hay). Va al system prompt. */
  summary: string
  /** Últimos K mensajes en orden cronológico (ya recortados). Van como model messages. */
  recent: StoredMessage[]
  /** Total de mensajes (user+assistant) acumulados → dispara el threshold de resumen. */
  messageCount: number
}

/** Lo que se persiste al cerrar un turno (un par user→assistant + uso de tokens). */
export interface TurnRecord {
  user: string
  assistant: string
  usage?: Usage
}

/** Store de conversaciones: historial persistido + resumen rodante. */
export interface ConversationStore {
  /** getOrCreate por (channel, threadKey). Devuelve el id interno estable. */
  ensure(channel: Channel, threadKey: string, locale: string): Promise<string>
  /** Carga summary + últimos `recentLimit` mensajes (cronológico) + total acumulado. */
  loadContext(
    conversationId: string,
    recentLimit: number
  ): Promise<ConversationContext>
  /** Persiste user+assistant del turno y la usage; idempotente por (conversationId, turnId, role). */
  appendTurn(
    conversationId: string,
    turnId: string,
    rec: TurnRecord
  ): Promise<void>
  /** Mensajes que YA salieron de la ventana reciente (no están en los últimos `recentLimit`) y
   *  todavía no entraron al resumen (id > summarizedUpToMessageId). Insumo del resumen rodante;
   *  vacío = no hay nada que resumir. `upToMessageId` = mayor id incluido (0 si vacío). */
  pendingSummary(
    conversationId: string,
    recentLimit: number
  ): Promise<{ messages: StoredMessage[]; upToMessageId: number }>
  /** Reemplaza el resumen rodante y marca hasta qué mensaje se resumió. */
  updateSummary(
    conversationId: string,
    summary: string,
    summarizedUpToMessageId: number
  ): Promise<void>
}
