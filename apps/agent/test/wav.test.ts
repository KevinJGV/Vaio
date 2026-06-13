import { describe, expect, it } from "vitest"
import { pcmToWav } from "../src/core/wav.js"

function str(b: Uint8Array, off: number, len: number): string {
  return String.fromCharCode(...b.slice(off, off + len))
}

describe("pcmToWav", () => {
  it("antepone un header WAV de 44 bytes válido (RIFF/WAVE/fmt/data)", () => {
    const pcm = new Uint8Array(100)
    const wav = pcmToWav(pcm)
    expect(wav.byteLength).toBe(144)
    expect(str(wav, 0, 4)).toBe("RIFF")
    expect(str(wav, 8, 4)).toBe("WAVE")
    expect(str(wav, 12, 4)).toBe("fmt ")
    expect(str(wav, 36, 4)).toBe("data")
  })

  it("escribe rate/canales/bits por defecto (24000, mono, 16-bit) en little-endian", () => {
    const wav = pcmToWav(new Uint8Array(8))
    const view = new DataView(wav.buffer)
    expect(view.getUint16(22, true)).toBe(1) // channels
    expect(view.getUint32(24, true)).toBe(24000) // sampleRate
    expect(view.getUint16(34, true)).toBe(16) // bitDepth
    expect(view.getUint32(40, true)).toBe(8) // data length
    expect(view.getUint32(4, true)).toBe(36 + 8) // RIFF chunk size
  })

  it("copia el pcm tras el header", () => {
    const pcm = new Uint8Array([10, 20, 30])
    const wav = pcmToWav(pcm)
    expect([...wav.slice(44)]).toEqual([10, 20, 30])
  })
})
