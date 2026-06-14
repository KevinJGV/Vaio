// Schema Drizzle de la memoria del producto: `documents` (RAG) + memoria CONVERSACIONAL
// (`conversations` + `messages`) + `facts` (hechos curados, write-actions con HITL).
// El índice HNSW con `vector_cosine_ops` acelera la búsqueda por distancia coseno (<=>).

import type { TraceEvent } from "@vaio/contracts"
import { sql } from "drizzle-orm"
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

/** Traza persistida del agente: 1 fila por TraceEvent (append-only). Mismos eventos que el sink de stdout
 *  (turn.start/reasoning/tool.call/tool.result/llm.step/turn.finish/turn.error). Habilita debug de
 *  conversaciones / panel futuro. `seq` = orden dentro del turno (los inserts async no garantizan id/time). */
export const traceEvents = pgTable(
  "trace_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    requestId: text("request_id").notNull(),
    // Nullable: los turnos stateless (sin DB de conversación) no traen conversationId. Sin FK dura.
    conversationId: uuid("conversation_id"),
    turnId: text("turn_id").notNull(),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<TraceEvent>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("trace_events_conv_idx").on(t.conversationId, t.id),
    index("trace_events_turn_idx").on(t.turnId, t.seq),
  ]
)

/** Hechos curados sobre Kevin (memoria que se nutre). Una propuesta y un hecho confirmado son la MISMA
 *  fila en distinto `status`. Bi-temporal: valid_at/invalid_at = valid time; created_at/expired_at = tx time.
 *  Invalidar = marcar invalid_at (NUNCA borrar). searchMemory lee solo status='confirmed' AND invalid_at IS NULL. */
export const facts = pgTable(
  "facts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    statement: text("statement").notNull(),
    status: text("status").notNull().default("pending"), // 'pending'|'confirmed'|'rejected'
    embedding: vector("embedding", { dimensions: EMBEDDING_DIM }), // nullable: se llena al confirmar
    principalId: text("principal_id").notNull(),
    channel: text("channel").notNull(),
    conversationId: uuid("conversation_id"),
    turnId: text("turn_id"),
    validAt: timestamp("valid_at", { withTimezone: true }),
    invalidAt: timestamp("invalid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    index("facts_embedding_idx")
      .using("hnsw", t.embedding.op("vector_cosine_ops"))
      .where(sql`${t.status} = 'confirmed' and ${t.invalidAt} is null`),
    index("facts_pending_idx").on(t.principalId, t.status),
  ]
)
