// Puertos (contratos) de la memoria del producto. El núcleo (core/agent) depende de
// estas interfaces, no de implementaciones concretas. Hoy el adapter es Neon+pgvector
// (adapters/neon-memory.ts); en fase 3 se puede cambiar a Graphiti sin tocar el core.

import type { DocChunk } from "@vaio/contracts"

export type { DocChunk }

/** Vectoriza textos (un embedding por texto). */
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>
}

/** Store de memoria RAG: búsqueda semántica + escritura idempotente por fuente. */
export interface MemoryStore {
  /** Top-k chunks más cercanos a `query` (similaridad coseno). */
  searchMemory(query: string, k?: number): Promise<DocChunk[]>
  /** Embebe e inserta chunks (el embedding se calcula en el adapter). */
  upsertDocuments(rows: DocChunk[]): Promise<void>
  /** Borra todos los docs de una fuente (para reingestar). */
  clearSource(source: string): Promise<void>
}
