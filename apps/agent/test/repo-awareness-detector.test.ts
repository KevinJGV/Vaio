import { describe, expect, it } from "vitest"
import { createRepoAwarenessDetector } from "../src/core/detectors/repo-awareness.js"
import type { RetrievedChunk } from "../src/ports/knowledge-detector.js"
import type { OwnerRepoCatalog } from "../src/ports/owner-repos.js"
import type { RepoReadiness, RepoSyncPort } from "../src/ports/repo-sync.js"

const catalog = (names: string[]): OwnerRepoCatalog => ({
  listPublic: async () =>
    names.map((name) => ({ name, defaultBranch: "main" })),
})

/** Fake del puerto: `ensureRepoReady` devuelve el estado scripteado (la clasificación real vive en el adapter,
 *  probada en repo-sync-adapter.test.ts). Registra los repos consultados. */
function repoSync(
  state: RepoReadiness["state"],
  probed: string[] = []
): RepoSyncPort {
  return {
    freshness: async () => ({ state: "untracked" }),
    sync: async () => ({ mode: "full", embedded: 0, deleted: 0, unchanged: 0 }),
    isTracked: async () => false,
    ensureFresh: async () => ({ refreshed: false }),
    ensureRepoReady: async (spec) => {
      probed.push(spec.repo)
      return { state }
    },
  }
}

const det = (names: string[], state: RepoReadiness["state"] = "untracked") =>
  createRepoAwarenessDetector({
    ownerRepos: catalog(names),
    ownerUser: "KevinJGV",
    repoSync: repoSync(state),
  })

const gh = (chunk: string): RetrievedChunk[] => [{ source: "github", chunk }]

describe("RepoAwarenessDetector", () => {
  it("untracked (caso ACME) → nota learnRepo con repo set", async () => {
    const hint = await det(["ACME", "Vaio"], "untracked").detect({
      query: "ACME",
      retrieved: [{ source: "fact", chunk: "" }],
    })
    expect(hint?.repo).toBe("ACME")
    expect(hint?.note.toLowerCase()).toContain("learnrepo")
  })

  it("incomplete (cap-bajo) → nota 'parcial' con repo set", async () => {
    const hint = await det(["ACME"], "incomplete").detect({
      query: "hablame de ACME",
      retrieved: [],
    })
    expect(hint?.repo).toBe("ACME")
    expect(hint?.note.toLowerCase()).toContain("parcial")
  })

  it("stale → nota 'atrás' con repo set", async () => {
    const hint = await det(["ACME"], "stale").detect({
      query: "hablame de ACME",
      retrieved: [],
    })
    expect(hint?.repo).toBe("ACME")
    expect(hint?.note.toLowerCase()).toContain("atrás")
  })

  it("fresh → sin nota (null)", async () => {
    const hint = await det(["ACME"], "fresh").detect({
      query: "ACME",
      retrieved: [],
    })
    expect(hint).toBeNull()
  })

  it("señal NOMBRE multi-palabra: 'Tastrack' → 'Tastrack_Challenge' (segmento distintivo)", async () => {
    const hint = await det(["Tastrack_Challenge", "Vaio"], "untracked").detect({
      query: "hablame de Tastrack",
      retrieved: [],
    })
    expect(hint?.repo).toBe("Tastrack_Challenge")
  })

  it("señal CONTENIDO: una descripción github recuperada menciona el repo → clasifica y avisa", async () => {
    const hint = await det(["ACME"], "incomplete").detect({
      query: "hablame de e-commerce", // no nombra ACME
      retrieved: gh(
        'Repo "ACME" (1★): Sistema de control de acceso. Lenguaje: Java.'
      ),
    })
    expect(hint?.repo).toBe("ACME")
  })

  it("segmento COMÚN no dispara (no falso positivo) → ni se sondea", async () => {
    const probed: string[] = []
    const detector = createRepoAwarenessDetector({
      ownerRepos: catalog(["Work-Project_A", "Work-Project_B"]),
      ownerUser: "KevinJGV",
      repoSync: repoSync("untracked", probed),
    })
    const hint = await detector.detect({ query: "work", retrieved: [] })
    expect(hint).toBeNull() // 'work' aparece en 2 → no distintivo
    expect(probed).toEqual([]) // no se gasta un probe si nada matchea
  })

  it("si su contenido YA está recuperado (repo:*) → null (lo cubre FreshnessDetector)", async () => {
    const probed: string[] = []
    const detector = createRepoAwarenessDetector({
      ownerRepos: catalog(["ACME"]),
      ownerUser: "KevinJGV",
      repoSync: repoSync("stale", probed),
    })
    const hint = await detector.detect({
      query: "ACME",
      retrieved: [{ source: "repo:KevinJGV/ACME", chunk: "código" }],
    })
    expect(hint).toBeNull()
    expect(probed).toEqual([]) // notRetrieved guard → no sondea (sin solape ni doble nota)
  })

  it("ningún token/mención matchea → null", async () => {
    expect(
      await det(["ACME", "Vaio"], "untracked").detect({
        query: "hablame de tu sistema",
        retrieved: [],
      })
    ).toBeNull()
  })

  it("catálogo vacío → null", async () => {
    expect(
      await det([], "untracked").detect({ query: "ACME", retrieved: [] })
    ).toBeNull()
  })
})
