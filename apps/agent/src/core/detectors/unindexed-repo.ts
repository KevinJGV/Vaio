// UnindexedRepoDetector ("conciencia de repos"): si un repo PÚBLICO del owner relevante al turno NO está indexado,
// avisa (nota del sistema → learnRepo). DOS señales: (1) la query NOMBRA el repo (incl. multi-palabra, vía
// reposNamedInQuery) — señal fuerte; (2) una descripción del conector github recuperada lo MENCIONA (`Repo "X"`) —
// señal de contenido (Vaio tiene solo la descripción, no el código). Conservador (no falsos positivos). Owner del
// env, no del modelo (Inv #8). Una nota por repo; el registry deduplica. Extensible a otros estados (sugerir sync…).

import type {
  KnowledgeDetector,
  RetrievedChunk,
} from "../../ports/knowledge-detector.js"
import type { OwnerRepoCatalog } from "../../ports/owner-repos.js"
import type { RepoSyncPort } from "../../ports/repo-sync.js"
import {
  normalizeRepoName,
  type OwnerRepo,
  reposNamedInQuery,
} from "../repo-resolve.js"

/** Nombres (normalizados) de repo mencionados en las descripciones del conector github recuperadas (`Repo "NAME"`). */
function reposMentionedInGithub(retrieved: RetrievedChunk[]): Set<string> {
  const names = new Set<string>()
  for (const r of retrieved) {
    if (r.source !== "github") continue
    for (const m of r.chunk.matchAll(/Repo "([^"]+)"/g)) {
      const name = m[1]
      if (name) names.add(normalizeRepoName(name))
    }
  }
  return names
}

export function createUnindexedRepoDetector(deps: {
  ownerRepos: OwnerRepoCatalog
  ownerUser: string
  repoSync: RepoSyncPort
}): KnowledgeDetector {
  return {
    name: "unindexed-repo",
    async detect({ query, retrieved }) {
      const repos = await deps.ownerRepos.listPublic()
      if (repos.length === 0) return null
      // Repos cuyo CONTENIDO ya vino (chunks repo:*) → no sugerir traer lo que ya tenemos.
      const retrievedNames = new Set(
        retrieved
          .map((r) => r.source)
          .filter((s) => s.startsWith("repo:"))
          .map((s) =>
            normalizeRepoName(s.slice("repo:".length).split("/")[1] ?? "")
          )
      )
      const notRetrieved = (r: OwnerRepo) =>
        !retrievedNames.has(normalizeRepoName(r.name))
      const notTracked = async (r: OwnerRepo) => {
        try {
          return !(await deps.repoSync.isTracked({
            owner: deps.ownerUser,
            repo: r.name,
          }))
        } catch {
          return false // best-effort: ante error, no sugerir
        }
      }
      const hint = (r: OwnerRepo) => ({
        repo: r.name,
        note: `[nota del sistema: tenés/mencionaste el repo público "${r.name}" que todavía NO tengo indexado. Lo que tengo ahora es a lo sumo una mención/descripción suelta, no el código → traelo con learnRepo (nombre "${r.name}") y respondé con su contenido real.]`,
      })

      // Señal 1 (FUERTE): la query nombra el repo (multi-palabra incl.).
      for (const r of reposNamedInQuery(query, repos)) {
        if (notRetrieved(r) && (await notTracked(r))) return hint(r)
      }
      // Señal 2 (contenido): una descripción github recuperada menciona un repo no indexado.
      const mentioned = reposMentionedInGithub(retrieved)
      for (const r of repos) {
        if (!mentioned.has(normalizeRepoName(r.name))) continue
        if (notRetrieved(r) && (await notTracked(r))) return hint(r)
      }
      return null
    },
  }
}
