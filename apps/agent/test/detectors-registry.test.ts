import { describe, expect, it } from "vitest"
import { createDetectorRegistry } from "../src/core/detectors/registry.js"
import type {
  DetectContext,
  KnowledgeDetector,
} from "../src/ports/knowledge-detector.js"

const ctx: DetectContext = { query: "x", retrievedSources: [] }
const det = (name: string, note: string | null): KnowledgeDetector => ({
  name,
  detect: async () => (note ? { note } : null),
})

describe("createDetectorRegistry", () => {
  it("corre los detectores y devuelve solo las notas no-nulas", async () => {
    const reg = createDetectorRegistry([
      det("a", "[nota a]"),
      det("b", null),
      det("c", "[nota c]"),
    ])
    expect(await reg.run(ctx)).toEqual(["[nota a]", "[nota c]"])
  })

  it("un detector que TIRA no rompe a los demás (best-effort)", async () => {
    const boom: KnowledgeDetector = {
      name: "boom",
      detect: async () => {
        throw new Error("boom")
      },
    }
    const reg = createDetectorRegistry([boom, det("ok", "[nota ok]")])
    expect(await reg.run(ctx)).toEqual(["[nota ok]"])
  })

  it("recorta a un cap de notas por turno (no inundar)", async () => {
    const reg = createDetectorRegistry(
      [det("a", "1"), det("b", "2"), det("c", "3"), det("d", "4")],
      { maxNotes: 2 }
    )
    expect(await reg.run(ctx)).toEqual(["1", "2"])
  })

  it("sin detectores → []", async () => {
    expect(await createDetectorRegistry([]).run(ctx)).toEqual([])
  })
})
