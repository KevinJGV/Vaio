// Resolución PURA (sin I/O) de un NOMBRE de repo tipeado por el modelo contra la lista REAL de repos públicos
// del owner. Es el corazón de la excepción al Invariante #8 para `learnRepo`: el modelo pasa un string de baja
// cardinalidad y el sistema lo VALIDA acá (match claro → procede; ambiguo → desambiguar; sin match → fallo
// visible con sugerencias). Nunca asume: un nombre que no resuelve limpio NO se ingiere.

/** Repo público del owner (ya filtrado por el adapter). `name` = slug de GitHub; `defaultBranch` para el sync.
 *  Campos de metadata (opcionales): los usa `findRepos` (filtrar por lenguaje/topic) y futuros consumidores. */
export interface OwnerRepo {
  name: string
  defaultBranch: string
  language?: string | null
  topics?: string[]
  description?: string | null
  stars?: number
}

export type RepoResolution =
  | { kind: "match"; repo: OwnerRepo }
  | { kind: "ambiguous"; candidates: OwnerRepo[] }
  | { kind: "none"; suggestions: string[] }

/** Máximo de candidatos/sugerencias a devolver (no inundar al modelo). */
const MAX_SUGGESTIONS = 5
/** Distancia de edición máxima (sobre el nombre normalizado) para sugerir un repo en el caso `none`. */
const SUGGEST_MAX_DISTANCE = 3

/** lowercase + elimina separadores (`-`, `_`, `.`, espacios) → comparación case/separador-insensitive. */
export function normalizeRepoName(s: string): string {
  return s.toLowerCase().replace(/[-_.\s]+/g, "")
}

/** Levenshtein clásico (para ranquear sugerencias en el fallo visible). */
function editDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  let curr = new Array<number>(n + 1)
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (curr[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost
      )
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n] ?? 0
}

/**
 * Resuelve un nombre tipeado contra la lista real. Prioridad:
 *   1. Exacto normalizado único → match (gana sobre substring; "sin doble confirmación" si es inequívoco).
 *   2. Varios exactos normalizados → ambiguous (defensivo; raro con un solo owner).
 *   3. Un solo substring (norm ⊂ repo o repo ⊂ norm) → match. Varios → ambiguous.
 *   4. Ninguno → none + sugerencias cercanas por edit-distance (≤ SUGGEST_MAX_DISTANCE).
 */
export function resolveRepoName(
  name: string,
  repos: OwnerRepo[]
): RepoResolution {
  if (repos.length === 0) return { kind: "none", suggestions: [] }
  const norm = normalizeRepoName(name)
  if (norm.length === 0) return { kind: "none", suggestions: [] }

  const exact = repos.filter((r) => normalizeRepoName(r.name) === norm)
  if (exact.length === 1) return { kind: "match", repo: exact[0] as OwnerRepo }
  if (exact.length > 1)
    return { kind: "ambiguous", candidates: exact.slice(0, MAX_SUGGESTIONS) }

  const substr = repos.filter((r) => {
    const rn = normalizeRepoName(r.name)
    return rn.includes(norm) || norm.includes(rn)
  })
  if (substr.length === 1)
    return { kind: "match", repo: substr[0] as OwnerRepo }
  if (substr.length > 1)
    return { kind: "ambiguous", candidates: substr.slice(0, MAX_SUGGESTIONS) }

  const suggestions = repos
    .map((r) => ({
      name: r.name,
      d: editDistance(norm, normalizeRepoName(r.name)),
    }))
    .filter((x) => x.d <= SUGGEST_MAX_DISTANCE)
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX_SUGGESTIONS)
    .map((x) => x.name)
  return { kind: "none", suggestions }
}

/**
 * Repos del catálogo cuyo NOMBRE aparece en la query. CONSERVADOR (para no falsos positivos):
 *   (1) un token de la query == el nombre normalizado COMPLETO de un repo, o
 *   (2) un token == un SEGMENTO normalizado DISTINTIVO (aparece en UN solo repo del catálogo, len ≥ 4) →
 *       catchea multi-palabra "Tastrack"→"Tastrack_Challenge" sin disparar con segmentos comunes
 *       ("work"/"project"/"sql", que aparecen en varios). PURO.
 */
export function reposNamedInQuery(
  query: string,
  repos: OwnerRepo[]
): OwnerRepo[] {
  if (repos.length === 0) return []
  const tokens = new Set(
    query
      .split(/[^\p{L}\p{N}]+/u)
      .map(normalizeRepoName)
      .filter((t) => t.length >= 3)
  )
  if (tokens.size === 0) return []
  // Frecuencia de cada segmento normalizado a través del catálogo → distintividad (segmento de UN solo repo).
  const segCount = new Map<string, number>()
  const repoSegs = repos.map((r) => {
    const segs = r.name
      .split(/[-_.\s]+/)
      .map(normalizeRepoName)
      .filter((s) => s.length > 0)
    for (const s of new Set(segs)) segCount.set(s, (segCount.get(s) ?? 0) + 1)
    return segs
  })
  const out: OwnerRepo[] = []
  repos.forEach((r, i) => {
    const exact = tokens.has(normalizeRepoName(r.name))
    const distinctiveSeg =
      !exact &&
      (repoSegs[i] ?? []).some(
        (s) => s.length >= 4 && segCount.get(s) === 1 && tokens.has(s)
      )
    if (exact || distinctiveSeg) out.push(r)
  })
  return out
}
