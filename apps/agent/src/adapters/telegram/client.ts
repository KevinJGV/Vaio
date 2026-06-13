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

/** Opciones de envío de audio: hilo + caption + MIME (para el nombre/representación del archivo). */
export interface SendAudioOpts extends SendOpts {
  caption?: string
  mediaType?: string
}

export interface TelegramClient {
  sendMessage(chatId: number, text: string, opts?: SendOpts): Promise<void>
  /** Envía un audio (multipart). Devuelve `ok` para que el caller pueda caer a texto si falla. */
  sendAudio(
    chatId: number,
    audio: Uint8Array,
    opts?: SendAudioOpts
  ): Promise<boolean>
  sendChatAction(
    chatId: number,
    action: "typing",
    opts?: SendOpts
  ): Promise<void>
  setWebhook(url: string, secret: string): Promise<void>
}

/** mediaType → extensión para el nombre del archivo de audio. */
function audioFilename(mediaType?: string): string {
  if (mediaType === "audio/pcm") return "voice.pcm"
  if (mediaType === "audio/ogg") return "voice.ogg"
  return "voice.mp3"
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
    async sendAudio(chatId, audio, opts) {
      // Multipart: el `call` genérico es JSON-only. fetch arma el boundary solo (sin content-type manual).
      try {
        const form = new FormData()
        form.append("chat_id", String(chatId))
        if (opts?.messageThreadId !== undefined) {
          form.append("message_thread_id", String(opts.messageThreadId))
        }
        if (opts?.caption) form.append("caption", opts.caption)
        const blob = new Blob([audio as Uint8Array<ArrayBuffer>], {
          type: opts?.mediaType ?? "audio/mpeg",
        })
        form.append("audio", blob, audioFilename(opts?.mediaType))
        const res = await fetch(`${base}/sendAudio`, {
          method: "POST",
          body: form,
        })
        if (!res.ok) {
          logger.warn({ status: res.status }, "telegram sendAudio no-2xx")
        }
        return res.ok
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "telegram sendAudio falló"
        )
        return false
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
