import type { TraceEvent } from "@vaio/contracts"
import { describe, expect, it } from "vitest"
import type { CapabilityProfile } from "../src/core/capabilities.js"
import { buildTools, type TraceIds } from "../src/core/tools.js"
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

function caps(
  allowedTools: CapabilityProfile["allowedTools"],
  maxK: number
): CapabilityProfile {
  return {
    channel: "telegram",
    allowedTools,
    memoryScope: { maxK },
    policyText: "",
  }
}

describe("buildTools (registry gated por capacidad)", () => {
  it("incluye searchMemory solo si está en allowedTools", () => {
    const emit = (_: TraceEvent): void => {}
    const memory: MemoryStore = {
      searchMemory: async () => [],
      upsertDocuments: async () => {},
      clearSource: async () => {},
    }
    const enabled = buildTools({
      caps: caps(["searchMemory"], 6),
      memory,
      emit,
      ids,
      logger: noopLogger(),
    })
    expect(enabled.searchMemory).toBeDefined()

    const disabled = buildTools({
      caps: caps([], 6),
      memory,
      emit,
      ids,
      logger: noopLogger(),
    })
    expect(disabled.searchMemory).toBeUndefined()
  })

  it("searchMemory usa el maxK del perfil y emite tool.result con los hits", async () => {
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
    const tools = buildTools({
      caps: caps(["searchMemory"], 8),
      memory,
      emit: (e) => events.push(e),
      ids,
      logger: noopLogger(),
    })
    const exec = tools.searchMemory?.execute
    expect(exec).toBeDefined()
    const out = await exec?.(
      { query: "kevin" },
      { toolCallId: "tc1", messages: [] }
    )
    expect(calledWithK).toBe(8)
    expect(String(out)).toContain("c1")
    const result = events.find((e) => e.type === "tool.result")
    expect(result).toMatchObject({ type: "tool.result", ok: true, hits: 2 })
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
    const tools = buildTools({
      caps: caps(["searchMemory"], 6),
      memory,
      emit: () => {},
      ids,
      logger: noopLogger(),
      compressor,
    })
    const out = await tools.searchMemory?.execute?.(
      { query: "x" },
      { toolCallId: "tc", messages: [] }
    )
    expect(String(out)).toContain("[C]chunk-uno")
  })
})
