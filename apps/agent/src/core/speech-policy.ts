// Policy PURA de SALIDA de voz (TTS). Decide si Vaio responde en audio y limpia el texto para el TTS.
// Default = TEXTO. Voz si: (a) el turno entrante trajo audio (espejo) o (b) el usuario lo pide explícito.
// La detección de "pedido" es una heurística deterministica (frases ES/EN + comando /voz|/voice); a futuro
// puede subir a model-driven. Sin I/O → testeable.

/** Frases que cuentan como "respondé en voz" (ES/EN). Ancladas para no gatillar con menciones casuales. */
const VOICE_REQUEST =
  /(\/voz|\/voice|respond[eé](me)?\s+(con|en)\s+(voz|audio)|respond\s+in\s+voice|reply\s+in\s+voice|h[aá]blame|mand[aá]me\s+(un\s+)?audio|voice\s+note|nota\s+de\s+voz)/i

export function shouldSpeak(args: {
  inboundHadAudio: boolean
  userText: string
}): boolean {
  if (args.inboundHadAudio) return true
  return VOICE_REQUEST.test(args.userText)
}

/** Limpia HTML/markdown/espacios para que el TTS lea texto plano y natural. */
export function stripForSpeech(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ") // tags HTML
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // [texto](url) → texto
    .replace(/[*_`#>~]/g, "") // markdown inline/bloque
    .replace(/\s+/g, " ")
    .trim()
}
