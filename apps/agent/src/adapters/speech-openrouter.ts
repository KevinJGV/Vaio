// Adapter de SALIDA de voz (TTS) sobre OpenRouter: REST `POST /audio/speech` (OpenAI-compatible). El
// `@openrouter/ai-sdk-provider` NO envuelve este endpoint → `fetch` directo (ver `openrouter-api-surface`).
// Devuelve null ante cualquier fallo (el canal degrada a texto). La key va en Authorization; nunca se loguea.

import type { Logger } from "../ports/logger.js"
import type { SpeechSynthesizer } from "../ports/speech.js"

const FORMAT_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  pcm: "audio/pcm",
}

export function createSpeechSynthesizer(args: {
  apiKey: string
  baseURL: string
  model: string
  voice: string
  format: "mp3" | "pcm"
  logger: Logger
}): SpeechSynthesizer {
  const { apiKey, baseURL, model, voice, format, logger } = args
  return {
    async synthesize(text) {
      const input = text.trim()
      if (!input) return null
      try {
        const res = await fetch(`${baseURL}/audio/speech`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            input,
            voice,
            response_format: format,
          }),
        })
        if (!res.ok) {
          logger.warn({ status: res.status }, "tts /audio/speech no-2xx")
          return null
        }
        const audio = new Uint8Array(await res.arrayBuffer())
        if (audio.byteLength === 0) return null
        return { audio, mediaType: FORMAT_MIME[format] ?? "audio/mpeg" }
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : "?" },
          "tts falló"
        )
        return null
      }
    },
  }
}
