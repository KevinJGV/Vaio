// Lógica PURA del sync incremental de repos (sin red/DB → unit-testeable). Compara el árbol actual del repo
// (con blob-SHA por archivo, que GitHub da sin bajar contenido) contra lo ya indexado, y decide qué re-embeber
// y qué borrar — minimizando el costo dominante (embeddings). La frescura barata se decide acá; la llamada HTTP
// vive en el adapter. Reusa `filterTree` (la verdad de "qué DEBE estar indexado").

import type { IndexedFile } from "../ports/memory.js"
import {
  filterTree,
  type RepoIngestPolicy,
  type TreeEntry,
} from "./repo-ingest.js"

export type { IndexedFile }

/** Plan de diff: qué bajar+embeber, qué borrar. Derivado SOLO de árbol + manifest + policy. */
export interface RepoDiff {
  /** Nuevos o con blob-SHA distinto (ya pasados por filterTree). */
  toEmbed: TreeEntry[]
  /** Paths indexados que ya no deben estar (borrados, renombrados, o ahora filtrados). */
  toDelete: string[]
  /** Métrica: archivos kept cuyo SHA coincide con el indexado (se dejan intactos). */
  unchanged: number
}

/**
 * Diff PURO (sin fetch). Cambio = blob-SHA del árbol distinto al indexado.
 *   1. filterTree(tree, policy) → kept = lo que DEBE estar indexado ahora.
 *   2. manifest indexado → Map<path, blobSha>.
 *   3. cada kept: ausente del manifest → toEmbed (nuevo); SHA distinto → toEmbed (cambiado); igual → unchanged.
 *   4. toDelete = paths del manifest que NO están en kept (borrado / rename / ahora filtrado).
 * El cap por repo (maxChunksPerRepo) NO se aplica acá (es runtime al embeber).
 */
export function diffRepoTree(
  currentTree: TreeEntry[],
  indexed: IndexedFile[],
  policy: RepoIngestPolicy
): RepoDiff {
  const { kept } = filterTree(currentTree, policy)
  const manifest = new Map(indexed.map((f) => [f.path, f.blobSha]))
  const keptPaths = new Set(kept.map((e) => e.path))

  const toEmbed: TreeEntry[] = []
  let unchanged = 0
  for (const entry of kept) {
    const indexedSha = manifest.get(entry.path)
    if (indexedSha === undefined || indexedSha !== entry.sha) {
      toEmbed.push(entry)
    } else {
      unchanged++
    }
  }

  const toDelete = indexed
    .map((f) => f.path)
    .filter((path) => !keptPaths.has(path))

  return { toEmbed, toDelete, unchanged }
}

export type FreshnessState = "fresh" | "stale" | "untracked"

export interface FreshnessResult {
  state: FreshnessState
  remoteCommitSha: string
  storedCommitSha?: string
}

/** Compara el HEAD remoto contra el último sincronizado. `untracked` = nunca sincronizado (sin SHA guardado)
 *  → primer sync = full. La LLAMADA que trae `remoteCommitSha` vive en el adapter; la decisión es pura. */
export function compareFreshness(
  remoteCommitSha: string,
  storedCommitSha: string | null | undefined
): FreshnessResult {
  if (!storedCommitSha) {
    return { state: "untracked", remoteCommitSha }
  }
  return {
    state: remoteCommitSha === storedCommitSha ? "fresh" : "stale",
    remoteCommitSha,
    storedCommitSha,
  }
}

/** ¿El sync entra "inline" en un turno de chat (rápido) o conviene background (largo)? Heurística por nº de
 *  archivos a embeber: pocos → segundos → inline; muchos → background. `maxFiles` configurable. */
export function isInlineSync(diff: RepoDiff, maxFiles: number): boolean {
  return diff.toEmbed.length <= maxFiles
}

/**
 * Cobertura: paths que DEBERÍAN estar indexados pero NO lo están (kept − indexados − tombstones). Mide la
 * verdad de terreno de "¿el índice de este repo está completo?", independiente de la frescura por SHA: un repo
 * cap-bajo (lo cortó `maxChunksPerRepo`) tiene el commit-SHA correcto pero archivos enteros sin un solo chunk.
 * Medida EXACTA, sin umbral: todo archivo `kept` no-tombstoned debería tener ≥1 chunk; si falta del manifest,
 * lo dropeó el cap. PURO (sin red/DB). El caller decide qué hacer con árbol truncado (ausencia ≠ falta → no
 * llamar / ignorar). Reusa `filterTree` (la verdad de "qué DEBE estar indexado ahora").
 */
export function coverageGap(
  currentTree: TreeEntry[],
  indexed: IndexedFile[],
  skipped: { path: string }[],
  policy: RepoIngestPolicy
): string[] {
  const { kept } = filterTree(currentTree, policy)
  const have = new Set(indexed.map((f) => f.path))
  const tomb = new Set(skipped.map((s) => s.path))
  return kept
    .map((e) => e.path)
    .filter((path) => !have.has(path) && !tomb.has(path))
}
