import { describe, expect, it } from "vitest"
import { learnRepo } from "../src/core/actions/learn-repo.js"
import type { ActionContext, TraceIds } from "../src/core/actions/types.js"
import type { CapabilityProfile, Principal } from "../src/core/capabilities.js"
import type { LogFields, Logger } from "../src/ports/logger.js"
import type { OwnerRepoCatalog } from "../src/ports/owner-repos.js"
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
const principal: Principal = { channel: "telegram", id: "1", trusted: true }
const caps: CapabilityProfile = {
  channel: "telegram",
  allowedTools: ["learnRepo"],
  memoryScope: { maxK: 8 },
  policyText: "",
}

/** RepoSyncPort fake con espías; `tracked` controla isTracked; `onSync` registra los specs sincronizados. */
function fakeRepoSync(opts: {
  tracked?: boolean
  onSync?: (spec: { owner: string; repo: string }) => Promise<void>
}): RepoSyncPort & { synced: { owner: string; repo: string }[] } {
  const synced: { owner: string; repo: string }[] = []
  return {
    synced,
    freshness: async () => ({ state: "untracked" }),
    sync: async (spec) => {
      synced.push({ owner: spec.owner, repo: spec.repo })
      if (opts.onSync) await opts.onSync({ owner: spec.owner, repo: spec.repo })
      return { mode: "full", embedded: 1, deleted: 0, unchanged: 0 }
    },
    isTracked: async () => opts.tracked ?? false,
    ensureFresh: async () => ({ refreshed: false }),
  }
}

function ctx(partial: Partial<ActionContext>): ActionContext {
  return {
    caps,
    principal,
    memory: null,
    emit: () => {},
    ids,
    logger: noopLogger(),
    ownerUser: "KevinJGV",
    ...partial,
  }
}

const catalog = (names: string[]): OwnerRepoCatalog => ({
  listPublic: async () =>
    names.map((name) => ({ name, defaultBranch: "main" })),
})

describe("learnRepo", () => {
  it("match + NO trackeado → dispara el sync (full, background) con owner del sistema + avisa", async () => {
    const repoSync = fakeRepoSync({ tracked: false })
    const t = learnRepo.build(
      ctx({ ownerRepos: catalog(["clon-ai", "vaio"]), repoSync })
    )
    const out = String(
      await t.execute?.({ repo: "clon-ai" }, { toolCallId: "c", messages: [] })
    )
    await new Promise((r) => setTimeout(r, 0)) // dejar correr el fire-and-forget
    expect(repoSync.synced).toEqual([{ owner: "KevinJGV", repo: "clon-ai" }])
    expect(out.toLowerCase()).toMatch(/trayendo|moment|de nuevo/)
  })

  it("match + YA trackeado → NO re-ingiere, dice que ya lo tiene", async () => {
    const repoSync = fakeRepoSync({ tracked: true })
    const t = learnRepo.build(ctx({ ownerRepos: catalog(["vaio"]), repoSync }))
    const out = String(
      await t.execute?.({ repo: "vaio" }, { toolCallId: "c", messages: [] })
    )
    expect(repoSync.synced).toEqual([])
    expect(out.toLowerCase()).toContain("ya lo tengo")
  })

  it("ambiguous → NO ingiere, lista candidatos", async () => {
    const repoSync = fakeRepoSync({})
    const t = learnRepo.build(
      ctx({ ownerRepos: catalog(["portfolio", "portafolio"]), repoSync })
    )
    const out = String(
      await t.execute?.({ repo: "port" }, { toolCallId: "c", messages: [] })
    )
    expect(repoSync.synced).toEqual([])
    expect(out.toLowerCase()).toContain("portfolio")
  })

  it("none → NO ingiere, fallo visible", async () => {
    const repoSync = fakeRepoSync({})
    const t = learnRepo.build(ctx({ ownerRepos: catalog(["vaio"]), repoSync }))
    const out = String(
      await t.execute?.({ repo: "zzzzz" }, { toolCallId: "c", messages: [] })
    )
    expect(repoSync.synced).toEqual([])
    expect(out.toLowerCase()).toMatch(/no te? encuentro|no encontr/)
  })

  it("listado vacío (rate-limit/error) → degrada visible, NO ingiere", async () => {
    const repoSync = fakeRepoSync({})
    const t = learnRepo.build(ctx({ ownerRepos: catalog([]), repoSync }))
    const out = String(
      await t.execute?.({ repo: "vaio" }, { toolCallId: "c", messages: [] })
    )
    expect(repoSync.synced).toEqual([])
    expect(out.toLowerCase()).toContain("no pude")
  })

  it("sin ownerRepos/repoSync → degrada limpio", async () => {
    const t = learnRepo.build(ctx({ ownerRepos: null, repoSync: null }))
    const out = String(
      await t.execute?.({ repo: "vaio" }, { toolCallId: "c", messages: [] })
    )
    expect(out.toLowerCase()).toContain("no puedo")
  })

  it("el sync de fondo que falla NO rompe el turno (fire-and-forget)", async () => {
    const repoSync = fakeRepoSync({
      tracked: false,
      onSync: async () => {
        throw new Error("ingest boom")
      },
    })
    const t = learnRepo.build(
      ctx({ ownerRepos: catalog(["clon-ai"]), repoSync })
    )
    const out = String(
      await t.execute?.({ repo: "clon-ai" }, { toolCallId: "c", messages: [] })
    )
    await new Promise((r) => setTimeout(r, 0))
    expect(out.toLowerCase()).toMatch(/trayendo|moment/) // respondió igual
  })
})
