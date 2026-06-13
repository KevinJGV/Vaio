import { afterEach, describe, expect, it } from "vitest"
import { createSpeechSynthesizer } from "../src/adapters/speech-openrouter.js"
import type { SpeechEntry } from "../src/config.js"
import type { LogFields, Logger } from "../src/ports/logger.js"

function capturingLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = []
  const rec = (a: LogFields | string, b?: string) => {
    lines.push(JSON.stringify(a) + (b ? ` ${b}` : ""))
  }
  const logger: Logger = {
    trace: rec,
    debug: rec,
    info: rec,
    warn: rec,
    error: rec,
    child: () => logger,
  }
  return { logger, lines }
}

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function synth(chain: SpeechEntry[], logger: Logger) {
  return createSpeechSynthesizer({
    apiKey: "SECRET-KEY",
    baseURL: "https://openrouter.ai/api/v1",
    chain,
    logger,
  })
}

const MP3: SpeechEntry = { model: "k/o", voice: "af_bella", format: "mp3" }
const PCM: SpeechEntry = { model: "g/tts", voice: "Zephyr", format: "pcm" }

describe("createSpeechSynthesizer (cadena REST /audio/speech)", () => {
  it("mp3: postea model/voice/format y devuelve bytes (key no en logs)", async () => {
    const bodies: Record<string, unknown>[] = []
    globalThis.fetch = (async (_u: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })
    }) as typeof fetch
    const { logger, lines } = capturingLogger()
    const out = await synth([MP3], logger).synthesize("hola")
    expect(out?.mediaType).toBe("audio/mpeg")
    expect(out?.audio.byteLength).toBe(4)
    expect(bodies[0]).toMatchObject({
      model: "k/o",
      voice: "af_bella",
      response_format: "mp3",
    })
    expect(lines.join("\n")).not.toContain("SECRET-KEY")
  })

  it("pcm: envuelve en WAV (header RIFF) y mediaType audio/wav", async () => {
    globalThis.fetch = (async () =>
      new Response(new Uint8Array(100), { status: 200 })) as typeof fetch
    const { logger } = capturingLogger()
    const out = await synth([PCM], logger).synthesize("hola")
    expect(out).not.toBeNull()
    const audio = out?.audio ?? new Uint8Array()
    expect(out?.mediaType).toBe("audio/wav")
    expect(audio.byteLength).toBe(144) // 44 header + 100 pcm
    expect(String.fromCharCode(...audio.slice(0, 4))).toBe("RIFF")
  })

  it("fallback: el 1º falla (500) → prueba el 2º y gana", async () => {
    let n = 0
    globalThis.fetch = (async () => {
      n++
      return n === 1
        ? new Response("bad", { status: 500 })
        : new Response(new Uint8Array([9]), { status: 200 })
    }) as typeof fetch
    const { logger } = capturingLogger()
    const out = await synth([MP3, PCM], logger).synthesize("hola")
    expect(n).toBe(2)
    expect(out).not.toBeNull()
  })

  it("todas fallan → null (el canal cae a texto)", async () => {
    globalThis.fetch = (async () =>
      new Response("bad", { status: 500 })) as typeof fetch
    const { logger } = capturingLogger()
    expect(await synth([MP3, PCM], logger).synthesize("hola")).toBeNull()
  })

  it("cadena vacía o texto vacío → null sin llamar", async () => {
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return new Response(new Uint8Array([1]), { status: 200 })
    }) as typeof fetch
    const { logger } = capturingLogger()
    expect(await synth([], logger).synthesize("hola")).toBeNull()
    expect(await synth([MP3], logger).synthesize("  ")).toBeNull()
    expect(called).toBe(false)
  })
})
