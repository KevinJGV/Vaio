// Normalizador PURO de updates de Telegram → resultado accionable. Filtra (ignore) lo que no es un
// mensaje de texto, sin `from`, o de un user fuera de la allowlist (el gating vive acá para testearse).
// El locale se deriva del language_code del usuario (default "es", el de Kevin).

import type { Locale } from "@vaio/contracts"

export interface TelegramUpdate {
  update_id: number
  message?: {
    message_id: number
    text?: string
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
    }
  | { kind: "ignore"; reason: string }

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
  if (!allowed.has(from.id)) {
    return { kind: "ignore", reason: "not-allowlisted" }
  }
  return {
    kind: "turn",
    updateId: (u as TelegramUpdate).update_id,
    chatId: msg.chat.id,
    fromId: from.id,
    text: msg.text,
    locale: detectTelegramLocale(from.language_code),
  }
}
