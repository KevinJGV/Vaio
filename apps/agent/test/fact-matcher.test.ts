import { MockLanguageModelV3 } from "ai/test"
import { describe, expect, it } from "vitest"
import { createFactMatcher } from "../src/adapters/fact-matcher.js"
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

function modelReturning(ordinals: number[]): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    modelId: "mock/matcher",
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify({ ordinals }) }],
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      warnings: [],
    }),
  })
}

function boomModel(): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    modelId: "mock/boom",
    doGenerate: async () => {
      throw new Error("modelo caído")
    },
  })
}

const cands = [
  { ordinal: 0, statement: "A Kevin le gusta la pizza napolitana" },
  { ordinal: 1, statement: "A Kevin no le gusta la pizza con piña" },
  { ordinal: 2, statement: "A Kevin le gusta el fútbol" },
]

describe("FactMatcher", () => {
  it("candidatos vacíos → [] sin llamar al modelo", async () => {
    const m = createFactMatcher({ model: boomModel(), logger: noopLogger() })
    expect(
      await m.match({ description: "x", candidates: [], locale: "es" })
    ).toEqual({ ordinals: [] })
  })

  it("devuelve el subconjunto que pertenece al tema (los de pizza)", async () => {
    const m = createFactMatcher({
      model: modelReturning([0, 1]),
      logger: noopLogger(),
    })
    const r = await m.match({
      description: "lo de la pizza",
      candidates: cands,
      locale: "es",
    })
    expect(r.ordinals).toEqual([0, 1])
  })

  it("descarta ordinales fuera de rango que devuelva el modelo", async () => {
    const m = createFactMatcher({
      model: modelReturning([0, 9]),
      logger: noopLogger(),
    })
    const r = await m.match({
      description: "pizza",
      candidates: cands,
      locale: "es",
    })
    expect(r.ordinals).toEqual([0]) // el 9 se descarta
  })

  it("ninguno pertenece → [] (ej. olvidar fútbol con candidatos de pizza)", async () => {
    const m = createFactMatcher({
      model: modelReturning([]),
      logger: noopLogger(),
    })
    const r = await m.match({
      description: "el fútbol",
      candidates: [
        { ordinal: 0, statement: "A Kevin le gusta la pizza napolitana" },
        { ordinal: 1, statement: "A Kevin no le gusta la pizza con piña" },
      ],
      locale: "es",
    })
    expect(r.ordinals).toEqual([])
  })

  it("modelo falla → degrada a TODOS (confía en el corte por coseno)", async () => {
    const m = createFactMatcher({ model: boomModel(), logger: noopLogger() })
    const r = await m.match({
      description: "pizza",
      candidates: cands,
      locale: "es",
    })
    expect(r.ordinals).toEqual([0, 1, 2])
  })
})
