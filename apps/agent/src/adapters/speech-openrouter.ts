// Adapter de SALIDA de voz (TTS) sobre OpenRouter: REST `POST /audio/speech` (OpenAI-compatible). El
// `@openrouter/ai-sdk-provider` NO envuelve este endpoint → `fetch` directo (ver `openrouter-api-surface`).
// CADENA de fallback client-side: se prueba cada entrada (model|voice|format) en orden; la 1ª que devuelve
// audio gana; si todas fallan → null (el canal cae a texto). pcm se envuelve en WAV (Telegram no reproduce
// pcm crudo). La key va en Authorization; nunca se loguea.

import type { SpeechEntry } from "../config.js"
import { pcmToWav } from "../core/wav.js"
import type { Logger } from "../ports/logger.js"
import type { SpeechSynthesizer } from "../ports/speech.js"

export function createSpeechSynthesizer(args: {
  apiKey: string
  baseURL: string
  chain: SpeechEntry[]
  logger: Logger
}): SpeechSynthesizer {
  const { apiKey, baseURL, chain, logger } = args
  return {
    async synthesize(text) {
      const input = text.trim()
      if (!input || chain.length === 0) return null
      for (const entry of chain) {
        const t0 = Date.now()
        try {
          const res = await fetch(`${baseURL}/audio/speech`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${apiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: entry.model,
              input,
              voice: entry.voice,
              response_format: entry.format,
            }),
          })
          if (!res.ok) {
            logger.warn(
              { model: entry.model, status: res.status },
              "tts /audio/speech no-2xx → siguiente en la cadena"
            )
            continue
          }
          const raw = new Uint8Array(await res.arrayBuffer())
          if (raw.byteLength === 0) continue
          // Observabilidad: qué entrada de la cadena sirvió + latencia.
          logger.info(
            {
              model: entry.model,
              format: entry.format,
              latencyMs: Date.now() - t0,
            },
            "media.speak"
          )
          // pcm → WAV reproducible; mp3 va tal cual.
          if (entry.format === "pcm") {
            return { audio: pcmToWav(raw), mediaType: "audio/wav" }
          }
          return { audio: raw, mediaType: "audio/mpeg" }
        } catch (err) {
          logger.warn(
            {
              model: entry.model,
              err: err instanceof Error ? err.message : "?",
            },
            "tts falló → siguiente en la cadena"
          )
        }
      }
      return null
    },
  }
}
