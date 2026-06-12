// Fake in-memory del puerto ConversationStore para tests del core (sin DB). Implementa el mismo
// contrato que el adapter Neon: getOrCreate por (channel, threadKey), historial, resumen rodante.

import type { Channel } from "@vaio/contracts"
import type {
  ConversationContext,
  ConversationStore,
  StoredMessage,
  TurnRecord,
} from "../../src/ports/conversation.js"

interface Msg extends StoredMessage {
  id: number
  turnId: string
}
interface Conv {
  id: string
  summary: string
  summarizedUpTo: number
  messages: Msg[]
}

export function createInMemoryConversationStore(): ConversationStore {
  const byKey = new Map<string, string>()
  const byId = new Map<string, Conv>()
  let convSeq = 0
  let msgSeq = 0

  return {
    async ensure(channel: Channel, threadKey: string, _locale: string) {
      const key = `${channel}::${threadKey}`
      const existing = byKey.get(key)
      if (existing) return existing
      const id = `conv-${++convSeq}`
      byKey.set(key, id)
      byId.set(id, { id, summary: "", summarizedUpTo: 0, messages: [] })
      return id
    },

    async loadContext(
      conversationId: string,
      recentLimit: number
    ): Promise<ConversationContext> {
      const c = byId.get(conversationId)
      if (!c)
        return { conversationId, summary: "", recent: [], messageCount: 0 }
      const recent = c.messages
        .slice(-recentLimit)
        .map((m) => ({ role: m.role, content: m.content }))
      return {
        conversationId,
        summary: c.summary,
        recent,
        messageCount: c.messages.length,
      }
    },

    async appendTurn(conversationId: string, turnId: string, rec: TurnRecord) {
      const c = byId.get(conversationId)
      if (!c) return
      const has = (role: StoredMessage["role"]) =>
        c.messages.some((m) => m.turnId === turnId && m.role === role)
      if (!has("user"))
        c.messages.push({
          id: ++msgSeq,
          role: "user",
          content: rec.user,
          turnId,
        })
      if (!has("assistant"))
        c.messages.push({
          id: ++msgSeq,
          role: "assistant",
          content: rec.assistant,
          turnId,
        })
    },

    async pendingSummary(conversationId: string, recentLimit: number) {
      const c = byId.get(conversationId)
      if (!c) return { messages: [], upToMessageId: 0 }
      const olderCount = Math.max(0, c.messages.length - recentLimit)
      const older = c.messages
        .slice(0, olderCount)
        .filter((m) => m.id > c.summarizedUpTo)
      const last = older.at(-1)
      if (!last) return { messages: [], upToMessageId: 0 }
      return {
        messages: older.map((m) => ({ role: m.role, content: m.content })),
        upToMessageId: last.id,
      }
    },

    async updateSummary(
      conversationId: string,
      summary: string,
      summarizedUpToMessageId: number
    ) {
      const c = byId.get(conversationId)
      if (!c) return
      c.summary = summary
      c.summarizedUpTo = summarizedUpToMessageId
    },
  }
}
