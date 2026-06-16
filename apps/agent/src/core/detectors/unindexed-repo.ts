// UnindexedRepoDetector (caso ACME): si la query del turno matchea el NOMBRE de un repo PÚBLICO del owner que NO
// está indexado (su contenido no vino en los chunks recuperados y no está trackeado), emite una nota del sistema
// sugiriendo learnRepo. Resuelve el gap real: Vaio se conformaba con la descripción suelta del conector github sin
// saber que existía el repo completo. CONSERVADOR (match exacto de token normalizado, nombre ≥3) para no falsos
// positivos. El owner lo pone el sistema (env), no el modelo (Invariante #8). Una nota máx.

import type { KnowledgeDetector } from "../../ports/knowledge-detector.js"
import type { OwnerRepoCatalog } from "../../ports/owner-repos.js"
import type { RepoSyncPort } from "../../ports/repo-sync.js"
import { normalizeRepoName } from "../repo-resolve.js"

const MIN_NAME_LEN = 3

/** Tokens alfanuméricos de la query, normalizados (lowercase + sin separadores), únicos, ≥ MIN_NAME_LEN. */
function queryTokens(query: string): Set<string> {
  return new Set(
    query
      .split(/[^\p{L}\p{N}]+/u)
      .map(normalizeRepoName)
      .filter((t) => t.length >= MIN_NAME_LEN)
  )
}

export function createUnindexedRepoDetector(deps: {
  ownerRepos: OwnerRepoCatalog
  ownerUser: string
  repoSync: RepoSyncPort
}): KnowledgeDetector {
  return {
    name: "unindexed-repo",
    async detect({ query, retrievedSources }) {
      const repos = await deps.ownerRepos.listPublic()
      if (repos.length === 0) return null
      const tokens = queryTokens(query)
      if (tokens.size === 0) return null
      // Nombres de repo cuyo CONTENIDO ya vino en los chunks (no sugerir traer lo que ya tenemos).
      const retrievedNames = new Set(
        retrievedSources
          .filter((s) => s.startsWith("repo:"))
          .map((s) =>
            normalizeRepoName(s.slice("repo:".length).split("/")[1] ?? "")
          )
      )
      for (const repo of repos) {
        const norm = normalizeRepoName(repo.name)
        if (norm.length < MIN_NAME_LEN) continue
        if (!tokens.has(norm)) continue // match exacto de token (conservador)
        if (retrievedNames.has(norm)) continue // ya tenemos su contenido
        try {
          // Si ya está trackeado, el FreshnessDetector lo cubre → no es "sin indexar".
          if (
            await deps.repoSync.isTracked({
              owner: deps.ownerUser,
              repo: repo.name,
            })
          )
            continue
        } catch {
          continue // best-effort
        }
        return {
          note: `[nota del sistema: tenés un repo público llamado "${repo.name}" que todavía NO tengo indexado. Si la pregunta es sobre él, traelo con learnRepo (nombre "${repo.name}") y respondé con su contenido real; lo que tengas ahora puede ser solo una mención suelta, no el repo entero.]`,
        }
      }
      return null
    },
  }
}
