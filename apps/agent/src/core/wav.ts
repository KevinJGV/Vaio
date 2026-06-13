// Envuelve PCM crudo (16-bit LE) en un contenedor WAV (header de 44 bytes). El TTS pcm (p.ej. Gemini)
// devuelve samples crudos que Telegram no reproduce; con el header WAV se vuelve un audio reproducible.
// Rate por defecto 24000 Hz mono — verificado e2e (192000 bytes de "…" = 96000 samples = 4.0s @24kHz, que
// coincide con la duración natural; a 16kHz daría 6s). PURO → testeable.

export function pcmToWav(
  pcm: Uint8Array,
  opts: { sampleRate?: number; channels?: number; bitDepth?: number } = {}
): Uint8Array {
  const sampleRate = opts.sampleRate ?? 24000
  const channels = opts.channels ?? 1
  const bitDepth = opts.bitDepth ?? 16
  const blockAlign = (channels * bitDepth) / 8
  const byteRate = sampleRate * blockAlign
  const out = new Uint8Array(44 + pcm.length)
  const view = new DataView(out.buffer)
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[off + i] = s.charCodeAt(i)
  }
  ascii(0, "RIFF")
  view.setUint32(4, 36 + pcm.length, true)
  ascii(8, "WAVE")
  ascii(12, "fmt ")
  view.setUint32(16, 16, true) // tamaño del subchunk fmt
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitDepth, true)
  ascii(36, "data")
  view.setUint32(40, pcm.length, true)
  out.set(pcm, 44)
  return out
}
