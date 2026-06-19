import { describe, expect, it } from "vitest"
import type { EscalationOrigin } from "../src/ports/escalation.js"
import { inMemoryEscalations } from "./fakes/in-memory-escalations.js"

const origin = (over: Partial<EscalationOrigin> = {}): EscalationOrigin => ({
  channel: "telegram",
  conversationId: "c1",
  threadKey: "555",
  askerPrincipalId: "visitor1",
  locale: "es",
  ...over,
})

describe("EscalationStore (contrato, vía fake)", () => {
  it("create → pending; markNotified guarda canal+message_id; findByNotifyMessage lo trae", async () => {
    const es = inMemoryEscalations()
    const { id } = await es.create({ question: "¿X?", origin: origin() })
    // antes de notificar no correlaciona
    expect(await es.findByNotifyMessage("telegram", "42")).toBeNull()
    await es.markNotified(id, "telegram", "42")
    const found = await es.findByNotifyMessage("telegram", "42")
    expect(found?.id).toBe(id)
    expect(found?.question).toBe("¿X?")
    expect(found?.origin.askerPrincipalId).toBe("visitor1")
  })

  it("markAnswered idempotente; tras 'answered' ya NO correlaciona (Kevin puede continuar en el hilo)", async () => {
    const es = inMemoryEscalations()
    const { id } = await es.create({
      question: "¿Y?",
      kind: "knowledge",
      origin: origin(),
    })
    await es.markNotified(id, "telegram", "7")
    // mientras está 'notified' correlaciona (la 1ª respuesta del owner se procesa)
    expect(await es.findByNotifyMessage("telegram", "7")).not.toBeNull()
    expect(await es.markAnswered(id, "la respuesta")).toBe(true)
    // 2º markAnswered (retry) no afecta filas
    expect(await es.markAnswered(id, "otra")).toBe(false)
    // tras 'answered' ya NO correlaciona → los mensajes siguientes en el hilo son turno normal (continúa la charla)
    expect(await es.findByNotifyMessage("telegram", "7")).toBeNull()
  })

  it("findResolvedByTopic (Inc 2): solo tras 'answered' trae origen+answer+factId del hilo", async () => {
    const es = inMemoryEscalations()
    const { id } = await es.create({
      question: "¿toca el piano?",
      kind: "knowledge",
      origin: origin(),
    })
    await es.markNotified(id, "telegram", "99", "topic-7")
    // mientras está 'notified' NO es un hilo resuelto (lo maneja el inbound, no la conciencia)
    expect(await es.findResolvedByTopic("telegram", "topic-7")).toBeNull()
    await es.markAnswered(id, "sí, desde chico")
    await es.linkFact(id, "fact-123")
    const to = await es.findResolvedByTopic("telegram", "topic-7")
    expect(to?.question).toBe("¿toca el piano?")
    expect(to?.answer).toBe("sí, desde chico")
    expect(to?.factId).toBe("fact-123")
    // origen del visitante (para updateVisitor): canal + conversationKey (threadKey) + locale
    expect(to?.visitor).toEqual({
      channel: "telegram",
      conversationKey: "555",
      locale: "es",
    })
    // topic ajeno → null
    expect(await es.findResolvedByTopic("telegram", "otro")).toBeNull()
  })

  it("markFailed solo desde pending; no correlaciona", async () => {
    const es = inMemoryEscalations()
    const { id } = await es.create({ question: "¿Z?", origin: origin() })
    await es.markFailed(id)
    expect(await es.findByNotifyMessage("telegram", "1")).toBeNull()
  })

  it("countOpenByPrincipal cuenta pending+notified, no answered/failed", async () => {
    const es = inMemoryEscalations()
    const a = await es.create({ question: "a", origin: origin() })
    await es.create({ question: "b", origin: origin() })
    await es.markNotified(a.id, "telegram", "10")
    await es.markAnswered(a.id, "ok") // a → answered
    expect(await es.countOpenByPrincipal("visitor1")).toBe(1) // solo "b" (pending)
    expect(await es.countOpenByPrincipal("otro")).toBe(0)
  })

  it("findOpenDuplicate matchea por texto normalizado del mismo principal; no de otro", async () => {
    const es = inMemoryEscalations()
    await es.create({ question: "¿Cuál es su stack?", origin: origin() })
    expect(
      (await es.findOpenDuplicate("visitor1", "  ¿cuál ES  su   stack?  "))?.id
    ).toBeTruthy()
    expect(await es.findOpenDuplicate("visitor1", "otra cosa")).toBeNull()
    expect(await es.findOpenDuplicate("otro", "¿Cuál es su stack?")).toBeNull()
  })
})
