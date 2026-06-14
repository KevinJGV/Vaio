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
import type { Attribution } from "../config.js"
import type { Logger } from "../ports/logger.js"
import type { MediaUnderstanding, Transcriber } from "../ports/media.js"
import { attributionHeaders } from "./openrouter.js"

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

/** STT vía REST. `baseURL` ya incluye `/api/v1`; pegamos `/audio/transcriptions`. `chain` = modelos a probar
 *  en orden (fallback CLIENT-SIDE: el endpoint es single-model, no tiene el fallback server-side del chat). El
 *  1º que transcribe gana; si todos fallan, lanza (el core degrada → evento `degraded`). */
export function createTranscriber(
  apiKey: string,
  baseURL: string,
  chain: string[],
  logger: Logger,
  attribution?: Attribution
): Transcriber {
  return {
    async transcribe({ data, mediaType, locale = "es" }) {
      const base64 = Buffer.from(data).toString("base64")
      const format = audioFormat(mediaType)
      let lastErr = "sin modelos de transcripción"
      for (const model of chain) {
        const t0 = Date.now()
        const res = await fetch(`${baseURL}/audio/transcriptions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
            ...attributionHeaders(attribution),
          },
          body: JSON.stringify({
            model,
            input_audio: { data: base64, format },
            language: locale,
          }),
        })
        if (!res.ok) {
          const body = await res.text().catch(() => "")
          lastErr = `transcriptions ${res.status}`
          logger.warn(
            { model, status: res.status, body: body.slice(0, 500) },
            "transcribe failed → siguiente en la cadena"
          )
          continue
        }
        const json = (await res.json()) as { text?: string }
        // Observabilidad: qué modelo de la cadena sirvió (con fallback, no siempre el primario) + latencia.
        logger.info({ model, latencyMs: Date.now() - t0 }, "media.transcribe")
        return (json.text ?? "").trim()
      }
      // Toda la cadena falló → lanza; el core lo captura (onDegrade) y degrada con la causa.
      throw new Error(lastErr)
    },
  }
}

export function createMediaUnderstanding(
  model: LanguageModel,
  logger: Logger
): MediaUnderstanding {
  return {
    async describe({ data, mediaType, caption, locale = "es" }) {
      const ask = caption
        ? `${DESCRIBE_ASK[locale]}\n${locale === "en" ? "User context" : "Contexto del usuario"}: ${caption}`
        : DESCRIBE_ASK[locale]
      const t0 = Date.now()
      const { text, response } = await generateText({
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
      // `response.modelId` = el modelo que OpenRouter REALMENTE usó (resuelto del fallback server-side
      // de VISION_MODELS) → así se ve cuál sirvió, no solo el primario configurado.
      logger.info(
        { modelId: response.modelId, latencyMs: Date.now() - t0 },
        "media.vision"
      )
      return text.trim()
    },
  }
}
