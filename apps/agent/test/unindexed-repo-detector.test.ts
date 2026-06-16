import { describe, expect, it } from "vitest"
import { createUnindexedRepoDetector } from "../src/core/detectors/unindexed-repo.js"
import type { OwnerRepoCatalog } from "../src/ports/owner-repos.js"
import type { RepoSyncPort } from "../src/ports/repo-sync.js"

const catalog = (names: string[]): OwnerRepoCatalog => ({
  listPublic: async () =>
    names.map((name) => ({ name, defaultBranch: "main" })),
})

function repoSync(tracked: boolean): RepoSyncPort {
  return {
    freshness: async () => ({ state: "untracked" }),
    sync: async () => ({ mode: "full", embedded: 0, deleted: 0, unchanged: 0 }),
    isTracked: async () => tracked,
    ensureFresh: async () => ({ refreshed: false }),
  }
}

const det = (names: string[], tracked = false) =>
  createUnindexedRepoDetector({
    ownerRepos: catalog(names),
    ownerUser: "KevinJGV",
    repoSync: repoSync(tracked),
  })

describe("UnindexedRepoDetector", () => {
  it("la query matchea un repo del owner NO indexado → nota learnRepo (caso ACME)", async () => {
    const hint = await det(["ACME", "Vaio"]).detect({
      query: "ACME",
      retrievedSources: ["fact", "github"], // NO hay repo:*/ACME → no está indexado
    })
    expect(hint?.note).toContain("ACME")
    expect(hint?.note.toLowerCase()).toContain("learnrepo")
  })

  it("case/separador-insensitive: 'acme' matchea 'ACME'", async () => {
    const hint = await det(["ACME"]).detect({
      query: "hablame de acme a secas",
      retrievedSources: [],
    })
    expect(hint?.note).toContain("ACME")
  })

  it("si su contenido YA está recuperado (repo:*) → null (no sugiere traer lo que ya tenés)", async () => {
    const hint = await det(["ACME"]).detect({
      query: "ACME",
      retrievedSources: ["repo:KevinJGV/ACME"],
    })
    expect(hint).toBeNull()
  })

  it("si el repo ya está trackeado → null (el freshness gate lo cubre)", async () => {
    const hint = await det(["ACME"], true).detect({
      query: "ACME",
      retrievedSources: [],
    })
    expect(hint).toBeNull()
  })

  it("ningún token de la query matchea un repo → null", async () => {
    expect(
      await det(["ACME", "Vaio"]).detect({
        query: "hablame de tu sistema",
        retrievedSources: [],
      })
    ).toBeNull()
  })

  it("nombres muy cortos (<3) no matchean (evita falsos positivos)", async () => {
    expect(
      await det(["ci"]).detect({ query: "ci", retrievedSources: [] })
    ).toBeNull()
  })

  it("catálogo vacío → null", async () => {
    expect(
      await det([]).detect({ query: "ACME", retrievedSources: [] })
    ).toBeNull()
  })
})
