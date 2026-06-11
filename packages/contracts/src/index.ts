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

/** Fragmento de memoria recuperado (RAG). */
export const docChunkSchema = z.object({
  source: z.string(),
  url: z.string(),
  chunk: z.string(),
})
export type DocChunk = z.infer<typeof docChunkSchema>

// Eventos de observabilidad (trazas de una conversación) — ver ./trace.ts.
export * from "./trace.js"
