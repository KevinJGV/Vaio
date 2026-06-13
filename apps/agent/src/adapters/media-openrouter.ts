// Adapters de comprensión de media sobre OpenRouter.
//  - Transcriber (audio→texto): REST `POST /audio/transcriptions` (modelo STT dedicado, OpenAI-compatible).
//    El `@openrouter/ai-sdk-provider` NO envuelve este endpoint → `fetch` directo (ver memoria
//    `openrouter-api-surface`). Single-provider.
//  - MediaUnderstanding (imagen→texto): `generateText` + file-part sobre la cadena de VISIÓN (no hay endpoint
//    dedicado de visión; va por chat).
// Ambos LANZAN si fallan → el core (core/modality) lo captura y degrada (nunca rompe el turno). La key va en
// el header Authorization; jamás se loguea.

import type { Locale } from "@vaio/contracts"
import { generateText, type LanguageModel } from "ai"
import type { MediaUnderstanding, Transcriber } from "../ports/media.js"

const DESCRIBE_ASK: Record<Locale, string> = {
  es: "Describí esta imagen de forma precisa y concisa para que un asistente la use como contexto.",
  en: "Describe this image precisely and concisely for an assistant to use as context.",
}

/** mediaType ("audio/ogg") → format que espera /audio/transcriptions ("ogg"). */
function audioFormat(mediaType: string): string {
  const sub = mediaType.split("/")[1] ?? "ogg"
  if (sub === "mpeg") return "mp3"
  if (sub === "x-wav" || sub === "wave") return "wav"
  return sub // ogg, mp3, wav, webm, m4a, flac…
}

/** STT vía REST. `baseURL` ya incluye `/api/v1`; pegamos `/audio/transcriptions`. */
export function createTranscriber(
  apiKey: string,
  baseURL: string,
  model: string
): Transcriber {
  return {
    async transcribe({ data, mediaType, locale = "es" }) {
      const res = await fetch(`${baseURL}/audio/transcriptions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          input_audio: {
            data: Buffer.from(data).toString("base64"),
            format: audioFormat(mediaType),
          },
          language: locale,
        }),
      })
      if (!res.ok) {
        throw new Error(`transcriptions ${res.status}`)
      }
      const json = (await res.json()) as { text?: string }
      return (json.text ?? "").trim()
    },
  }
}

export function createMediaUnderstanding(
  model: LanguageModel
): MediaUnderstanding {
  return {
    async describe({ data, mediaType, caption, locale = "es" }) {
      const ask = caption
        ? `${DESCRIBE_ASK[locale]}\n${locale === "en" ? "User context" : "Contexto del usuario"}: ${caption}`
        : DESCRIBE_ASK[locale]
      const { text } = await generateText({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: ask },
              { type: "file", data, mediaType },
            ],
          },
        ],
      })
      return text.trim()
    },
  }
}
