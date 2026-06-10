// Schema Drizzle de la memoria del producto. La tabla `facts` llega en fase 2.
// El índice HNSW con `vector_cosine_ops` acelera la búsqueda por distancia coseno (<=>).

import {
  bigserial,
  index,
  pgTable,
  text,
  timestamp,
  vector,
} from "drizzle-orm/pg-core"

/** Dimensión del modelo de embeddings (text-embedding-3-small = 1536). Cambiarla
 *  implica una migración (el ancho de la columna `vector(N)` es fijo). */
export const EMBEDDING_DIM = 1536

export const documents = pgTable(
  "documents",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    source: text("source").notNull(), // 'cv' | 'cv-en' | 'me' | 'github' | 'lastfm' | ...
    url: text("url"),
    chunk: text("chunk").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIM }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("documents_embedding_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops")
    ),
    index("documents_source_idx").on(t.source),
  ]
)
