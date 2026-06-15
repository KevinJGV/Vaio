import { describe, expect, it } from "vitest"
import { checkRepoFreshness } from "../src/core/actions/check-repo-freshness.js"
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
  allowedTools: ["checkRepoFreshness"],
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
    // Invariante #8: el modelo elige el repo de este set cerrado (enum); no tipea owner/repo.
    knownRepos: [{ owner: "kev", repo: "vaio" }],
    ...extra,
  }
}

describe("checkRepoFreshness", () => {
  it("stale → no bloquea: responde ANTES de que el sync termine y lo deja corriendo en background", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    let syncDone = false
    const repoSync: RepoSyncPort = {
      freshness: async () => ({ state: "stale" }),
      sync: async () => {
        await gate // el sync de fondo se cuelga hasta soltar el gate
        syncDone = true
        return { mode: "incremental", embedded: 1, deleted: 0, unchanged: 0 }
      },
      isTracked: async () => true,
    }
    const t = checkRepoFreshness.build(ctx(repoSync))
    const out = String(
      await t.execute?.({ repo: "kev/vaio" }, { toolCallId: "c", messages: [] })
    )
    // Respondió SIN esperar a que el sync termine (fire-and-forget): no bloquea el turno.
    expect(out.toLowerCase()).toContain("segundo plano")
    expect(syncDone).toBe(false)
    // Y el sync SÍ está corriendo en background: completa al liberar el gate.
    release()
    await new Promise((r) => setTimeout(r, 0))
    expect(syncDone).toBe(true)
  })

  it("fresh → al día, sin disparar ningún sync", async () => {
    let syncCalls = 0
    const repoSync: RepoSyncPort = {
      freshness: async () => ({ state: "fresh" }),
      sync: async () => {
        syncCalls++
        return { mode: "skipped-fresh", embedded: 0, deleted: 0, unchanged: 0 }
      },
      isTracked: async () => true,
    }
    const t = checkRepoFreshness.build(ctx(repoSync))
    const out = String(
      await t.execute?.({ repo: "kev/vaio" }, { toolCallId: "c", messages: [] })
    )
    expect(out.toLowerCase()).toContain("al día")
    await new Promise((r) => setTimeout(r, 0))
    expect(syncCalls).toBe(0)
  })

  it("degrada si no hay repoSync", async () => {
    const t = checkRepoFreshness.build(ctx(null))
    const out = String(
      await t.execute?.({ repo: "kev/vaio" }, { toolCallId: "c", messages: [] })
    )
    expect(out.toLowerCase()).toContain("no puedo")
  })
})
