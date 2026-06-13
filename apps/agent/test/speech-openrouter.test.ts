import { afterEach, describe, expect, it } from "vitest"
import { createSpeechSynthesizer } from "../src/adapters/speech-openrouter.js"
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

function synth(logger: Logger) {
  return createSpeechSynthesizer({
    apiKey: "SECRET-KEY",
    baseURL: "https://openrouter.ai/api/v1",
    model: "tts/model",
    voice: "alloy",
    format: "mp3",
    logger,
  })
}

describe("createSpeechSynthesizer (REST /audio/speech)", () => {
  it("postea {model,input,voice,response_format} y devuelve bytes mp3 (key no en logs)", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) })
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })
    }) as typeof fetch
    const { logger, lines } = capturingLogger()
    const out = await synth(logger).synthesize("hola mundo", "es")
    expect(out).not.toBeNull()
    expect(out?.mediaType).toBe("audio/mpeg")
    expect(out?.audio.byteLength).toBe(4)
    expect(calls[0]?.url).toBe("https://openrouter.ai/api/v1/audio/speech")
    expect(calls[0]?.body).toMatchObject({
      model: "tts/model",
      input: "hola mundo",
      voice: "alloy",
      response_format: "mp3",
    })
    expect(lines.join("\n")).not.toContain("SECRET-KEY")
  })

  it("texto vacío → null (no llama al endpoint)", async () => {
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return new Response(new Uint8Array([1]), { status: 200 })
    }) as typeof fetch
    const { logger } = capturingLogger()
    expect(await synth(logger).synthesize("   ")).toBeNull()
    expect(called).toBe(false)
  })

  it("no-2xx → null (el canal cae a texto)", async () => {
    globalThis.fetch = (async () =>
      new Response("bad", { status: 500 })) as typeof fetch
    const { logger } = capturingLogger()
    expect(await synth(logger).synthesize("hola")).toBeNull()
  })

  it("fetch lanza → null (degradación)", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network")
    }) as typeof fetch
    const { logger } = capturingLogger()
    expect(await synth(logger).synthesize("hola")).toBeNull()
  })
})
