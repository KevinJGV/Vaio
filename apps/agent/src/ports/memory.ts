// Puertos (contratos) de la memoria del producto. El núcleo (core/agent) depende de
// estas interfaces, no de implementaciones concretas. Hoy el adapter es Neon+pgvector
// (adapters/neon-memory.ts); en fase 3 se puede cambiar a Graphiti sin tocar el core.

import type { DocChunk } from "@vaio/contracts"

export type { DocChunk }

/** Vectoriza textos (un embedding por texto). */
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>
}

/** Un archivo ya indexado de un source (manifest derivado de `documents`: 1 por (path, blobSha) distinto).
 *  Es la entrada del diff del sync incremental. */
export interface IndexedFile {
  path: string
  blobSha: string
}

/** Store de memoria RAG: búsqueda semántica + escritura idempotente por fuente, y operaciones por-archivo
 *  para el sync incremental (re-embeber/borrar solo lo cambiado). */
export interface MemoryStore {
  /** Top-k chunks más cercanos a `query` (similaridad coseno). */
  searchMemory(query: string, k?: number): Promise<DocChunk[]>
  /** Embebe e inserta chunks (el embedding se calcula en el adapter). Persiste `path`/`blobSha` si vienen. */
  upsertDocuments(rows: DocChunk[]): Promise<void>
  /** Borra todos los docs de una fuente (para reingestar). */
  clearSource(source: string): Promise<void>
  /** Manifest indexado de un source: 1 fila por (path, blobSha) distinto (ignora filas legacy con path NULL). */
  listIndexedFiles(source: string): Promise<IndexedFile[]>
  /** Borra los chunks de paths concretos de un source (sync incremental). */
  deleteFiles(source: string, paths: string[]): Promise<void>
  /** Reemplaza los chunks de UN archivo (borra (source,path) + embebe + inserta) atómicamente. */
  replaceFile(source: string, path: string, rows: DocChunk[]): Promise<void>
}
