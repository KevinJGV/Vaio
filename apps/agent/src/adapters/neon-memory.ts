// Adapter de memoria: implementa MemoryStore con Drizzle + pgvector sobre Neon.
// Búsqueda por distancia coseno (cosineDistance → operador <=>); el orden ascendente
// de distancia = más similar primero.

import {
  and,
  asc,
  cosineDistance,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
} from "drizzle-orm"
import type { Logger } from "../ports/logger.js"
import type {
  DocChunk,
  Embedder,
  IndexedFile,
  MemoryStore,
} from "../ports/memory.js"
import type { Database } from "./db/client.js"
import { documents, facts } from "./db/schema.js"

export function createMemoryStore(
  db: Database,
  embedder: Embedder,
  logger?: Logger
): MemoryStore {
  return {
    async searchMemory(query: string, k = 6): Promise<DocChunk[]> {
      const [qEmb] = await embedder.embed([query])
      if (!qEmb) {
        // Embeddings de la query vacío → RAG sin resultados. No es fatal (el agente responde sin RAG),
        // pero antes era invisible: dejamos rastro de por qué la memoria no devolvió nada.
        logger?.warn(
          {},
          "searchMemory: embedding de la query vacío → sin resultados"
        )
        return []
      }
      // Solo DOCUMENTOS. Los facts se recuperan aparte (searchFacts) para no competir con los chunks del repo.
      const rows = await db
        .select({
          source: documents.source,
          url: documents.url,
          chunk: documents.chunk,
          dist: cosineDistance(documents.embedding, qEmb).as("dist"),
        })
        .from(documents)
        .orderBy(asc(sql`dist`))
        .limit(k)
      return rows.map((r) => ({
        source: r.source,
        url: r.url ?? "",
        chunk: r.chunk,
      }))
    },

    async searchFacts(
      query: string,
      opts?: { k?: number; maxDistance?: number }
    ): Promise<DocChunk[]> {
      const k = opts?.k ?? 4
      const [qEmb] = await embedder.embed([query])
      if (!qEmb) return []
      const dist = cosineDistance(facts.embedding, qEmb)
      const where =
        opts?.maxDistance != null
          ? and(
              eq(facts.status, "confirmed"),
              isNull(facts.invalidAt),
              lt(dist, opts.maxDistance)
            )
          : and(eq(facts.status, "confirmed"), isNull(facts.invalidAt))
      const rows = await db
        .select({ chunk: facts.statement, dist: dist.as("dist") })
        .from(facts)
        .where(where)
        .orderBy(asc(sql`dist`))
        .limit(k)
      // source "fact" / sin url (el modelo ve "una sola memoria"; el grounding ya distingue facts vs repo).
      return rows.map((r) => ({ source: "fact", url: "", chunk: r.chunk }))
    },

    async getBySource(source: string): Promise<DocChunk[]> {
      const rows = await db
        .select({
          source: documents.source,
          url: documents.url,
          chunk: documents.chunk,
        })
        .from(documents)
        .where(eq(documents.source, source))
      return rows.map((r) => ({
        source: r.source,
        url: r.url ?? "",
        chunk: r.chunk,
      }))
    },

    async upsertDocuments(rows: DocChunk[]): Promise<void> {
      if (rows.length === 0) return
      const embeddings = await embedder.embed(rows.map((r) => r.chunk))
      const values = rows.map((r, i) => {
        const embedding = embeddings[i]
        if (!embedding)
          throw new Error("Embeddings desalineados con los chunks.")
        return {
          source: r.source,
          url: r.url,
          chunk: r.chunk,
          path: r.path ?? null,
          blobSha: r.blobSha ?? null,
          embedding,
        }
      })
      await db.insert(documents).values(values)
    },

    async clearSource(source: string): Promise<void> {
      await db.delete(documents).where(eq(documents.source, source))
    },

    async listIndexedFiles(source: string): Promise<IndexedFile[]> {
      // Manifest = el propio `documents` (DISTINCT path,blob_sha). Ignora filas legacy con path/blob_sha NULL
      // (esos repos se tratan como "no indexados" → el primer sync incremental los re-embebe = full).
      const rows = await db
        .selectDistinct({ path: documents.path, blobSha: documents.blobSha })
        .from(documents)
        .where(
          and(
            eq(documents.source, source),
            isNotNull(documents.path),
            isNotNull(documents.blobSha)
          )
        )
      return rows.flatMap((r) =>
        r.path && r.blobSha ? [{ path: r.path, blobSha: r.blobSha }] : []
      )
    },

    async deleteFiles(source: string, paths: string[]): Promise<void> {
      if (paths.length === 0) return
      await db
        .delete(documents)
        .where(
          and(eq(documents.source, source), inArray(documents.path, paths))
        )
    },

    async replaceFile(
      source: string,
      path: string,
      rows: DocChunk[]
    ): Promise<void> {
      // Atómico: borra los chunks del archivo y reinserta los nuevos en una sola tx (si el embed falla,
      // el delete se revierte → nunca queda el archivo a medias).
      await db.transaction(async (tx) => {
        await tx
          .delete(documents)
          .where(and(eq(documents.source, source), eq(documents.path, path)))
        if (rows.length === 0) return
        const embeddings = await embedder.embed(rows.map((r) => r.chunk))
        const values = rows.map((r, i) => {
          const embedding = embeddings[i]
          if (!embedding)
            throw new Error("Embeddings desalineados con los chunks.")
          return {
            source: r.source,
            url: r.url,
            chunk: r.chunk,
            path: r.path ?? null,
            blobSha: r.blobSha ?? null,
            embedding,
          }
        })
        await tx.insert(documents).values(values)
      })
    },
  }
}
