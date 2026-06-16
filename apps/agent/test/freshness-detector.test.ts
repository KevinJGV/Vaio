import { describe, expect, it } from "vitest"
import { createFreshnessDetector } from "../src/core/detectors/freshness.js"
import type { RepoSyncPort } from "../src/ports/repo-sync.js"

/** Helper: arma `retrieved` (chunks) a partir de una lista de sources (el chunk no importa para freshness). */
const rs = (...sources: string[]) =>
  sources.map((source) => ({ source, chunk: "" }))

function repoSync(
  behind: boolean,
  spy?: { ensureCalledWith?: string[] }
): RepoSyncPort {
  return {
    freshness: async () => ({ state: "stale" }),
    sync: async () => ({ mode: "full", embedded: 0, deleted: 0, unchanged: 0 }),
    isTracked: async () => true,
    ensureFresh: async (sources) => {
      if (spy) spy.ensureCalledWith = sources
      return { refreshed: false, behind }
    },
  }
}

describe("FreshnessDetector", () => {
  it("un repo:* recuperado que está behind → nota del sistema (avisa que está atrás)", async () => {
    const spy: { ensureCalledWith?: string[] } = {}
    const d = createFreshnessDetector(repoSync(true, spy))
    const hint = await d.detect({
      query: "x",
      retrieved: rs("fact", "repo:kev/vaio", "github"),
    })
    expect(spy.ensureCalledWith).toEqual(["repo:kev/vaio"]) // solo los repo:*
    expect(hint?.note.toLowerCase()).toMatch(/atrás|segundo plano|actualiz/)
  })

  it("behind:false → null (no avisa)", async () => {
    const d = createFreshnessDetector(repoSync(false))
    expect(
      await d.detect({ query: "x", retrieved: rs("repo:kev/vaio") })
    ).toBeNull()
  })

  it("sin sources repo:* → null (ni llama ensureFresh)", async () => {
    const spy: { ensureCalledWith?: string[] } = {}
    const d = createFreshnessDetector(repoSync(true, spy))
    expect(
      await d.detect({ query: "x", retrieved: rs("fact", "github") })
    ).toBeNull()
    expect(spy.ensureCalledWith).toBeUndefined()
  })

  it("si ensureFresh tira → null (best-effort, no rompe el turno)", async () => {
    const broken: RepoSyncPort = {
      freshness: async () => ({ state: "stale" }),
      sync: async () => ({
        mode: "error",
        embedded: 0,
        deleted: 0,
        unchanged: 0,
      }),
      isTracked: async () => true,
      ensureFresh: async () => {
        throw new Error("boom")
      },
    }
    const d = createFreshnessDetector(broken)
    expect(
      await d.detect({ query: "x", retrieved: rs("repo:kev/vaio") })
    ).toBeNull()
  })
})
