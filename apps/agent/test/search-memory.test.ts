import type { TraceEvent } from "@vaio/contracts"
import { describe, expect, it } from "vitest"
import { searchMemory } from "../src/core/actions/search-memory.js"
import type { ActionContext, TraceIds } from "../src/core/actions/types.js"
import type { CapabilityProfile, Principal } from "../src/core/capabilities.js"
import type { LogFields, Logger } from "../src/ports/logger.js"
import type { DocChunk, MemoryStore } from "../src/ports/memory.js"

function noopLogger(): Logger {
  const noop = (_a: LogFields | string, _b?: string): void => {}
  const logger: Logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => logger,
  }
  return logger
}

const ids: TraceIds = { requestId: "req", turnId: "turn" }
const principal: Principal = { channel: "telegram", id: "1", trusted: true }

function caps(maxK: number): CapabilityProfile {
  return {
    channel: "telegram",
    allowedTools: ["searchMemory"],
    memoryScope: { maxK },
    policyText: "",
  }
}

function ctx(partial: Partial<ActionContext>): ActionContext {
  return {
    caps: caps(6),
    principal,
    memory: null,
    emit: () => {},
    ids,
    logger: noopLogger(),
    ...partial,
  }
}

describe("searchMemory (descriptor migrado)", () => {
  it("la descripción ancla categorías y NO sobre-impera ('SIEMPRE')", () => {
    const t = searchMemory.build(ctx({})) as { description?: string }
    expect(t.description ?? "").toContain("proyectos")
    expect(t.description ?? "").toContain("contacto")
    expect(t.description ?? "").not.toContain("SIEMPRE")
  })

  it("usa el maxK del perfil y emite tool.result con los hits", async () => {
    let calledWithK = -1
    const docs: DocChunk[] = [
      { source: "cv", url: "u", chunk: "c1" },
      { source: "github", url: "", chunk: "c2" },
    ]
    const memory: MemoryStore = {
      searchMemory: async (_q, k) => {
        calledWithK = k ?? -1
        return docs
      },
      upsertDocuments: async () => {},
      clearSource: async () => {},
      listIndexedFiles: async () => [],
      deleteFiles: async () => {},
      replaceFile: async () => {},
    }
    const events: TraceEvent[] = []
    const t = searchMemory.build(
      ctx({ caps: caps(8), memory, emit: (e) => events.push(e) })
    )
    const out = await t.execute?.(
      { query: "kevin" },
      { toolCallId: "tc1", messages: [] }
    )
    expect(calledWithK).toBe(8)
    expect(String(out)).toContain("c1")
    expect(events.find((e) => e.type === "tool.result")).toMatchObject({
      type: "tool.result",
      ok: true,
      hits: 2,
    })
  })

  it("comprime los chunks de RAG si hay compresor", async () => {
    const memory: MemoryStore = {
      searchMemory: async () => [{ source: "cv", url: "", chunk: "chunk-uno" }],
      upsertDocuments: async () => {},
      clearSource: async () => {},
      listIndexedFiles: async () => [],
      deleteFiles: async () => {},
      replaceFile: async () => {},
    }
    const compressor = {
      compress: (t: string) => `[C]${t}`,
      expand: (t: string) => t,
      countTokens: (t: string) => t.length,
    }
    const t = searchMemory.build(ctx({ memory, compressor }))
    const out = await t.execute?.(
      { query: "x" },
      { toolCallId: "tc", messages: [] }
    )
    expect(String(out)).toContain("[C]chunk-uno")
  })

  it("degrada a cortesía si memory es null", async () => {
    const t = searchMemory.build(ctx({ memory: null }))
    const out = await t.execute?.(
      { query: "x" },
      { toolCallId: "tc", messages: [] }
    )
    expect(String(out)).toContain("memoria")
  })

  it("con reranker: recupera wide-K, reordena por relevancia y recorta al maxK", async () => {
    let calledWithK = -1
    const cands: DocChunk[] = [
      { source: "a", url: "", chunk: "c0" },
      { source: "b", url: "", chunk: "c1" },
      { source: "c", url: "", chunk: "c2" },
    ]
    const memory: MemoryStore = {
      searchMemory: async (_q, k) => {
        calledWithK = k ?? -1
        return cands
      },
      upsertDocuments: async () => {},
      clearSource: async () => {},
      listIndexedFiles: async () => [],
      deleteFiles: async () => {},
      replaceFile: async () => {},
    }
    // reranker que invierte la relevancia: el último candidato es el más relevante.
    const reranker = {
      rerank: async (_q: string, docs: string[], topN: number) =>
        docs
          .map((_d, index) => ({ index, score: index }))
          .sort((a, b) => b.score - a.score)
          .slice(0, topN),
    }
    const t = searchMemory.build(
      ctx({ caps: caps(2), memory, reranker, rerankCandidates: 30 })
    )
    const out = String(
      await t.execute?.({ query: "x" }, { toolCallId: "tc", messages: [] })
    )
    expect(calledWithK).toBe(30) // recuperó el pool ancho, no el maxK
    // top-2 reordenado: c2 (más relevante) antes que c1; c0 queda fuera
    expect(out).toContain("c2")
    expect(out).toContain("c1")
    expect(out).not.toContain("c0")
    expect(out.indexOf("c2")).toBeLessThan(out.indexOf("c1"))
  })

  it("freshness gate: si ensureFresh refresca, re-recupera (searchMemory 2 veces)", async () => {
    let calls = 0
    const memory: MemoryStore = {
      searchMemory: async () => {
        calls++
        return [{ source: "repo:kev/vaio", url: "u", chunk: "c" }]
      },
      upsertDocuments: async () => {},
      clearSource: async () => {},
      listIndexedFiles: async () => [],
      deleteFiles: async () => {},
      replaceFile: async () => {},
    }
    const repoSync = {
      freshness: async () => ({ state: "stale" as const }),
      sync: async () => ({
        mode: "incremental" as const,
        embedded: 1,
        deleted: 0,
        unchanged: 0,
      }),
      isTracked: async () => true,
      ensureFresh: async () => ({ refreshed: true }),
    }
    const t = searchMemory.build(ctx({ memory, repoSync }))
    await t.execute?.({ query: "kevin" }, { toolCallId: "tc", messages: [] })
    expect(calls).toBe(2) // recuperó, gate refrescó, re-recuperó
  })

  it("freshness gate: si NO refresca, recupera 1 sola vez", async () => {
    let calls = 0
    const memory: MemoryStore = {
      searchMemory: async () => {
        calls++
        return [{ source: "repo:kev/vaio", url: "u", chunk: "c" }]
      },
      upsertDocuments: async () => {},
      clearSource: async () => {},
      listIndexedFiles: async () => [],
      deleteFiles: async () => {},
      replaceFile: async () => {},
    }
    const repoSync = {
      freshness: async () => ({ state: "fresh" as const }),
      sync: async () => ({
        mode: "skipped-fresh" as const,
        embedded: 0,
        deleted: 0,
        unchanged: 0,
      }),
      isTracked: async () => true,
      ensureFresh: async () => ({ refreshed: false }),
    }
    const t = searchMemory.build(ctx({ memory, repoSync }))
    await t.execute?.({ query: "kevin" }, { toolCallId: "tc", messages: [] })
    expect(calls).toBe(1)
  })

  it("antepone los facts curados a los docs del repo (no compiten)", async () => {
    let factsK = -1
    const memory: MemoryStore = {
      searchMemory: async () => [
        { source: "repo:k/v", url: "u", chunk: "doc-del-repo" },
      ],
      searchFacts: async (_q, opts) => {
        factsK = opts?.k ?? -1
        return [
          { source: "fact", url: "", chunk: "A Kevin le gusta el fútbol" },
        ]
      },
      upsertDocuments: async () => {},
      clearSource: async () => {},
      listIndexedFiles: async () => [],
      deleteFiles: async () => {},
      replaceFile: async () => {},
    }
    const events: TraceEvent[] = []
    const t = searchMemory.build(
      ctx({ memory, emit: (e) => events.push(e), factRetrieveMax: 4 })
    )
    const out = String(
      await t.execute?.({ query: "gustos" }, { toolCallId: "tc", messages: [] })
    )
    expect(factsK).toBe(4)
    expect(out).toContain("A Kevin le gusta el fútbol")
    expect(out).toContain("doc-del-repo")
    // el fact va PRIMERO (lidera el contexto)
    expect(out.indexOf("fútbol")).toBeLessThan(out.indexOf("doc-del-repo"))
    expect(events.find((e) => e.type === "tool.result")).toMatchObject({
      hits: 2,
    })
  })

  it("con reranker que devuelve [] (falló): degrada a vector top-K", async () => {
    const cands: DocChunk[] = [
      { source: "a", url: "", chunk: "v0" },
      { source: "b", url: "", chunk: "v1" },
      { source: "c", url: "", chunk: "v2" },
    ]
    const memory: MemoryStore = {
      searchMemory: async () => cands,
      upsertDocuments: async () => {},
      clearSource: async () => {},
      listIndexedFiles: async () => [],
      deleteFiles: async () => {},
      replaceFile: async () => {},
    }
    const reranker = { rerank: async () => [] }
    const t = searchMemory.build(ctx({ caps: caps(2), memory, reranker }))
    const out = String(
      await t.execute?.({ query: "x" }, { toolCallId: "tc", messages: [] })
    )
    // fallback = orden vector, recortado a maxK (2): v0 y v1, sin v2
    expect(out).toContain("v0")
    expect(out).toContain("v1")
    expect(out).not.toContain("v2")
  })
})
