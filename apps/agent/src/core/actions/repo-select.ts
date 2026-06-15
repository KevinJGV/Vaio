// Selección de repo para las tools de repos (Invariante #8): el modelo elige de un SET CERRADO (enum de los
// repos curados que Vaio conoce); el sistema mapea el slug elegido → su RepoSyncSpec. El modelo nunca tipea
// un identificador libre.

import type { RepoSyncSpec } from "../../ports/repo-sync.js"

/** "owner/repo" — el valor del enum que ve el modelo. */
export function repoSlug(r: { owner: string; repo: string }): string {
  return `${r.owner}/${r.repo}`
}

/** Mapea el slug elegido por el modelo → el RepoSyncSpec pre-configurado (o undefined si no matchea). */
export function resolveKnownRepo(
  repos: RepoSyncSpec[],
  slug: string | undefined
): RepoSyncSpec | undefined {
  return repos.find((r) => repoSlug(r) === slug)
}
