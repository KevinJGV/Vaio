// Cliente fino de la Bot API de Telegram (fetch, sin dependencia). Solo lo que usamos: enviar
// mensajes (con troceo a ≤4096, formato HTML con fallback a texto plano), la acción "typing"
// (dentro del topic si aplica), y registrar el webhook. Los errores se loguean y NO se lanzan: el
// handler del webhook ya respondió 200, no queremos que Telegram reintente.

import type { Logger } from "../../ports/logger.js"
import { sanitizeTelegramHtml, stripTelegramHtml } from "./html.js"

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
  /** Stremea un texto PARCIAL en vivo (preview efímero, animado por `draftId`). Solo chats PRIVADOS. `text`
   *  vacío = placeholder "Thinking…". Devuelve `ok` (false en no-2xx) → el llamador degrada a typing. Al
   *  terminar hay que `sendMessage` para persistir (el draft es efímero). */
  sendMessageDraft(
    chatId: number,
    draftId: number,
    text: string
  ): Promise<boolean>
  setWebhook(url: string, secret: string): Promise<void>
}

/** mediaType → extensión para el nombre del archivo de audio. */
function audioFilename(mediaType?: string): string {
  if (mediaType === "audio/wav") return "voice.wav"
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
        // Capturamos el body (description) de Telegram: dice la causa EXACTA (entities/length/thread/…).
        // Antes se descartaba → fallos "a ciegas". Diagnóstico de cuál parámetro/contenido lo rompe.
        const errBody = await res.text().catch(() => "")
        const b = body as { parse_mode?: string; text?: string }
        logger.warn(
          {
            method,
            status: res.status,
            body: errBody.slice(0, 300),
            parseMode: b.parse_mode ?? "(plano)",
            textLen: typeof b.text === "string" ? b.text.length : undefined,
          },
          "telegram api no-2xx"
        )
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
      // El modelo a veces emite tags que Telegram no soporta (p.ej. `<span>` pelado) → 400. Saneamos a HTML
      // válido de Telegram ANTES de enviar (deja solo los tags soportados); si igual rechaza, el fallback va en
      // texto plano SIN tags (limpio). Ver adapters/telegram/html.ts.
      for (const part of splitForTelegram(sanitizeTelegramHtml(text))) {
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
          await call("sendMessage", {
            chat_id: chatId,
            text: stripTelegramHtml(part),
            ...thread,
          })
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
    async sendMessageDraft(chatId, draftId, text) {
      // Texto PLANO (sin parse_mode: un HTML a medias rompería el parseo). Solo privados → sin thread.
      return call("sendMessageDraft", {
        chat_id: chatId,
        draft_id: draftId,
        text,
      })
    },
    async setWebhook(url, secret) {
      await call("setWebhook", { url, secret_token: secret })
    },
  }
}
