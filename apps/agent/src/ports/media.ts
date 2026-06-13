// Puertos de COMPRENSIÓN DE MEDIA (audio→texto, imagen→texto). El core depende de estas interfaces;
// los adapters concretos viven en adapters/ (hoy media-openrouter, Gemini Flash vía OpenRouter). El
// I/O de DESCARGA (bajar el binario de Telegram / decodificar base64 web) NO está acá: lo hace el
// adapter de canal, que entrega `ResolvedMedia` (bytes vivos del turno) al core.

import type { Locale } from "@vaio/contracts"

/** Adjunto YA resuelto a bytes (interno al agente; NO viaja por el contrato wire ni se persiste).
 *  `ref` = puntero recuperable (telegram file_id | "web-inline:<uuid>") que sí se persiste. */
export interface ResolvedMedia {
  kind: "image" | "audio"
  mediaType: string
  ref: string
  caption?: string
  data: Uint8Array
}

/** audio → texto. Lanza si falla; el core degrada (nunca rompe el turno). */
export interface Transcriber {
  transcribe(input: {
    data: Uint8Array
    mediaType: string
    locale?: Locale
  }): Promise<string>
}

/** imagen → descripción textual (cuando NO se pasa nativa al modelo de chat). Lanza si falla. */
export interface MediaUnderstanding {
  describe(input: {
    data: Uint8Array
    mediaType: string
    caption?: string
    locale?: Locale
  }): Promise<string>
}
