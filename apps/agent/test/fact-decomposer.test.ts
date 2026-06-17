import { MockLanguageModelV3 } from "ai/test"
import { describe, expect, it } from "vitest"
import { createFactDecomposer } from "../src/adapters/fact-decomposer.js"
import type { LogFields, Logger } from "../src/ports/logger.js"

function noopLogger(): Logger {
  const noop = (_a: LogFields | string, _b?: string): void => {}
  const l: Logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => l,
  }
  return l
}

/** Mock model whose doGenerate returns a fixed structured-output JSON (what generateObject parses). */
function modelReturning(statements: string[]): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    modelId: "mock/decomposer",
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify({ statements }) }],
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      warnings: [],
    }),
  })
}

/** Mock model that throws → exercises the degradation path. */
function boomModel(): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    modelId: "mock/boom",
    doGenerate: async () => {
      throw new Error("modelo caído")
    },
  })
}

describe("FactDecomposer", () => {
  it("(a) descompone un texto compuesto en sus statements atómicos (trimmeados)", async () => {
    const out = [
      "  A Kevin le daban miedo las piscinas  ",
      "A Kevin le gustaba explorar",
      "  Los viajes de Kevin eran en familia",
    ]
    const dec = createFactDecomposer({
      model: modelReturning(out),
      logger: noopLogger(),
    })
    const res = await dec.decompose({
      rawText:
        "la piscina daba miedo, me gustaba explorar, los viajes eran en familia",
      locale: "es",
    })
    expect(res.statements).toEqual([
      "A Kevin le daban miedo las piscinas",
      "A Kevin le gustaba explorar",
      "Los viajes de Kevin eran en familia",
    ])
  })

  it("(b) un texto atómico → un solo statement", async () => {
    const dec = createFactDecomposer({
      model: modelReturning(["A Kevin le gusta la pasta"]),
      logger: noopLogger(),
    })
    const res = await dec.decompose({
      rawText: "sí, me encanta la pasta",
      question: "¿a Kevin le gusta la pasta?",
      locale: "es",
    })
    expect(res.statements).toEqual(["A Kevin le gusta la pasta"])
  })

  it("(c) el modelo devuelve [] (sensible/no-factual) → []", async () => {
    const dec = createFactDecomposer({
      model: modelReturning([]),
      logger: noopLogger(),
    })
    const res = await dec.decompose({
      rawText: "no le pases mi número, es 300...",
      locale: "es",
    })
    expect(res.statements).toEqual([])
  })

  it("(d) error del LLM → { statements: [] } (degradación, Inv #1)", async () => {
    const dec = createFactDecomposer({
      model: boomModel(),
      logger: noopLogger(),
    })
    const res = await dec.decompose({ rawText: "lo que sea", locale: "en" })
    expect(res.statements).toEqual([])
  })

  it("(e) filtra strings vacíos/whitespace de la respuesta", async () => {
    const dec = createFactDecomposer({
      model: modelReturning([
        "A Kevin le gusta el café",
        "   ",
        "",
        "Kevin vive en Colombia",
      ]),
      logger: noopLogger(),
    })
    const res = await dec.decompose({
      rawText: "café y Colombia",
      locale: "es",
    })
    expect(res.statements).toEqual([
      "A Kevin le gusta el café",
      "Kevin vive en Colombia",
    ])
  })
})
