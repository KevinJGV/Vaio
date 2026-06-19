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

  it("NO comprime los chunks de RAG: el contexto recuperado va al modelo CRUDO (fidelidad de grounding)", async () => {
    // El chunk trae prosa con artículos + código con operadores/espacios: comprimir
    // esto los mutila ('le gusta el fútbol'→'le gusta fútbol', 'a ?? b.name'→'a??b.name').
    const raw = "A Kevin le gusta el fútbol; const x = a ?? b.name"
    const memory: MemoryStore = {
      searchMemory: async () => [{ source: "cv", url: "", chunk: raw }],
      upsertDocuments: async () => {},
      clearSource: async () => {},
      listIndexedFiles: async () => [],
      deleteFiles: async () => {},
      replaceFile: async () => {},
    }
    const t = searchMemory.build(ctx({ memory }))
    const out = String(
      await t.execute?.({ query: "x" }, { toolCallId: "tc", messages: [] })
    )
    // Verbatim: artículos, espacios y operadores intactos (searchMemory no comprime el RAG).
    expect(out).toContain(raw)
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

  it("recupera 1 sola vez (el gate ya no re-recupera; vive en los detectores)", async () => {
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
    const t = searchMemory.build(ctx({ memory }))
    await t.execute?.({ query: "kevin" }, { toolCallId: "tc", messages: [] })
    expect(calls).toBe(1)
  })

  it("antepone las NOTAS de los detectores al output (señales de disponibilidad)", async () => {
    const memory: MemoryStore = {
      searchMemory: async () => [
        { source: "repo:kev/vaio", url: "u", chunk: "código actual" },
      ],
      upsertDocuments: async () => {},
      clearSource: async () => {},
      listIndexedFiles: async () => [],
      deleteFiles: async () => {},
      replaceFile: async () => {},
    }
    let runCtx: {
      query: string
      retrieved: { source: string; chunk: string }[]
    } | null = null
    const detectors = {
      run: async (c: {
        query: string
        retrieved: { source: string; chunk: string }[]
      }) => {
        runCtx = c
        return ["[nota del sistema: tenés un repo X sin indexar]"]
      },
    }
    const out = String(
      await searchMemory
        .build(ctx({ memory, detectors }))
        .execute?.({ query: "ACME", messages: [] } as never, {
          toolCallId: "tc",
          messages: [],
        })
    )
    // La nota va ANTES del contenido; el contenido sigue ahí.
    expect(out).toContain("tenés un repo X sin indexar")
    expect(out).toContain("código actual")
    expect(out.indexOf("sin indexar")).toBeLessThan(
      out.indexOf("código actual")
    )
    // El registry recibe la query + los chunks recuperados (source + texto).
    expect(runCtx).toMatchObject({
      query: "ACME",
      retrieved: [{ source: "repo:kev/vaio", chunk: "código actual" }],
    })
  })

  it("sin detectores → solo el contenido, sin notas", async () => {
    const memory: MemoryStore = {
      searchMemory: async () => [
        { source: "repo:kev/vaio", url: "u", chunk: "código actual" },
      ],
      upsertDocuments: async () => {},
      clearSource: async () => {},
      listIndexedFiles: async () => [],
      deleteFiles: async () => {},
      replaceFile: async () => {},
    }
    const out = String(
      await searchMemory
        .build(ctx({ memory }))
        .execute?.({ query: "kevin" }, { toolCallId: "tc", messages: [] })
    )
    expect(out).toContain("código actual")
    expect(out).not.toContain("nota del sistema")
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

  it("cross-idioma: query → canónico (retrieval) Y facts → idioma del usuario (presentación)", async () => {
    let factsQuery = ""
    const calls: { text: string; target: "es" | "en" }[] = []
    const memory: MemoryStore = {
      searchMemory: async () => [],
      searchFacts: async (q) => {
        factsQuery = q
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
    const translator = {
      translate: async (text: string, target: "es" | "en") => {
        calls.push({ text, target })
        // simula: la query EN→ES (retrieval) y el fact ES→EN (presentación)
        return target === "es"
          ? "qué piensa Kevin sobre el fútbol"
          : "Kevin likes football"
      },
    }
    const t = searchMemory.build(
      ctx({ memory, translator, locale: "en", factCanonicalLocale: "es" })
    )
    const out = String(
      await t.execute?.(
        { query: "what does Kevin think about football" },
        { toolCallId: "tc", messages: [] }
      )
    )
    // (1) retrieval: buscó facts con la query traducida al canónico
    expect(factsQuery).toBe("qué piensa Kevin sobre el fútbol")
    expect(calls).toContainEqual({
      text: "what does Kevin think about football",
      target: "es",
    })
    // (2) presentación: el fact canónico (ES) se tradujo al idioma del usuario (EN) en el output
    expect(calls).toContainEqual({
      text: "A Kevin le gusta el fútbol",
      target: "en",
    })
    expect(out).toContain("Kevin likes football")
    expect(out).not.toContain("le gusta el fútbol")
  })

  it("same-idioma: NO traduce (locale == canónico) → busca con la query cruda", async () => {
    let factsQuery = ""
    let translatorCalled = false
    const memory: MemoryStore = {
      searchMemory: async () => [],
      searchFacts: async (q) => {
        factsQuery = q
        return []
      },
      upsertDocuments: async () => {},
      clearSource: async () => {},
      listIndexedFiles: async () => [],
      deleteFiles: async () => {},
      replaceFile: async () => {},
    }
    const translator = {
      translate: async (text: string) => {
        translatorCalled = true
        return text
      },
    }
    const t = searchMemory.build(
      ctx({ memory, translator, locale: "es", factCanonicalLocale: "es" })
    )
    await t.execute?.(
      { query: "qué piensa Kevin de la muerte" },
      { toolCallId: "tc", messages: [] }
    )
    expect(translatorCalled).toBe(false) // el owner en su idioma no paga traducción
    expect(factsQuery).toBe("qué piensa Kevin de la muerte")
  })

  it("sin traductor: busca facts con la query cruda (degrada)", async () => {
    let factsQuery = ""
    const memory: MemoryStore = {
      searchMemory: async () => [],
      searchFacts: async (q) => {
        factsQuery = q
        return []
      },
      upsertDocuments: async () => {},
      clearSource: async () => {},
      listIndexedFiles: async () => [],
      deleteFiles: async () => {},
      replaceFile: async () => {},
    }
    const t = searchMemory.build(
      ctx({ memory, locale: "en", factCanonicalLocale: "es" })
    )
    await t.execute?.(
      { query: "raw english query" },
      { toolCallId: "tc", messages: [] }
    )
    expect(factsQuery).toBe("raw english query")
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
