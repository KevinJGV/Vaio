// Puerto: catálogo de los repos PÚBLICOS del owner (para resolver nombres en `learnRepo`). Separado de
// RepoSyncPort por cohesión (listar repos del owner ≠ sincronizar un repo). El core depende de este puerto;
// el I/O (GitHub API + cache + filtro de privacidad) vive en el adapter.

import type { OpenPR } from "../core/repo-activity.js"
import type { OwnerRepo } from "../core/repo-resolve.js"

export interface OwnerRepoCatalog {
  /** Repos PÚBLICOS del owner (private=false), cacheados con TTL. Nunca tira: ante error devuelve []
   *  (degrada → el llamador reporta "no pude consultar tus repos"; Invariante #1). */
  listPublic(): Promise<OwnerRepo[]>
}

/** Estado VIVO de los repos del owner (consultas dinámicas, no metadata cacheada). Separado de
 *  OwnerRepoCatalog por cohesión (estado vivo ≠ listar repos). Lo consume `findRepos` por sus params vivos. */
export interface OwnerRepoActivity {
  /** PRs ABIERTOS (sin mergear) en los repos PÚBLICOS del owner (Search API, 1 call cross-repo, cacheado con TTL).
   *  `null` = no se pudo consultar (degrada honesto → "no pude consultar"); `[]` = genuinamente ninguno (Inv #1). */
  openPullRequests(): Promise<OpenPR[] | null>
}
