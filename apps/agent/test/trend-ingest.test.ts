import { describe, expect, it } from "vitest"
import { runConnectorTrend, type TrendDeps } from "../src/core/trend-ingest.js"
import type { DocChunk, MemoryStore } from "../src/ports/memory.js"
import type { TrendSummarizer } from "../src/ports/trend.js"
import { inMemorySnapshots } from "./fakes/in-memory-snapshots.js"

function fakeMemory() {
  const calls = { cleared: [] as string[], upserted: [] as DocChunk[] }
  const memory: MemoryStore = {
    searchMemory: async () => [],
    upsertDocuments: async (rows) => {
      calls.upserted.push(...rows)
    },
    clearSource: async (s) => {
      calls.cleared.push(s)
    },
    listIndexedFiles: async () => [],
    deleteFiles: async () => {},
    replaceFile: async () => {},
  }
  return { memory, calls }
}

function fakeSummarizer(
  impl: (i: { system: string; prompt: string }) => Promise<string>
): TrendSummarizer & { calls: number } {
  const o = {
    calls: 0,
    async summarize(i: { system: string; prompt: string }) {
      o.calls++
      return impl(i)
    },
  }
  return o
}

const base = (
  summarizer: TrendSummarizer,
  memory: MemoryStore,
  snapshots = inMemorySnapshots()
): { deps: TrendDeps; snapshots: ReturnType<typeof inMemorySnapshots> } => ({
  deps: {
    snapshots,
    summarizer,
    memory,
    retention: 12,
    locale: "es",
    now: new Date("2026-06-15T00:00:00Z"),
  },
  snapshots,
})

describe("runConnectorTrend", () => {
  it("1ª captura → 'first', sin summarizer ni upsert de trend", async () => {
    const { memory, calls } = fakeMemory()
    const sum = fakeSummarizer(async () => "tendencia")
    const { deps } = base(sum, memory)
    const st = await runConnectorTrend("lastfm", "Artistas: A, B", deps)
    expect(st).toBe("first")
    expect(sum.calls).toBe(0)
    expect(calls.upserted).toHaveLength(0)
  })

  it("2ª captura distinta → summarizer + upsert 'trend:lastfm'", async () => {
    const { memory, calls } = fakeMemory()
    const sum = fakeSummarizer(async () => "Viene escuchando más electrónica.")
    const { deps } = base(sum, memory)
    await runConnectorTrend("lastfm", "Artistas: A, B", deps)
    const st = await runConnectorTrend("lastfm", "Artistas: A, B, Deorro", deps)
    expect(st).toBe("derived")
    expect(sum.calls).toBe(1)
    expect(calls.cleared).toContain("trend:lastfm")
    expect(calls.upserted[0]).toMatchObject({
      source: "trend:lastfm",
      chunk: "Viene escuchando más electrónica.",
    })
  })

  it("summarizer tira → fallback determinístico, igual deriva (Invariante #1)", async () => {
    const { memory, calls } = fakeMemory()
    const sum = fakeSummarizer(async () => {
      throw new Error("LLM caído")
    })
    const { deps } = base(sum, memory)
    await runConnectorTrend("steam", "Juegos: Terraria (10h)", deps)
    const st = await runConnectorTrend(
      "steam",
      "Juegos: Terraria (10h), Hades II (5h)",
      deps
    )
    expect(st).toBe("derived")
    expect(calls.upserted[0]?.source).toBe("trend:steam")
    expect(String(calls.upserted[0]?.chunk)).toMatch(/Hades II/) // delta grounded
  })

  it("captura duplicada → 'dedup', sin summarizer ni upsert", async () => {
    const { memory, calls } = fakeMemory()
    const sum = fakeSummarizer(async () => "x")
    const { deps } = base(sum, memory)
    await runConnectorTrend("steam", "Juegos: Terraria", deps) // 1ª
    const st = await runConnectorTrend("steam", "Juegos: Terraria", deps) // idéntica
    expect(st).toBe("dedup")
    expect(sum.calls).toBe(0)
    expect(calls.upserted).toHaveLength(0)
  })
})
