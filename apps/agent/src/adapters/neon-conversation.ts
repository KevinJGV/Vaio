// Adapter de memoria conversacional: implementa ConversationStore con Drizzle sobre Neon.
// ensure = upsert por (channel, thread_key); loadContext = summary + últimos K (cronológico) + count;
// appendTurn = inserta user+assistant idempotente por (conversation_id, turn_id, role); pendingSummary
// = mensajes fuera de la ventana reciente y aún no resumidos (insumo del resumen rodante).

import type { Channel } from "@vaio/contracts"
import { and, asc, count, desc, eq, gt, lt, sql } from "drizzle-orm"
import type {
  ConversationContext,
  ConversationStore,
  TurnRecord,
} from "../ports/conversation.js"
import type { Database } from "./db/client.js"
import { conversations, messages } from "./db/schema.js"

export function createConversationStore(db: Database): ConversationStore {
  return {
    async ensure(channel: Channel, threadKey: string, locale: string) {
      const [row] = await db
        .insert(conversations)
        .values({ channel, threadKey, locale })
        .onConflictDoUpdate({
          target: [conversations.channel, conversations.threadKey],
          set: { updatedAt: sql`now()` },
        })
        .returning({ id: conversations.id })
      if (!row)
        throw new Error("ensure: no se pudo crear/obtener la conversación")
      return row.id
    },

    async loadContext(
      conversationId: string,
      recentLimit: number
    ): Promise<ConversationContext> {
      const [conv] = await db
        .select({ summary: conversations.summary })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
      if (!conv) {
        return { conversationId, summary: "", recent: [], messageCount: 0 }
      }
      const recentDesc = await db
        .select({ role: messages.role, content: messages.content })
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(desc(messages.id))
        .limit(recentLimit)
      const [counted] = await db
        .select({ value: count() })
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
      const recent = recentDesc.reverse().map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }))
      return {
        conversationId,
        summary: conv.summary,
        recent,
        messageCount: counted?.value ?? 0,
      }
    },

    async appendTurn(conversationId: string, turnId: string, rec: TurnRecord) {
      await db
        .insert(messages)
        .values([
          {
            conversationId,
            turnId,
            role: "user",
            content: rec.user,
          },
          {
            conversationId,
            turnId,
            role: "assistant",
            content: rec.assistant,
            inputTokens: rec.usage?.inputTokens,
            outputTokens: rec.usage?.outputTokens,
            totalTokens: rec.usage?.totalTokens,
          },
        ])
        .onConflictDoNothing()
      await db
        .update(conversations)
        .set({ updatedAt: sql`now()` })
        .where(eq(conversations.id, conversationId))
    },

    async pendingSummary(conversationId: string, recentLimit: number) {
      const [conv] = await db
        .select({ upTo: conversations.summarizedUpToMessageId })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
      const summarizedUpTo = conv?.upTo ?? 0
      // Frontera de la ventana reciente: el id más chico entre los últimos `recentLimit` mensajes.
      const recentIds = await db
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(desc(messages.id))
        .limit(recentLimit)
      const boundary = recentIds.at(-1)?.id
      if (boundary === undefined) return { messages: [], upToMessageId: 0 }
      const older = await db
        .select({
          id: messages.id,
          role: messages.role,
          content: messages.content,
        })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            gt(messages.id, summarizedUpTo),
            lt(messages.id, boundary)
          )
        )
        .orderBy(asc(messages.id))
      const last = older.at(-1)
      if (!last) return { messages: [], upToMessageId: 0 }
      return {
        messages: older.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        upToMessageId: last.id,
      }
    },

    async updateSummary(
      conversationId: string,
      summary: string,
      summarizedUpToMessageId: number
    ) {
      await db
        .update(conversations)
        .set({ summary, summarizedUpToMessageId, updatedAt: sql`now()` })
        .where(eq(conversations.id, conversationId))
    },
  }
}
