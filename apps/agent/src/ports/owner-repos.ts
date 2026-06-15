// Puerto: catálogo de los repos PÚBLICOS del owner (para resolver nombres en `learnRepo`). Separado de
// RepoSyncPort por cohesión (listar repos del owner ≠ sincronizar un repo). El core depende de este puerto;
// el I/O (GitHub API + cache + filtro de privacidad) vive en el adapter.

import type { OwnerRepo } from "../core/repo-resolve.js"

export interface OwnerRepoCatalog {
  /** Repos PÚBLICOS del owner (private=false), cacheados con TTL. Nunca tira: ante error devuelve []
   *  (degrada → el llamador reporta "no pude consultar tus repos"; Invariante #1). */
  listPublic(): Promise<OwnerRepo[]>
}
