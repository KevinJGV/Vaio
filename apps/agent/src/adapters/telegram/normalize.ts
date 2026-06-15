// Normalizador PURO de updates de Telegram → resultado accionable. Filtra (ignore) lo que no es un
// mensaje de texto, sin `from`, o —solo si la allowlist NO está vacía— de un user fuera de ella (el
// gating vive acá para testearse). Allowlist vacía = acceso abierto (control delegado al propio bot).
// El locale se deriva del language_code del usuario (default "es", el de Kevin).

import type { Locale } from "@vaio/contracts"

interface TgFile {
  file_id: string
  mime_type?: string
  file_size?: number
}
interface TgPhotoSize {
  file_id: string
  file_size?: number
  width: number
  height: number
}

export interface TelegramUpdate {
  update_id: number
  message?: {
    message_id: number
    text?: string
    /** Texto que acompaña a un media (foto/voz/doc). Pasa a ser el texto del turno. */
    caption?: string
    voice?: TgFile
    audio?: TgFile
    photo?: TgPhotoSize[]
    document?: TgFile & { file_name?: string }
    /** id del topic/hilo (forum topics; en chats privados de bots con topic-mode). Opcional. */
    message_thread_id?: number
    chat: { id: number; type?: string } // "private" | "group" | "supergroup" | "channel"
    from?: { id: number; language_code?: string }
  }
}

/** Adjunto detectado en un update (referencia + metadata; los bytes los baja el adapter de media). */
export interface NormalizedAttachment {
  kind: "image" | "audio"
  fileId: string
  mediaType: string
}

export type NormalizeResult =
  | {
      kind: "turn"
      updateId: number
      chatId: number
      fromId: number
      text: string
      attachments: NormalizedAttachment[]
      locale: Locale
      /** Presente sólo si el mensaje vino en un topic/hilo de Telegram. */
      threadId?: number
      /** Chat privado 1:1 (no grupo/supergrupo/canal) → habilita el streaming por `sendMessageDraft`. */
      isPrivate: boolean
    }
  | { kind: "ignore"; reason: string }
  | {
      kind: "unsupported"
      updateId: number
      chatId: number
      fromId: number
      locale: Locale
      threadId?: number
      reason: string
    }

/**
 * Clave de conversación: 1 topic = 1 conversación (su propia ventana de contexto). Sin topic (DM
 * plano) = clave por chat (comportamiento actual). El threading es aditivo y backward-compatible.
 */
export function conversationKeyFor(chatId: number, threadId?: number): string {
  return threadId === undefined ? String(chatId) : `${chatId}:${threadId}`
}

/** True sólo si `fromId` es el owner configurado (Kevin). Sin owner configurado → nadie es owner. */
export function isOwnerId(
  ownerId: number | undefined,
  fromId: number
): boolean {
  return ownerId !== undefined && fromId === ownerId
}

/** language_code de Telegram → locale soportado. "es*" → es; cualquier otro definido → en; vacío → es. */
export function detectTelegramLocale(languageCode?: string): Locale {
  if (!languageCode) return "es"
  return languageCode.toLowerCase().startsWith("es") ? "es" : "en"
}

/** Extracción PURA del media de un mensaje. `unsupported` = trae un media que NO soportamos
 *  (doc/PDF/video) → el caller responde cortés en vez de ignorar en silencio. */
export function extractAttachments(
  msg: NonNullable<TelegramUpdate["message"]>
): { attachments: NormalizedAttachment[] } | { unsupported: string } {
  if (msg.voice) {
    return {
      attachments: [
        {
          kind: "audio",
          fileId: msg.voice.file_id,
          mediaType: msg.voice.mime_type ?? "audio/ogg",
        },
      ],
    }
  }
  if (msg.audio) {
    return {
      attachments: [
        {
          kind: "audio",
          fileId: msg.audio.file_id,
          mediaType: msg.audio.mime_type ?? "audio/mpeg",
        },
      ],
    }
  }
  if (Array.isArray(msg.photo) && msg.photo.length > 0) {
    // Telegram manda varios tamaños; tomamos el mayor (por file_size, fallback al área).
    const largest = [...msg.photo].sort(
      (a, b) =>
        (b.file_size ?? b.width * b.height) -
        (a.file_size ?? a.width * a.height)
    )[0] as TgPhotoSize
    return {
      attachments: [
        { kind: "image", fileId: largest.file_id, mediaType: "image/jpeg" },
      ],
    }
  }
  if (msg.document) {
    const mime = msg.document.mime_type ?? ""
    if (mime.startsWith("image/")) {
      return {
        attachments: [
          { kind: "image", fileId: msg.document.file_id, mediaType: mime },
        ],
      }
    }
    if (mime.startsWith("audio/")) {
      return {
        attachments: [
          { kind: "audio", fileId: msg.document.file_id, mediaType: mime },
        ],
      }
    }
    return { unsupported: mime || "document" }
  }
  return { attachments: [] }
}

export function normalizeUpdate(
  u: unknown,
  allowed: Set<number>
): NormalizeResult {
  const msg = (u as TelegramUpdate | null)?.message
  if (!msg) {
    return { kind: "ignore", reason: "no-message" }
  }
  const from = msg.from
  if (!from || typeof from.id !== "number") {
    return { kind: "ignore", reason: "no-from" }
  }
  // Allowlist vacía = acceso abierto (gating delegado a la config del bot). Con ids = whitelist.
  if (allowed.size > 0 && !allowed.has(from.id)) {
    return { kind: "ignore", reason: "not-allowlisted" }
  }
  const locale = detectTelegramLocale(from.language_code)
  const threadId =
    typeof msg.message_thread_id === "number"
      ? { threadId: msg.message_thread_id }
      : {}
  const text = (msg.text ?? msg.caption ?? "").trim()
  const media = extractAttachments(msg)
  if ("unsupported" in media) {
    return {
      kind: "unsupported",
      updateId: (u as TelegramUpdate).update_id,
      chatId: msg.chat.id,
      fromId: from.id,
      locale,
      ...threadId,
      reason: media.unsupported,
    }
  }
  if (text === "" && media.attachments.length === 0) {
    return { kind: "ignore", reason: "no-content" }
  }
  return {
    kind: "turn",
    updateId: (u as TelegramUpdate).update_id,
    chatId: msg.chat.id,
    fromId: from.id,
    text,
    attachments: media.attachments,
    locale,
    ...threadId,
    isPrivate: msg.chat.type === "private",
  }
}
