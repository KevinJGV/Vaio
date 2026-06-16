// Lógica PURA del estado vivo de repos (sin red/DB → unit-testeable). Hoy: parseo + agrupación de los PRs
// abiertos que trae la Search API de GitHub. El I/O (la llamada) vive en el adapter (adapters/sources/owner-repos).

/** Un PR abierto en un repo público del owner (tag `repo` para agrupar/intersectar con el catálogo). */
export interface OpenPR {
  repo: string
  number: number
  title: string
  url: string
}

/** `https://api.github.com/repos/{owner}/{repo}` → "repo" (el último segmento). null si no matchea el patrón. */
export function parseRepoFromUrl(repositoryUrl: string): string | null {
  const m = repositoryUrl.match(/\/repos\/[^/]+\/([^/]+)\/?$/)
  return m?.[1] ?? null
}

/** Agrupa PRs por repo, preservando el orden de aparición (tanto de repos como de PRs dentro de cada repo). */
export function groupPRsByRepo(prs: OpenPR[]): Map<string, OpenPR[]> {
  const byRepo = new Map<string, OpenPR[]>()
  for (const pr of prs) {
    const list = byRepo.get(pr.repo)
    if (list) list.push(pr)
    else byRepo.set(pr.repo, [pr])
  }
  return byRepo
}
