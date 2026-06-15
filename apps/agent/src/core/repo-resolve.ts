// Resolución PURA (sin I/O) de un NOMBRE de repo tipeado por el modelo contra la lista REAL de repos públicos
// del owner. Es el corazón de la excepción al Invariante #8 para `learnRepo`: el modelo pasa un string de baja
// cardinalidad y el sistema lo VALIDA acá (match claro → procede; ambiguo → desambiguar; sin match → fallo
// visible con sugerencias). Nunca asume: un nombre que no resuelve limpio NO se ingiere.

/** Repo público del owner (ya filtrado por el adapter). `name` = slug de GitHub; `defaultBranch` para el sync. */
export interface OwnerRepo {
  name: string
  defaultBranch: string
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
