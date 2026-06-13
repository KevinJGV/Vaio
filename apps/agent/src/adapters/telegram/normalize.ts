// Normalizador PURO de updates de Telegram → resultado accionable. Filtra (ignore) lo que no es un
// mensaje de texto, sin `from`, o —solo si la allowlist NO está vacía— de un user fuera de ella (el
// gating vive acá para testearse). Allowlist vacía = acceso abierto (control delegado al propio bot).
// El locale se deriva del language_code del usuario (default "es", el de Kevin).

import type { Locale } from "@vaio/contracts"

export interface TelegramUpdate {
  update_id: number
  message?: {
    message_id: number
    text?: string
    /** id del topic/hilo (forum topics; en chats privados de bots con topic-mode). Opcional. */
    message_thread_id?: number
    chat: { id: number }
    from?: { id: number; language_code?: string }
  }
}

export type NormalizeResult =
  | {
      kind: "turn"
      updateId: number
      chatId: number
      fromId: number
      text: string
      locale: Locale
      /** Presente sólo si el mensaje vino en un topic/hilo de Telegram. */
      threadId?: number
    }
  | { kind: "ignore"; reason: string }

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

export function normalizeUpdate(
  u: unknown,
  allowed: Set<number>
): NormalizeResult {
  const msg = (u as TelegramUpdate | null)?.message
  if (!msg || typeof msg.text !== "string" || msg.text.trim() === "") {
    return { kind: "ignore", reason: "no-text" }
  }
  const from = msg.from
  if (!from || typeof from.id !== "number") {
    return { kind: "ignore", reason: "no-from" }
  }
  // Allowlist vacía = acceso abierto (gating delegado a la config del bot). Con ids = whitelist.
  if (allowed.size > 0 && !allowed.has(from.id)) {
    return { kind: "ignore", reason: "not-allowlisted" }
  }
  return {
    kind: "turn",
    updateId: (u as TelegramUpdate).update_id,
    chatId: msg.chat.id,
    fromId: from.id,
    text: msg.text,
    locale: detectTelegramLocale(from.language_code),
    ...(typeof msg.message_thread_id === "number"
      ? { threadId: msg.message_thread_id }
      : {}),
  }
}
