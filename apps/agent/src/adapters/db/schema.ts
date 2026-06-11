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

/** Dimensión de los embeddings. `gemini-embedding-2` da 3072 nativo, pero el índice HNSW de
 *  pgvector está limitado a 2000 dims para el tipo `vector` → truncamos a 1536 vía Matryoshka
 *  (sin pérdida de calidad, mitad de storage). El adapter pide `dimensions: 1536` al modelo.
 *  (Para 3072 completos habría que usar `halfvec(3072)`, indexable hasta 4000.)
 *  Cambiar este valor implica regenerar la migración (el ancho de `vector(N)` es fijo). */
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
