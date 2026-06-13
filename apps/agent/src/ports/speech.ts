// Puerto de SALIDA de voz (TTS). El canal (hoy Telegram) lo usa para entregar la respuesta en audio
// cuando la policy lo indica. Devuelve null si la síntesis falla → degradación: se manda el texto.
// El I/O concreto (OpenRouter /audio/speech) vive en el adapter; el core/canal solo ve esta interfaz.

import type { Locale } from "@vaio/contracts"

export interface SpeechResult {
  audio: Uint8Array
  /** MIME del audio generado (p.ej. "audio/mpeg" para mp3) — para el envío por el canal. */
  mediaType: string
}

export interface SpeechSynthesizer {
  /** texto → audio. null si falla (el canal cae a texto, nunca rompe). */
  synthesize(text: string, locale?: Locale): Promise<SpeechResult | null>
}
