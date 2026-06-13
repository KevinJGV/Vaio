// Adapters de los puertos de comprensión de media (Transcriber + MediaUnderstanding) sobre el AI SDK
// (`generateText`) con un modelo multimodal barato (p.ej. Gemini Flash vía OpenRouter). El audio y la
// imagen se pasan como FILE PART inline (el AI SDK codifica los bytes); un solo modelo cubre ambos.
// El I/O de descarga NO está acá: recibimos los bytes ya resueltos. Estos adapters LANZAN si el modelo
// falla → el core (core/modality) lo captura y degrada.

import type { Locale } from "@vaio/contracts"
import { generateText, type LanguageModel } from "ai"
import type { MediaUnderstanding, Transcriber } from "../ports/media.js"

const TRANSCRIBE_ASK: Record<Locale, string> = {
  es: "Transcribí este audio textualmente. Devolvé SOLO la transcripción, sin comentarios.",
  en: "Transcribe this audio verbatim. Output ONLY the transcription, no commentary.",
}

const DESCRIBE_ASK: Record<Locale, string> = {
  es: "Describí esta imagen de forma precisa y concisa para que un asistente la use como contexto.",
  en: "Describe this image precisely and concisely for an assistant to use as context.",
}

export function createTranscriber(model: LanguageModel): Transcriber {
  return {
    async transcribe({ data, mediaType, locale = "es" }) {
      const { text } = await generateText({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: TRANSCRIBE_ASK[locale] },
              { type: "file", data, mediaType },
            ],
          },
        ],
      })
      return text.trim()
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
