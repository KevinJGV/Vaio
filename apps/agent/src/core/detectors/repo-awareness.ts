// RepoAwarenessDetector ("conciencia de repos"): si un repo PÚBLICO del owner relevante al turno NO tiene su
// CONTENIDO disponible/al-día, avisa (nota del sistema). DOS señales para detectar el repo nombrado: (1) la
// query NOMBRA el repo (incl. multi-palabra, vía reposNamedInQuery) — señal fuerte; (2) una descripción del
// conector github recuperada lo MENCIONA (`Repo "X"`) — señal de contenido (Vaio tiene solo la descripción, no
// el código). Para cada repo candidato (no recuperado este turno) el SISTEMA clasifica su estado vía
// `ensureRepoReady` y DISPARA la acción derivada (Inv #9): untracked → learnRepo; incompleto → completar en bg;
// stale → actualizar en bg. El modelo solo lee la nota. Conservador (no falsos positivos). Owner del env, no del
// modelo (Inv #8). Una nota por repo; el registry deduplica. FreshnessDetector cubre el eje "recuperado" aparte.

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

export function createRepoAwarenessDetector(deps: {
  ownerRepos: OwnerRepoCatalog
  ownerUser: string
  repoSync: RepoSyncPort
}): KnowledgeDetector {
  /** Nota del sistema por estado del repo. `null` = sin señal (fresh). */
  const noteFor = (repo: string, state: string): string | null => {
    switch (state) {
      case "untracked":
        return `[nota del sistema: tenés/mencionaste el repo público "${repo}" que todavía NO tengo indexado. Lo que tengo ahora es a lo sumo una mención/descripción suelta, no el código → traelo con learnRepo (nombre "${repo}") y respondé con su contenido real.]`
      case "incomplete":
        return `[nota del sistema: tengo el repo "${repo}" indexado solo PARCIALMENTE (le faltan archivos); ya lo estoy completando solo en segundo plano. Respondé con lo que tenés, pero puede que aún no tenga TODO su código — si la pregunta depende de eso, aclaralo al pasar, sin dramatizar.]`
      case "stale":
        return `[nota del sistema: tu copia indexada del repo "${repo}" está un poco atrás de GitHub; ya se está actualizando sola en segundo plano. Respondé con lo que tenés, y si la pregunta depende de cambios MUY recientes, aclaralo al pasar (que puede que aún no los tengas), sin dramatizar.]`
      default:
        return null // fresh → sin nota
    }
  }

  return {
    name: "repo-awareness",
    async detect({ query, retrieved }) {
      const repos = await deps.ownerRepos.listPublic()
      if (repos.length === 0) return null
      // Repos cuyo CONTENIDO ya vino (chunks repo:*) → no sondear lo que ya tenemos (lo cubre FreshnessDetector).
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

      // Para un repo candidato: el sistema clasifica su estado y dispara la acción sola → nota por estado.
      const hintFor = async (r: OwnerRepo) => {
        const { state } = await deps.repoSync.ensureRepoReady({
          owner: deps.ownerUser,
          repo: r.name,
        })
        const note = noteFor(r.name, state)
        return note ? { repo: r.name, note } : null
      }

      // Señal 1 (FUERTE): la query nombra el repo (multi-palabra incl.).
      for (const r of reposNamedInQuery(query, repos)) {
        if (!notRetrieved(r)) continue
        const hint = await hintFor(r)
        if (hint) return hint
      }
      // Señal 2 (contenido): una descripción github recuperada menciona un repo no recuperado.
      const mentioned = reposMentionedInGithub(retrieved)
      for (const r of repos) {
        if (!mentioned.has(normalizeRepoName(r.name))) continue
        if (!notRetrieved(r)) continue
        const hint = await hintFor(r)
        if (hint) return hint
      }
      return null
    },
  }
}
