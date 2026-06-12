// Contratos compartidos entre el agente (apps/agent) y el futuro frontend (apps/web).
// Fuente única de verdad de los tipos del borde HTTP y de la memoria. Validación con zod
// para reusar el mismo schema en server y cliente.

import { z } from "zod"

/** Idioma de respuesta del agente (lo manda el portafolio). */
export const localeSchema = z.enum(["es", "en"])
export type Locale = z.infer<typeof localeSchema>

/** Un mensaje del historial de chat. */
export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
})
export type ChatMessage = z.infer<typeof chatMessageSchema>

/** Cuerpo de `POST /chat`. */
export const chatBodySchema = z.object({
  messages: z.array(chatMessageSchema).min(1),
  locale: localeSchema.optional(),
  /** Hilo de conversación (opcional; lo manda el proxy del portafolio para correlacionar
   * trazas/persistencia a futuro). Hoy solo se propaga a los eventos de traza. */
  conversationId: z.string().optional(),
})
export type ChatBody = z.infer<typeof chatBodySchema>

/** Canal de entrada por el que llega un turno. Cada canal tiene su perfil de capacidades
 *  (ver apps/agent core/capabilities). "email" se sumará en una iteración futura. */
export const channelSchema = z.enum(["web", "telegram"])
export type Channel = z.infer<typeof channelSchema>

/** Turno normalizado que cualquier canal entrega al core. Boundary compartido web↔agent:
 *  el core carga el historial server-side por `conversationKey` (el caller NO manda todo el
 *  historial). `principalId`/`trusted` identifican al actor del canal (seam para permisos
 *  por-usuario a futuro; hoy `trusted` distingue Telegram-de-Kevin del chat público). */
export const turnRequestSchema = z.object({
  channel: channelSchema,
  /** Clave estable del hilo dentro del canal (web: conversationId; telegram: chat_id). */
  conversationKey: z.string(),
  /** Texto del nuevo mensaje del usuario. */
  userText: z.string().min(1),
  locale: localeSchema.optional(),
  /** Id del actor en el canal (telegram user id; "web" para el chat público anónimo). */
  principalId: z.string(),
  /** allowlisted (p.ej. Kevin en Telegram) → perfil pleno; default capado. */
  trusted: z.boolean().default(false),
})
export type TurnRequest = z.infer<typeof turnRequestSchema>

/** Fragmento de memoria recuperado (RAG). */
export const docChunkSchema = z.object({
  source: z.string(),
  url: z.string(),
  chunk: z.string(),
})
export type DocChunk = z.infer<typeof docChunkSchema>

// Eventos de observabilidad (trazas de una conversación) — ver ./trace.ts.
export * from "./trace.js"
