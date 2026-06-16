import { describe, expect, it } from "vitest"
import { createUnindexedRepoDetector } from "../src/core/detectors/unindexed-repo.js"
import type { RetrievedChunk } from "../src/ports/knowledge-detector.js"
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

const gh = (chunk: string): RetrievedChunk[] => [{ source: "github", chunk }]

describe("UnindexedRepoDetector", () => {
  it("señal NOMBRE exacto (caso ACME) → nota learnRepo con repo set", async () => {
    const hint = await det(["ACME", "Vaio"]).detect({
      query: "ACME",
      retrieved: [{ source: "fact", chunk: "" }],
    })
    expect(hint?.repo).toBe("ACME")
    expect(hint?.note).toContain("ACME")
    expect(hint?.note.toLowerCase()).toContain("learnrepo")
  })

  it("señal NOMBRE multi-palabra: 'Tastrack' → 'Tastrack_Challenge' (segmento distintivo)", async () => {
    const hint = await det(["Tastrack_Challenge", "Vaio"]).detect({
      query: "hablame de Tastrack",
      retrieved: [],
    })
    expect(hint?.repo).toBe("Tastrack_Challenge")
  })

  it("señal CONTENIDO: una descripción github recuperada menciona un repo no indexado → nota", async () => {
    const hint = await det(["ACME"]).detect({
      query: "hablame de e-commerce", // no nombra ACME
      retrieved: gh(
        'Repo "ACME" (1★): Sistema de control de acceso. Lenguaje: Java.'
      ),
    })
    expect(hint?.repo).toBe("ACME")
  })

  it("segmento COMÚN no dispara (no falso positivo)", async () => {
    const hint = await det(["Work-Project_A", "Work-Project_B"]).detect({
      query: "work",
      retrieved: [],
    })
    expect(hint).toBeNull() // 'work' aparece en 2 → no distintivo
  })

  it("si su contenido YA está recuperado (repo:*) → null", async () => {
    const hint = await det(["ACME"]).detect({
      query: "ACME",
      retrieved: [{ source: "repo:KevinJGV/ACME", chunk: "código" }],
    })
    expect(hint).toBeNull()
  })

  it("si el repo ya está trackeado → null (lo cubre el freshness gate)", async () => {
    const hint = await det(["ACME"], true).detect({
      query: "ACME",
      retrieved: [],
    })
    expect(hint).toBeNull()
  })

  it("ningún token/mención matchea → null", async () => {
    expect(
      await det(["ACME", "Vaio"]).detect({
        query: "hablame de tu sistema",
        retrieved: [],
      })
    ).toBeNull()
  })

  it("catálogo vacío → null", async () => {
    expect(await det([]).detect({ query: "ACME", retrieved: [] })).toBeNull()
  })
})
