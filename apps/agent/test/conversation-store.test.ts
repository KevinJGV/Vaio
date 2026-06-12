import { describe, expect, it } from "vitest"
import { createInMemoryConversationStore } from "./fakes/in-memory-conversation.js"

describe("ConversationStore (contrato, vía fake in-memory)", () => {
  it("ensure devuelve id estable para el mismo (channel, threadKey)", async () => {
    const s = createInMemoryConversationStore()
    const a = await s.ensure("telegram", "chat-1", "es")
    const b = await s.ensure("telegram", "chat-1", "es")
    const c = await s.ensure("telegram", "chat-2", "es")
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it("appendTurn + loadContext: recientes en orden cronológico + messageCount", async () => {
    const s = createInMemoryConversationStore()
    const id = await s.ensure("web", "t", "es")
    await s.appendTurn(id, "turn-1", { user: "hola", assistant: "qué tal" })
    await s.appendTurn(id, "turn-2", { user: "bien", assistant: "genial" })
    const ctx = await s.loadContext(id, 10)
    expect(ctx.messageCount).toBe(4)
    expect(ctx.recent.map((m) => m.content)).toEqual([
      "hola",
      "qué tal",
      "bien",
      "genial",
    ])
  })

  it("loadContext respeta recentLimit (últimos K)", async () => {
    const s = createInMemoryConversationStore()
    const id = await s.ensure("web", "t", "es")
    await s.appendTurn(id, "t1", { user: "u1", assistant: "a1" })
    await s.appendTurn(id, "t2", { user: "u2", assistant: "a2" })
    const ctx = await s.loadContext(id, 2)
    expect(ctx.recent.map((m) => m.content)).toEqual(["u2", "a2"])
    expect(ctx.messageCount).toBe(4)
  })

  it("appendTurn es idempotente por (turnId, role)", async () => {
    const s = createInMemoryConversationStore()
    const id = await s.ensure("web", "t", "es")
    await s.appendTurn(id, "turn-1", { user: "hola", assistant: "qué tal" })
    await s.appendTurn(id, "turn-1", { user: "hola", assistant: "qué tal" })
    const ctx = await s.loadContext(id, 10)
    expect(ctx.messageCount).toBe(2)
  })

  it("pendingSummary: mensajes fuera de la ventana y no resumidos; updateSummary los marca", async () => {
    const s = createInMemoryConversationStore()
    const id = await s.ensure("web", "t", "es")
    await s.appendTurn(id, "t1", { user: "u1", assistant: "a1" })
    await s.appendTurn(id, "t2", { user: "u2", assistant: "a2" })
    await s.appendTurn(id, "t3", { user: "u3", assistant: "a3" })
    // recentLimit 2 → quedan fuera 4 mensajes (u1,a1,u2,a2)
    const pend = await s.pendingSummary(id, 2)
    expect(pend.messages.map((m) => m.content)).toEqual([
      "u1",
      "a1",
      "u2",
      "a2",
    ])
    expect(pend.upToMessageId).toBeGreaterThan(0)

    await s.updateSummary(id, "resumen", pend.upToMessageId)
    const after = await s.pendingSummary(id, 2)
    expect(after.messages).toEqual([])
    expect((await s.loadContext(id, 10)).summary).toBe("resumen")
  })
})
