// Adapter de memoria: implementa MemoryStore con Drizzle + pgvector sobre Neon.
// Búsqueda por distancia coseno (cosineDistance → operador <=>); el orden ascendente
// de distancia = más similar primero.

import { cosineDistance, eq } from "drizzle-orm";
import type { DocChunk, Embedder, MemoryStore } from "../ports/memory.js";
import type { Database } from "./db/client.js";
import { documents } from "./db/schema.js";

export function createMemoryStore(db: Database, embedder: Embedder): MemoryStore {
  return {
    async searchMemory(query: string, k = 6): Promise<DocChunk[]> {
      const [qEmb] = await embedder.embed([query]);
      if (!qEmb) return [];
      const rows = await db
        .select({
          source: documents.source,
          url: documents.url,
          chunk: documents.chunk,
        })
        .from(documents)
        .orderBy(cosineDistance(documents.embedding, qEmb))
        .limit(k);
      return rows.map((r) => ({ source: r.source, url: r.url ?? "", chunk: r.chunk }));
    },

    async upsertDocuments(rows: DocChunk[]): Promise<void> {
      if (rows.length === 0) return;
      const embeddings = await embedder.embed(rows.map((r) => r.chunk));
      const values = rows.map((r, i) => {
        const embedding = embeddings[i];
        if (!embedding) throw new Error("Embeddings desalineados con los chunks.");
        return { source: r.source, url: r.url, chunk: r.chunk, embedding };
      });
      await db.insert(documents).values(values);
    },

    async clearSource(source: string): Promise<void> {
      await db.delete(documents).where(eq(documents.source, source));
    },
  };
}
