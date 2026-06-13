// Schema Drizzle de la memoria del producto: `documents` (RAG) + memoria CONVERSACIONAL
// (`conversations` + `messages`). La tabla `facts` (extracción semántica) llega en otra iteración.
// El índice HNSW con `vector_cosine_ops` acelera la búsqueda por distancia coseno (<=>).

import {
  bigint,
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core"
import type { StoredAttachment } from "../../ports/conversation.js"

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

/** Memoria conversacional: un hilo por (channel, threadKey). `summary` = resumen rodante de los
 *  turnos viejos; `summarizedUpToMessageId` marca hasta qué mensaje se resumió. */
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    channel: text("channel").notNull(), // 'web' | 'telegram'
    threadKey: text("thread_key").notNull(), // web: conversationId | telegram: chat_id
    locale: text("locale").notNull().default("es"),
    summary: text("summary").notNull().default(""),
    summarizedUpToMessageId: bigint("summarized_up_to_message_id", {
      mode: "number",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("conversations_channel_thread_uq").on(t.channel, t.threadKey),
  ]
)

/** Mensajes de una conversación. `turnId` correlaciona con las trazas y da idempotencia al append
 *  (unique (conversation_id, turn_id, role)). Orden cronológico = por `id` ascendente. */
export const messages = pgTable(
  "messages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    turnId: text("turn_id").notNull(),
    role: text("role").notNull(), // 'user' | 'assistant'
    content: text("content").notNull(),
    // Metadata de adjuntos del turno (texto-derivado va en `content`; acá kind/mediaType/ref/caption).
    // Sin binarios. Default [] → backward-compatible, no necesita backfill.
    attachments: jsonb("attachments")
      .$type<StoredAttachment[]>()
      .default([])
      .notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("messages_conversation_idx").on(t.conversationId, t.id),
    uniqueIndex("messages_turn_role_uq").on(t.conversationId, t.turnId, t.role),
  ]
)
