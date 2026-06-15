import { describe, expect, it } from "vitest"
import { recentActivity } from "../src/core/actions/recent-activity.js"
import type { ActionContext, TraceIds } from "../src/core/actions/types.js"
import type { CapabilityProfile, Principal } from "../src/core/capabilities.js"
import type { Connector } from "../src/ports/connector.js"
import type { LogFields, Logger } from "../src/ports/logger.js"
import type { DocChunk, MemoryStore } from "../src/ports/memory.js"

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
const ids: TraceIds = { requestId: "r", turnId: "t" }
const principal: Principal = { channel: "web", id: "web", trusted: false }
const caps: CapabilityProfile = {
  channel: "web",
  allowedTools: ["recentActivity"],
  memoryScope: { maxK: 6 },
  policyText: "",
}
function ctx(
  connectors: Connector[],
  memory: MemoryStore | null = null
): ActionContext {
  return {
    caps,
    principal,
    memory,
    emit: () => {},
    ids,
    logger: noopLogger(),
    connectors,
  }
}
// Fake de memoria que solo resuelve trends por source exacto (lo que usa recentActivity).
function trendMemory(bySource: Record<string, string>): MemoryStore {
  return {
    searchMemory: async () => [],
    upsertDocuments: async () => {},
    clearSource: async () => {},
    listIndexedFiles: async () => [],
    deleteFiles: async () => {},
    replaceFile: async () => {},
    getBySource: async (source: string): Promise<DocChunk[]> => {
      const chunk = bySource[source]
      return chunk ? [{ source, url: "", chunk }] : []
    },
  }
}
const conn = (name: string, snap: string | null): Connector => ({
  name,
  live: async () => snap,
})

describe("recentActivity", () => {
  it("concatena los snapshots no-null de los conectores", async () => {
    const t = recentActivity.build(
      ctx([conn("lastfm", "🎧 X"), conn("github", "💻 Y")])
    )
    const out = String(await t.execute?.({}, { toolCallId: "c", messages: [] }))
    expect(out).toContain("🎧 X")
    expect(out).toContain("💻 Y")
  })

  it("omite los null (best-effort) y no rompe si un conector tira", async () => {
    const throwing: Connector = {
      name: "boom",
      live: async () => {
        throw new Error("down")
      },
    }
    const t = recentActivity.build(
      ctx([conn("lastfm", "🎧 X"), conn("github", null), throwing])
    )
    const out = String(await t.execute?.({}, { toolCallId: "c", messages: [] }))
    expect(out).toBe("🎧 X")
  })

  it("sin conectores → degrada con cortesía", async () => {
    const t = recentActivity.build(ctx([]))
    const out = String(await t.execute?.({}, { toolCallId: "c", messages: [] }))
    expect(out.toLowerCase()).toContain("no tengo señales")
  })

  it("complementa lo live con la tendencia (trend:<source>) del conector", async () => {
    const mem = trendMemory({
      "trend:lastfm": "Viene tirando para lo electrónico.",
    })
    const t = recentActivity.build(
      ctx(
        [conn("lastfm", "🎵 Madonna — Frozen"), conn("github", "💻 push")],
        mem
      )
    )
    const out = String(await t.execute?.({}, { toolCallId: "c", messages: [] }))
    expect(out).toContain("🎵 Madonna — Frozen") // lo live (el AHORA)
    expect(out).toContain("📈") // sección de tendencias (la EVOLUCIÓN)
    expect(out).toContain("Viene tirando para lo electrónico.")
    expect(out).toContain("[lastfm]")
    // github no tiene trend → no aparece línea de tendencia para él
    expect(out).not.toContain("[github]")
  })

  it("sin trends (memoria sin getBySource o vacía) → solo live, igual que hoy", async () => {
    const t = recentActivity.build(
      ctx([conn("lastfm", "🎵 X")], trendMemory({}))
    )
    const out = String(await t.execute?.({}, { toolCallId: "c", messages: [] }))
    expect(out).toBe("🎵 X")
    expect(out).not.toContain("📈")
  })
})
