// Adapter del puerto OwnerRepoCatalog: lista los repos PÚBLICOS del owner vía GitHub REST, cacheado.
// Reusa `githubApi` (mismo endpoint que el conector github, pero con tipo propio porque ese conector NO
// modela `private`). Filtra `private===true` — un repo privado en el RAG sería recuperable por el chat
// público anónimo (fuga). Degrada a [] ante cualquier error (Invariante #1).

import type { OwnerRepo } from "../../core/repo-resolve.js"
import type { Logger } from "../../ports/logger.js"
import type { OwnerRepoCatalog } from "../../ports/owner-repos.js"
import { githubApi } from "./github-api.js"

/** Forma (parcial) de un repo en `GET /users/{user}/repos`. Tipo propio: incluye `private` (clave para el filtro). */
interface GhRepoListItem {
  name: string
  private: boolean
  default_branch?: string
}

const PER_PAGE = 100
/** Cap duro de páginas (≤300 repos) para no volverse caro si el owner tiene muchísimos repos. */
const MAX_PAGES = 3

/** PURO: filtra a públicos (private===false) y mapea a OwnerRepo. Conserva forks/archived (Kevin podría preguntar por uno). */
export function publicReposOnly(list: GhRepoListItem[]): OwnerRepo[] {
  return list
    .filter((r) => r.private === false)
    .map((r) => ({ name: r.name, defaultBranch: r.default_branch ?? "main" }))
}

export function createOwnerRepoCatalog(deps: {
  user: string
  token?: string
  logger?: Logger
  /** TTL del cache (ms). Default 10 min. */
  ttlMs?: number
}): OwnerRepoCatalog {
  const ttlMs = deps.ttlMs ?? 10 * 60 * 1000
  let cache: { at: number; repos: OwnerRepo[] } | null = null

  async function fetchAll(): Promise<OwnerRepo[]> {
    const all: GhRepoListItem[] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const items = await githubApi<GhRepoListItem[]>(
        `/users/${encodeURIComponent(deps.user)}/repos?sort=updated&per_page=${PER_PAGE}&page=${page}`,
        deps.token
      )
      if (!Array.isArray(items) || items.length === 0) break
      all.push(...items)
      if (items.length < PER_PAGE) break // última página
      if (page === MAX_PAGES) {
        deps.logger?.warn(
          { user: deps.user, cap: MAX_PAGES * PER_PAGE },
          "owner-repos: listado truncado en el cap de páginas"
        )
      }
    }
    return publicReposOnly(all)
  }

  return {
    async listPublic(): Promise<OwnerRepo[]> {
      const now = Date.now()
      if (cache && now - cache.at < ttlMs) return cache.repos
      try {
        const repos = await fetchAll()
        cache = { at: now, repos }
        return repos
      } catch (err) {
        deps.logger?.warn(
          { user: deps.user, err: err instanceof Error ? err.message : "?" },
          "owner-repos: listado falló (degrada a [])"
        )
        return []
      }
    },
  }
}
