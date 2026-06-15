import { afterEach, describe, expect, it, vi } from "vitest"
import { createEmbedder } from "../src/adapters/embeddings.js"

afterEach(() => vi.unstubAllGlobals())

/** Stub de fetch que mide el máximo de requests simultáneos y devuelve un embedding
 *  distinguible por input ([length(text)]) para verificar el orden. */
function stubFetchTracking() {
  const state = { inFlight: 0, maxInFlight: 0 }
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      state.inFlight++
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight)
      const text = JSON.parse(init.body).input as string
      await new Promise((r) => setTimeout(r, 10)) // latencia → los requests se solapan
      state.inFlight--
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: [text.length] }] }),
      }
    })
  )
  return state
}

describe("createEmbedder.embed — concurrencia acotada", () => {
  it("corre con concurrencia ACOTADA (no 1-por-1) y PRESERVA el orden", async () => {
    const state = stubFetchTracking()
    const embedder = createEmbedder({
      apiKey: "k",
      model: "m",
      baseUrl: "http://x",
      concurrency: 3,
    })
    const texts = ["a", "bb", "ccc", "dddd", "eeeee", "ffffff", "ggggggg"]
    const out = await embedder.embed(texts)
    // Orden: out[i] corresponde a texts[i] (embedding = [length]).
    expect(out.map((e) => e[0])).toEqual(texts.map((t) => t.length))
    // Concurrencia: corrió en paralelo pero acotada a 3.
    expect(state.maxInFlight).toBeGreaterThan(1)
    expect(state.maxInFlight).toBeLessThanOrEqual(3)
  })
})
