import { MockLanguageModelV3 } from "ai/test"
import { afterEach, describe, expect, it } from "vitest"
import {
  createMediaUnderstanding,
  createTranscriber,
} from "../src/adapters/media-openrouter.js"
import { attributionHeaders } from "../src/adapters/openrouter.js"
import type { Logger } from "../src/ports/logger.js"

const noop = (() => {}) as unknown as Logger["info"]
const log: Logger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  child: () => log,
}
const data = new TextEncoder().encode("fake-bytes")
const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

describe("attributionHeaders", () => {
  it("mapea appUrl→HTTP-Referer y appName→X-Title; sin attribution → {}", () => {
    expect(
      attributionHeaders({ appName: "Vaio", appUrl: "https://vindevsito.dev" })
    ).toEqual({ "HTTP-Referer": "https://vindevsito.dev", "X-Title": "Vaio" })
    expect(attributionHeaders(undefined)).toEqual({})
  })
})

describe("createTranscriber (REST /audio/transcriptions)", () => {
  it("postea al endpoint con model + input_audio y devuelve el texto", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify({ text: "  hola mundo  " }), {
        status: 200,
      })
    }) as typeof fetch

    const t = createTranscriber(
      "SECRET-KEY",
      "https://openrouter.ai/api/v1",
      ["stt/model"],
      log
    )
    const out = await t.transcribe({
      data,
      mediaType: "audio/ogg",
      locale: "es",
    })

    expect(out).toBe("hola mundo")
    expect(calls[0]?.url).toBe(
      "https://openrouter.ai/api/v1/audio/transcriptions"
    )
    expect(calls[0]?.body.model).toBe("stt/model")
    const ia = calls[0]?.body.input_audio as { format: string; data: string }
    expect(ia.format).toBe("ogg")
    expect(typeof ia.data).toBe("string") // base64
  })

  it("mapea audio/mpeg → mp3", async () => {
    let fmt = ""
    globalThis.fetch = (async (_u: string, init?: RequestInit) => {
      fmt = (JSON.parse(String(init?.body)).input_audio as { format: string })
        .format
      return new Response(JSON.stringify({ text: "x" }), { status: 200 })
    }) as typeof fetch
    await createTranscriber("k", "https://or/api/v1", ["m"], log).transcribe({
      data,
      mediaType: "audio/mpeg",
    })
    expect(fmt).toBe("mp3")
  })

  it("no-2xx → lanza (el core degrada)", async () => {
    globalThis.fetch = (async () =>
      new Response("nope", { status: 401 })) as typeof fetch
    await expect(
      createTranscriber("k", "https://or/api/v1", ["m"], log).transcribe({
        data,
        mediaType: "audio/ogg",
      })
    ).rejects.toThrow()
  })

  it("no-2xx → loguea warn con status+body ANTES de lanzar (observabilidad)", async () => {
    const warns: Record<string, unknown>[] = []
    const spy: Logger = {
      ...log,
      warn: ((a: Record<string, unknown> | string) => {
        if (typeof a === "object") warns.push(a)
      }) as Logger["warn"],
    }
    globalThis.fetch = (async () =>
      new Response("rate limited", { status: 429 })) as typeof fetch
    await expect(
      createTranscriber("k", "https://or/api/v1", ["m"], spy).transcribe({
        data,
        mediaType: "audio/ogg",
      })
    ).rejects.toThrow()
    expect(warns[0]).toMatchObject({ status: 429 })
    expect(String(warns[0]?.body)).toContain("rate limited")
  })

  it("cadena: el 1er modelo falla (400) → prueba el 2º (fallback client-side)", async () => {
    const used: string[] = []
    globalThis.fetch = (async (_u: string, init?: RequestInit) => {
      const model = JSON.parse(String(init?.body)).model as string
      used.push(model)
      return model === "bad/model"
        ? new Response("does not exist", { status: 400 })
        : new Response(JSON.stringify({ text: "transcrito" }), { status: 200 })
    }) as typeof fetch
    const out = await createTranscriber(
      "k",
      "https://or/api/v1",
      ["bad/model", "good/model"],
      log
    ).transcribe({ data, mediaType: "audio/ogg" })
    expect(out).toBe("transcrito")
    expect(used).toEqual(["bad/model", "good/model"]) // probó en orden hasta que uno sirvió
  })
})

describe("createMediaUnderstanding (visión, chat+file-part)", () => {
  function captureModel(reply: string): {
    model: MockLanguageModelV3
    captured: { prompt: unknown }
  } {
    const captured: { prompt: unknown } = { prompt: null }
    const model = new MockLanguageModelV3({
      modelId: "mock/vision",
      doGenerate: async (options) => {
        captured.prompt = options.prompt
        return {
          content: [{ type: "text", text: reply }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          warnings: [],
        }
      },
    })
    return { model, captured }
  }

  it("manda un file part de imagen con el mediaType correcto", async () => {
    const { model, captured } = captureModel("una foto de un gato")
    const out = await createMediaUnderstanding(model, log).describe({
      data,
      mediaType: "image/jpeg",
      caption: "mi gato",
      locale: "es",
    })
    expect(out).toBe("una foto de un gato")
    const messages = captured.prompt as Array<{
      content: Array<Record<string, unknown>>
    }>
    const file = messages[0]?.content.find((p) => p.type === "file")
    expect(file?.mediaType).toBe("image/jpeg")
  })
})
