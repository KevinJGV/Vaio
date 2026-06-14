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

/** Tipo de media soportado en la ENTRADA. Solo audio+imagen en este corte; `document` (PDF/docs)
 *  se sumará de forma aditiva en una iteración futura. */
export const mediaKindSchema = z.enum(["image", "audio"])
export type MediaKind = z.infer<typeof mediaKindSchema>

/** Adjunto normalizado que un canal entrega al core. El BINARIO no viaja en el contrato (no es
 *  serializable/persistible): solo la referencia recuperable + metadata. Los bytes vivos del turno
 *  viven en un tipo interno del agente (`ResolvedMedia`), no acá. */
export const inputAttachmentSchema = z.object({
  kind: mediaKindSchema,
  /** MIME exacto para construir los parts del AI SDK: "image/jpeg", "audio/ogg". */
  mediaType: z.string(),
  /** Puntero recuperable: telegram file_id | "web-inline:<uuid>". */
  ref: z.string(),
  /** Texto que acompañó al media (caption de Telegram / texto del mensaje web). */
  caption: z.string().optional(),
})
export type InputAttachment = z.infer<typeof inputAttachmentSchema>

/** Adjunto entrante por el borde web (`POST /chat`): bytes inline en base64 dentro del JSON (no
 *  multipart → el proxy del portafolio reenvía JSON sin reescribirse). El adapter los decodifica. */
export const webAttachmentSchema = z.object({
  kind: mediaKindSchema,
  mediaType: z.string(),
  dataBase64: z.string(),
  caption: z.string().optional(),
})
export type WebAttachment = z.infer<typeof webAttachmentSchema>

/** Cuerpo de `POST /chat`. */
export const chatBodySchema = z.object({
  messages: z.array(chatMessageSchema).min(1),
  locale: localeSchema.optional(),
  /** Hilo de conversación (opcional; lo manda el proxy del portafolio para correlacionar
   * trazas/persistencia a futuro). Hoy solo se propaga a los eventos de traza. */
  conversationId: z.string().optional(),
  /** Adjuntos del último mensaje del usuario (audio/imagen), base64 inline. */
  attachments: z.array(webAttachmentSchema).default([]),
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
export const turnRequestSchema = z
  .object({
    channel: channelSchema,
    /** Clave estable del hilo dentro del canal (web: conversationId; telegram: chat_id). */
    conversationKey: z.string(),
    /** Texto del nuevo mensaje del usuario. Puede ser "" si el turno trae solo adjuntos
     *  (p.ej. una nota de voz sin texto); el `refine` exige texto O adjuntos. */
    userText: z.string().default(""),
    /** Adjuntos del turno (audio/imagen). Referencias + metadata; los bytes van aparte. */
    attachments: z.array(inputAttachmentSchema).default([]),
    locale: localeSchema.optional(),
    /** Id del actor en el canal (telegram user id; "web" para el chat público anónimo). */
    principalId: z.string(),
    /** allowlisted (p.ej. Kevin en Telegram) → perfil pleno; default capado. */
    trusted: z.boolean().default(false),
  })
  .refine((d) => d.userText.length > 0 || d.attachments.length > 0, {
    message: "el turno necesita texto o al menos un adjunto",
  })
export type TurnRequest = z.infer<typeof turnRequestSchema>

/** Fragmento de memoria recuperado (RAG). `path`/`blobSha` solo los setea el collector de repos
 *  (sync incremental); el resto de las fuentes los dejan sin definir. */
export const docChunkSchema = z.object({
  source: z.string(),
  url: z.string(),
  chunk: z.string(),
  path: z.string().optional(),
  blobSha: z.string().optional(),
})
export type DocChunk = z.infer<typeof docChunkSchema>

// Eventos de observabilidad (trazas de una conversación) — ver ./trace.ts.
export * from "./trace.js"
