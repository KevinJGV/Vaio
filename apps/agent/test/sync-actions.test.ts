import type { TraceEvent } from "@vaio/contracts"
import { describe, expect, it } from "vitest"
import { checkRepoFreshness } from "../src/core/actions/check-repo-freshness.js"
import { syncRepoAction } from "../src/core/actions/sync-repo.js"
import type { ActionContext, TraceIds } from "../src/core/actions/types.js"
import type { CapabilityProfile, Principal } from "../src/core/capabilities.js"
import type { LogFields, Logger } from "../src/ports/logger.js"
import type { RepoSyncPort } from "../src/ports/repo-sync.js"

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
  allowedTools: ["checkRepoFreshness", "syncRepo"],
  memoryScope: { maxK: 6 },
  policyText: "",
}
function ctx(
  repoSync: RepoSyncPort | null,
  extra?: Partial<ActionContext>
): ActionContext {
  return {
    caps,
    principal,
    memory: null,
    emit: () => {},
    ids,
    logger: noopLogger(),
    repoSync,
    ...extra,
  }
}

describe("checkRepoFreshness", () => {
  it("reporta el estado de frescura", async () => {
    const repoSync: RepoSyncPort = {
      freshness: async () => ({ state: "stale" }),
      sync: async () => ({
        mode: "incremental",
        embedded: 0,
        deleted: 0,
        unchanged: 0,
      }),
      isTracked: async () => true,
    }
    const t = checkRepoFreshness.build(ctx(repoSync))
    const out = String(
      await t.execute?.(
        { owner: "kev", repo: "vaio" },
        { toolCallId: "c", messages: [] }
      )
    )
    expect(out.toLowerCase()).toContain("desactualizada")
  })
  it("degrada si no hay repoSync", async () => {
    const t = checkRepoFreshness.build(ctx(null))
    const out = String(
      await t.execute?.(
        { owner: "k", repo: "v" },
        { toolCallId: "c", messages: [] }
      )
    )
    expect(out.toLowerCase()).toContain("no puedo")
  })
})

describe("syncRepo (tool)", () => {
  it("repo trackeado + incremental → reporta lo actualizado", async () => {
    const repoSync: RepoSyncPort = {
      freshness: async () => ({ state: "stale" }),
      sync: async () => ({
        mode: "incremental",
        embedded: 2,
        deleted: 1,
        unchanged: 5,
      }),
      isTracked: async () => true,
    }
    const t = syncRepoAction.build(ctx(repoSync))
    const out = String(
      await t.execute?.(
        { owner: "kev", repo: "vaio" },
        { toolCallId: "c", messages: [] }
      )
    )
    expect(out.toLowerCase()).toContain("actualicé")
  })

  it("repo NO trackeado → denegado (parte 2)", async () => {
    const events: TraceEvent[] = []
    const repoSync: RepoSyncPort = {
      freshness: async () => ({ state: "untracked" }),
      sync: async () => ({
        mode: "error",
        embedded: 0,
        deleted: 0,
        unchanged: 0,
      }),
      isTracked: async () => false,
    }
    const t = syncRepoAction.build(
      ctx(repoSync, { emit: (e) => events.push(e) })
    )
    const out = String(
      await t.execute?.(
        { owner: "ajeno", repo: "x" },
        { toolCallId: "c", messages: [] }
      )
    )
    expect(out.toLowerCase()).toContain("no tengo")
    expect(events.find((e) => e.type === "tool.result")).toMatchObject({
      denied: true,
    })
  })

  it("diff grande (deferred) → avisa que actualiza en background", async () => {
    let bgCalls = 0
    const repoSync: RepoSyncPort = {
      freshness: async () => ({ state: "stale" }),
      sync: async (_s, opts) => {
        if (opts?.inlineMaxFiles != null)
          return { mode: "deferred", embedded: 0, deleted: 0, unchanged: 0 }
        bgCalls++
        return { mode: "incremental", embedded: 50, deleted: 0, unchanged: 0 }
      },
      isTracked: async () => true,
    }
    const t = syncRepoAction.build(ctx(repoSync, { syncInlineMaxFiles: 20 }))
    const out = String(
      await t.execute?.(
        { owner: "kev", repo: "vaio" },
        { toolCallId: "c", messages: [] }
      )
    )
    expect(out.toLowerCase()).toContain("segundo plano")
    // el refresco background se disparó (fire-and-forget)
    await new Promise((r) => setTimeout(r, 0))
    expect(bgCalls).toBe(1)
  })
})
