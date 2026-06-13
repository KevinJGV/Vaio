import { MockLanguageModelV3 } from "ai/test"
import { describe, expect, it } from "vitest"
import {
  createMediaUnderstanding,
  createTranscriber,
} from "../src/adapters/media-openrouter.js"

interface CapturedPrompt {
  prompt: unknown
}

/** Modelo mock para generateText: captura el prompt y devuelve un texto fijo. */
function captureModel(reply: string): {
  model: MockLanguageModelV3
  captured: CapturedPrompt
} {
  const captured: CapturedPrompt = { prompt: null }
  const model = new MockLanguageModelV3({
    modelId: "mock/media",
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

/** Busca el file part en el prompt convertido del AI SDK. */
function findFilePart(prompt: unknown): Record<string, unknown> | undefined {
  const messages = prompt as Array<{ content: Array<Record<string, unknown>> }>
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue
    const file = msg.content.find((p) => p.type === "file")
    if (file) return file
  }
  return undefined
}

const data = new TextEncoder().encode("fake-bytes")

describe("media-openrouter adapters", () => {
  it("transcribe manda un file part de audio y devuelve solo el texto", async () => {
    const { model, captured } = captureModel("  hola mundo  ")
    const t = createTranscriber(model)
    const out = await t.transcribe({
      data,
      mediaType: "audio/ogg",
      locale: "es",
    })
    expect(out).toBe("hola mundo")
    const file = findFilePart(captured.prompt)
    expect(file).toBeDefined()
    expect(file?.mediaType).toBe("audio/ogg")
  })

  it("describe manda un file part de imagen con el mediaType correcto", async () => {
    const { model, captured } = captureModel("una foto de un gato")
    const u = createMediaUnderstanding(model)
    const out = await u.describe({
      data,
      mediaType: "image/jpeg",
      caption: "mi gato",
      locale: "es",
    })
    expect(out).toBe("una foto de un gato")
    const file = findFilePart(captured.prompt)
    expect(file?.mediaType).toBe("image/jpeg")
  })

  it("propaga el error del modelo (el core lo degrada)", async () => {
    const model = new MockLanguageModelV3({
      modelId: "mock/boom",
      doGenerate: async () => {
        throw new Error("modelo caído")
      },
    })
    const t = createTranscriber(model)
    await expect(
      t.transcribe({ data, mediaType: "audio/ogg" })
    ).rejects.toThrow()
  })
})
