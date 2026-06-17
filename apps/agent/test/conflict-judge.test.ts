import { beforeEach, describe, expect, it, vi } from "vitest"

// Mock de generateObject (AI SDK): controlamos la salida por test y contamos llamadas (para verificar el
// cortocircuito candidates:[] que NO debe tocar el LLM). Cada test encola una respuesta o un error.
const generateObjectMock = vi.fn()
vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => generateObjectMock(...args),
}))

import type { JudgeCandidate } from "../src/ports/conflict-judge.js"
import type { Logger } from "../src/ports/logger.js"

// import dinámico DESPUÉS de declarar el mock para que vi.mock("ai") aplique al adapter.
const { createConflictJudge } = await import(
  "../src/adapters/conflict-judge.js"
)

const noop = (() => {}) as unknown as Logger["info"]
let warnings: unknown[][] = []
const log: Logger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: ((...a: unknown[]) => {
    warnings.push(a)
  }) as unknown as Logger["warn"],
  error: noop,
  child: () => log,
}

// El model es opaco para el test (generateObject está mockeado) → un stub.
const model = {} as Parameters<typeof createConflictJudge>[0]["model"]

function makeJudge() {
  return createConflictJudge({ model, logger: log })
}

const cands = (n: number): JudgeCandidate[] =>
  Array.from({ length: n }, (_, i) => ({
    ordinal: i,
    statement: `hecho ${i}`,
  }))

beforeEach(() => {
  generateObjectMock.mockReset()
  warnings = []
})

describe("createConflictJudge", () => {
  it("(a) candidates:[] → { decisions: [] } sin llamar al LLM", async () => {
    const judge = makeJudge()
    const out = await judge.judge({
      rawText: "x",
      statement: "A Kevin le gusta la pasta",
      candidates: [],
      locale: "es",
    })
    expect(out).toEqual({ decisions: [] })
    expect(generateObjectMock).not.toHaveBeenCalled()
  })

  it("(b) 3 candidatos, el LLM devuelve 2 decisions → la 3ª se completa coexists", async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: {
        decisions: [
          { ordinal: 0, verdict: "contradicts" },
          { ordinal: 1, verdict: "duplicate" },
        ],
        suggestion: "",
      },
    })
    const judge = makeJudge()
    const out = await judge.judge({
      rawText: "ya no le gusta",
      statement: "s",
      candidates: cands(3),
      locale: "es",
    })
    expect(out.decisions).toEqual([
      { ordinal: 0, verdict: "contradicts" },
      { ordinal: 1, verdict: "duplicate" },
      { ordinal: 2, verdict: "coexists" },
    ])
    expect(out.suggestion).toBeUndefined()
  })

  it("(c) ordinal fuera de rango en la respuesta → descartado, el faltante → coexists", async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: {
        decisions: [
          { ordinal: 0, verdict: "contradicts" },
          { ordinal: 7, verdict: "contradicts" }, // fuera de rango (solo hay 0 y 1)
        ],
        suggestion: "",
      },
    })
    const judge = makeJudge()
    const out = await judge.judge({
      rawText: "r",
      statement: "s",
      candidates: cands(2),
      locale: "es",
    })
    expect(out.decisions).toEqual([
      { ordinal: 0, verdict: "contradicts" },
      { ordinal: 1, verdict: "coexists" }, // el ordinal 7 se descartó; el 1 faltante → coexists
    ])
  })

  it("(d) el LLM tira error → todos coexists + warn (NUNCA contradicts)", async () => {
    generateObjectMock.mockRejectedValueOnce(new Error("boom"))
    const judge = makeJudge()
    const out = await judge.judge({
      rawText: "r",
      statement: "s",
      candidates: cands(3),
      locale: "es",
    })
    expect(out.decisions).toEqual([
      { ordinal: 0, verdict: "coexists" },
      { ordinal: 1, verdict: "coexists" },
      { ordinal: 2, verdict: "coexists" },
    ])
    expect(out.decisions.every((d) => d.verdict !== "contradicts")).toBe(true)
    expect(warnings.length).toBe(1)
  })

  it("(e) N-vs-1 con mix contradicts/duplicate/coexists se mapea bien + suggestion pasa", async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: {
        decisions: [
          { ordinal: 0, verdict: "coexists" },
          { ordinal: 1, verdict: "contradicts" },
          { ordinal: 2, verdict: "duplicate" },
          { ordinal: 3, verdict: "unsure" },
        ],
        suggestion: "revisá el fact 1",
      },
    })
    const judge = makeJudge()
    const out = await judge.judge({
      rawText: "r",
      statement: "s",
      candidates: cands(4),
      locale: "en",
    })
    expect(out.decisions).toEqual([
      { ordinal: 0, verdict: "coexists" },
      { ordinal: 1, verdict: "contradicts" },
      { ordinal: 2, verdict: "duplicate" },
      { ordinal: 3, verdict: "unsure" },
    ])
    expect(out.suggestion).toBe("revisá el fact 1")
    expect(generateObjectMock).toHaveBeenCalledTimes(1)
  })

  it("decisions vacías del LLM → todos coexists (faltantes completados)", async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: { decisions: [], suggestion: "" },
    })
    const judge = makeJudge()
    const out = await judge.judge({
      rawText: "r",
      statement: "s",
      candidates: cands(2),
      locale: "es",
    })
    expect(out.decisions).toEqual([
      { ordinal: 0, verdict: "coexists" },
      { ordinal: 1, verdict: "coexists" },
    ])
  })
})
