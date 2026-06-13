// Cliente fino de la Bot API de Telegram (fetch, sin dependencia). Solo lo que usamos: enviar
// mensajes (con troceo a ≤4096, formato HTML con fallback a texto plano), la acción "typing"
// (dentro del topic si aplica), y registrar el webhook. Los errores se loguean y NO se lanzan: el
// handler del webhook ya respondió 200, no queremos que Telegram reintente.

import type { Logger } from "../../ports/logger.js"

const API = "https://api.telegram.org"
const MAX_LEN = 4096

/** Opciones por envío. `messageThreadId` enruta al topic/hilo del que vino el mensaje. */
export interface SendOpts {
  messageThreadId?: number
}

export interface TelegramClient {
  sendMessage(chatId: number, text: string, opts?: SendOpts): Promise<void>
  sendChatAction(
    chatId: number,
    action: "typing",
    opts?: SendOpts
  ): Promise<void>
  setWebhook(url: string, secret: string): Promise<void>
}

/** Trocea un texto en partes ≤ size, cortando preferentemente en un salto/espacio cercano al límite. */
export function splitForTelegram(text: string, size = MAX_LEN): string[] {
  if (text.length <= size) return [text]
  const parts: string[] = []
  let rest = text
  while (rest.length > size) {
    const window = rest.slice(0, size)
    let cut = window.lastIndexOf("\n")
    if (cut < size * 0.5) cut = window.lastIndexOf(" ")
    if (cut < size * 0.5) cut = size
    parts.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\s+/, "")
  }
  if (rest) parts.push(rest)
  return parts
}

export function createTelegramClient(
  botToken: string,
  logger: Logger
): TelegramClient {
  const base = `${API}/bot${botToken}`
  // Devuelve `ok` (2xx) para poder decidir fallbacks; no lanza (el webhook ya respondió 200).
  const call = async (method: string, body: unknown): Promise<boolean> => {
    try {
      const res = await fetch(`${base}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        logger.warn({ method, status: res.status }, "telegram api no-2xx")
      }
      return res.ok
    } catch (err) {
      logger.warn(
        { method, err: err instanceof Error ? err.message : String(err) },
        "telegram api falló"
      )
      return false
    }
  }
  return {
    async sendMessage(chatId, text, opts) {
      const thread =
        opts?.messageThreadId !== undefined
          ? { message_thread_id: opts.messageThreadId }
          : {}
      for (const part of splitForTelegram(text)) {
        // Intento con HTML; si Telegram rechaza (p.ej. entities inválidas), reenvío en texto plano.
        const okHtml = await call("sendMessage", {
          chat_id: chatId,
          text: part,
          parse_mode: "HTML",
          ...thread,
        })
        if (!okHtml) {
          logger.warn(
            { chatId },
            "telegram HTML rechazado → fallback texto plano"
          )
          await call("sendMessage", { chat_id: chatId, text: part, ...thread })
        }
      }
    },
    async sendChatAction(chatId, action, opts) {
      const thread =
        opts?.messageThreadId !== undefined
          ? { message_thread_id: opts.messageThreadId }
          : {}
      await call("sendChatAction", { chat_id: chatId, action, ...thread })
    },
    async setWebhook(url, secret) {
      await call("setWebhook", { url, secret_token: secret })
    },
  }
}
