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
})
