// TODO(fase1): memoria RAG con Neon (driver `pg`) + pgvector.
//
// Esquema:
//   CREATE EXTENSION IF NOT EXISTS vector;
//   CREATE TABLE documents (
//     id bigserial PRIMARY KEY,
//     source text NOT NULL,        -- 'cv' | 'me' | 'github' | 'lastfm' | ...
//     url text,
//     chunk text NOT NULL,
//     embedding vector(N),         -- N = dim del modelo de embeddings
//     updated_at timestamptz DEFAULT now()
//   );
//   CREATE INDEX ON documents USING hnsw (embedding vector_cosine_ops);
//
// API:
//   - embed(text): llama al proveedor de embeddings (EMBEDDINGS_MODEL).
//   - searchMemory(query, k): embed(query) → ORDER BY embedding <=> $1 LIMIT k.
//   - upsertDocuments(rows): inserta/actualiza chunks.
//
// ⚠️ Confirmar operadores pgvector (<=> coseno) y uso del driver `pg` con docs/context7.

export interface DocChunk {
  source: string;
  url: string;
  chunk: string;
}

export async function searchMemory(_query: string, _k = 6): Promise<DocChunk[]> {
  throw new Error("TODO(fase1): implementar searchMemory (Neon + pgvector)");
}

export async function upsertDocuments(_rows: DocChunk[]): Promise<void> {
  throw new Error("TODO(fase1): implementar upsertDocuments");
}
