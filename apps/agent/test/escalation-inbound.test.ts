import { describe, expect, it, vi } from "vitest"
import { tryHandleEscalationReply } from "../src/adapters/telegram/escalation-inbound.js"
import {
  type NormalizeResult,
  normalizeUpdate,
} from "../src/adapters/telegram/normalize.js"
import type {
  ConflictJudge,
  ConflictVerdict,
} from "../src/ports/conflict-judge.js"
import type { EscalationOrigin } from "../src/ports/escalation.js"
import type { FactDecomposer } from "../src/ports/fact-decomposer.js"
import type { ConflictCandidate, FactStore } from "../src/ports/facts.js"
import type { LogFields, Logger } from "../src/ports/logger.js"
import type {
  ConversationResumer,
  ResumeConversationInput,
} from "../src/ports/proactive.js"
import { inMemoryEscalations } from "./fakes/in-memory-escalations.js"

type Turn = Extract<NormalizeResult, { kind: "turn" }>

function noopLogger(): Logger {
  const noop = (_a: LogFields | string, _b?: string): void => {}
  const l: Logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => l,
  }
  return l
}

function fakeClient(sent: { chatId: number; text: string }[]) {
  return {
    sendMessage: async (chatId: number, text: string) => {
      sent.push({ chatId, text })
      return 1
    },
  } as never
}

function fakeResumer(
  calls: ResumeConversationInput[],
  delivered = true
): ConversationResumer {
  return {
    resumeConversation: async (input) => {
      calls.push(input)
      return { delivered }
    },
  }
}

/** Fake FactStore: registra commits/rejects/invalidates. `conflict` → propose devuelve un candidato cercano;
 *  `near` → lo que devuelve findConfirmedNear (camino middleware-siempre). */
function fakeFactStore(
  opts: { conflict?: boolean; near?: ConflictCandidate[] } = {}
): FactStore & {
  committed: { id: string; supersedes?: string[] }[]
  proposed: string[]
  rejected: string[]
  invalidated: string[]
} {
  const committed: { id: string; supersedes?: string[] }[] = []
  const proposed: string[] = []
  const rejected: string[] = []
  const invalidated: string[] = []
  let n = 0
  return {
    committed,
    proposed,
    rejected,
    invalidated,
    async propose({ statement }) {
      const id = `f${++n}`
      proposed.push(statement)
      return {
        id,
        conflicts: opts.conflict
          ? [{ id: "old", statement: "dato viejo", validAt: null }]
          : [],
      }
    },
    async commit(id, o) {
      committed.push({ id, supersedes: o?.supersedes })
      return true
    },
    async reject(id) {
      rejected.push(id)
      return true
    },
    async listPending() {
      return []
    },
    async invalidate(id) {
      invalidated.push(id)
      return true
    },
    async findConfirmedNear() {
      return opts.near ?? []
    },
  }
}

/** Fake FactDecomposer: devuelve los átomos fijos (lista vacía = nada factual/sensible). */
function fakeDecomposer(statements: string[]): FactDecomposer {
  return { decompose: async () => ({ statements }) }
}

/** Fake ConflictJudge: marca TODOS los candidatos con el mismo veredicto (suficiente para los casos del test). */
function fakeJudge(verdict: ConflictVerdict): ConflictJudge {
  return {
    judge: async ({ candidates }) => ({
      decisions: candidates.map((c) => ({ ordinal: c.ordinal, verdict })),
    }),
  }
}

const ownerReply = (over: Partial<Turn> = {}): Turn => ({
  kind: "turn",
  updateId: 1,
  chatId: 1000, // DM de Kevin
  fromId: 1000,
  text: "Trabaja en ClonAI, decile que me escriba.",
  attachments: [],
  locale: "es",
  isPrivate: true,
  replyToMessageId: 42,
  ...over,
})

const tgOrigin = (): EscalationOrigin => ({
  channel: "telegram",
  conversationId: "c1",
  threadKey: "555", // chat del visitante
  askerPrincipalId: "555",
  locale: "es",
})

describe("normalize: reply_to_message", () => {
  it("expone replyToMessageId cuando el update es un reply", () => {
    const r = normalizeUpdate(
      {
        update_id: 9,
        message: {
          message_id: 5,
          text: "ok",
          chat: { id: 1, type: "private" },
          from: { id: 1 },
          reply_to_message: { message_id: 42 },
        },
      },
      new Set()
    )
    expect(r.kind).toBe("turn")
    if (r.kind === "turn") expect(r.replyToMessageId).toBe(42)
  })

  it("sin reply → replyToMessageId undefined", () => {
    const r = normalizeUpdate(
      {
        update_id: 9,
        message: {
          message_id: 5,
          text: "ok",
          chat: { id: 1, type: "private" },
          from: { id: 1 },
        },
      },
      new Set()
    )
    if (r.kind === "turn") expect(r.replyToMessageId).toBeUndefined()
  })
})

describe("tryHandleEscalationReply", () => {
  it("reply que matchea una escalada (origen telegram) → answered + retomo al visitante + confirma a Kevin", async () => {
    const es = inMemoryEscalations()
    const { id } = await es.create({
      question: "¿Dónde trabaja?",
      kind: "knowledge",
      origin: tgOrigin(),
    })
    await es.markNotified(id, "telegram", "42")
    const resumeCalls: ResumeConversationInput[] = []
    const sent: { chatId: number; text: string }[] = []
    const consumed = await tryHandleEscalationReply(
      {
        escalations: es,
        resumer: fakeResumer(resumeCalls),
        client: fakeClient(sent),
        logger: noopLogger(),
      },
      ownerReply()
    )
    expect(consumed).toBe(true)
    // retomó al visitante (chat 555) con la respuesta de Kevin inyectada (background → waitFor)
    await vi.waitFor(() => expect(resumeCalls).toHaveLength(1))
    expect(resumeCalls[0]?.routing).toEqual({ chatId: 555 })
    expect(resumeCalls[0]?.originalQuestion).toBe("¿Dónde trabaja?")
    expect(resumeCalls[0]?.injectedAnswer).toContain("ClonAI")
    // confirmó a Kevin (su DM = 1000) e invitó a curar
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.chatId).toBe(1000)
    expect(sent[0]?.text.toLowerCase()).toMatch(/recuerde|guardo/)
    // la escalada quedó answered → un 2º markAnswered ya no afecta (guard de idempotencia)
    expect(await es.markAnswered(id, "x")).toBe(false)
  })

  it("correlación por TOPIC: Kevin responde DENTRO del hilo (sin citar) → matchea + retoma", async () => {
    const es = inMemoryEscalations()
    const { id } = await es.create({
      question: "¿Dónde trabaja?",
      kind: "knowledge",
      origin: tgOrigin(),
    })
    await es.markNotified(id, "telegram", "42", "77") // hilo (topic) 77
    const resumeCalls: ResumeConversationInput[] = []
    const sent: { chatId: number; text: string }[] = []
    const consumed = await tryHandleEscalationReply(
      {
        escalations: es,
        resumer: fakeResumer(resumeCalls),
        client: fakeClient(sent),
        logger: noopLogger(),
      },
      ownerReply({ replyToMessageId: undefined, threadId: 77 }) // sin citar, dentro del hilo
    )
    expect(consumed).toBe(true)
    await vi.waitFor(() => expect(resumeCalls).toHaveLength(1))
    expect(resumeCalls[0]?.injectedAnswer).toContain("ClonAI")
  })

  it("mensaje en un topic que NO es de una escalada → false (turno normal de Kevin)", async () => {
    const es = inMemoryEscalations()
    const { id } = await es.create({
      question: "q",
      kind: "knowledge",
      origin: tgOrigin(),
    })
    await es.markNotified(id, "telegram", "42", "77")
    const consumed = await tryHandleEscalationReply(
      {
        escalations: es,
        resumer: fakeResumer([]),
        client: fakeClient([]),
        logger: noopLogger(),
      },
      ownerReply({ replyToMessageId: undefined, threadId: 999 }) // otro hilo
    )
    expect(consumed).toBe(false)
  })

  it("reply que NO matchea ninguna escalada → false (sigue como turno normal de Kevin)", async () => {
    const es = inMemoryEscalations()
    const resumeCalls: ResumeConversationInput[] = []
    const sent: { chatId: number; text: string }[] = []
    const consumed = await tryHandleEscalationReply(
      {
        escalations: es,
        resumer: fakeResumer(resumeCalls),
        client: fakeClient(sent),
        logger: noopLogger(),
      },
      ownerReply({ replyToMessageId: 999 })
    )
    expect(consumed).toBe(false)
    expect(resumeCalls).toHaveLength(0)
    expect(sent).toHaveLength(0)
  })

  it("sin replyToMessageId → false (no es respuesta de escalada)", async () => {
    const es = inMemoryEscalations()
    const consumed = await tryHandleEscalationReply(
      {
        escalations: es,
        resumer: fakeResumer([]),
        client: fakeClient([]),
        logger: noopLogger(),
      },
      ownerReply({ replyToMessageId: undefined })
    )
    expect(consumed).toBe(false)
  })

  it("tras responder, un 2º mensaje en el hilo → false (Kevin CONTINÚA; no se re-consume ni re-retoma)", async () => {
    const es = inMemoryEscalations()
    const { id } = await es.create({
      question: "q",
      kind: "knowledge",
      origin: tgOrigin(),
    })
    await es.markNotified(id, "telegram", "42")
    const resumeCalls: ResumeConversationInput[] = []
    const deps = {
      escalations: es,
      resumer: fakeResumer(resumeCalls),
      client: fakeClient([]),
      logger: noopLogger(),
    }
    // 1ª respuesta del owner: consume (procesa la escalada notified) y retoma.
    expect(await tryHandleEscalationReply(deps, ownerReply())).toBe(true)
    await vi.waitFor(() => expect(resumeCalls).toHaveLength(1))
    // 2º mensaje en el MISMO hilo (escalada ya answered) → NO se consume → turno normal (la charla sigue).
    expect(await tryHandleEscalationReply(deps, ownerReply())).toBe(false)
    expect(resumeCalls).toHaveLength(1) // no re-retomó
  })

  it("retomo NO entregado (delivered:false) → confirma honesto, sin prometer 'se lo transmití'", async () => {
    const es = inMemoryEscalations()
    const { id } = await es.create({
      question: "q",
      kind: "knowledge",
      origin: tgOrigin(),
    })
    await es.markNotified(id, "telegram", "42")
    const sent: { chatId: number; text: string }[] = []
    await tryHandleEscalationReply(
      {
        escalations: es,
        resumer: fakeResumer([], false), // el visitante no estaba alcanzable
        client: fakeClient(sent),
        logger: noopLogger(),
      },
      ownerReply()
    )
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.text.toLowerCase()).toContain("no está en línea")
    expect(sent[0]?.text.toLowerCase()).not.toContain("se lo transmití")
  })

  it("origen WEB (sin push) → answered + NO retoma (cierra vía fact), igual confirma a Kevin", async () => {
    const es = inMemoryEscalations()
    const { id } = await es.create({
      question: "q",
      kind: "knowledge",
      origin: {
        channel: "web",
        conversationId: "uuid-web",
        threadKey: "uuid-web",
        askerPrincipalId: "web",
        locale: "es",
      },
    })
    await es.markNotified(id, "telegram", "42")
    const resumeCalls: ResumeConversationInput[] = []
    const sent: { chatId: number; text: string }[] = []
    const consumed = await tryHandleEscalationReply(
      {
        escalations: es,
        resumer: fakeResumer(resumeCalls),
        client: fakeClient(sent),
        logger: noopLogger(),
      },
      ownerReply()
    )
    expect(consumed).toBe(true)
    expect(resumeCalls).toHaveLength(0) // web no tiene push
    await vi.waitFor(() => expect(sent).toHaveLength(1)) // pero Kevin igual recibe confirmación
  })
})

describe("inbound: curación con juez + atomicidad", () => {
  const setup = async (kind: "knowledge" | "contact" | "claim") => {
    const es = inMemoryEscalations()
    const { id } = await es.create({
      question: "¿Le gusta la pasta?",
      kind,
      origin: tgOrigin(),
    })
    await es.markNotified(id, "telegram", "42")
    return { es, id }
  }
  const run = async (
    es: ReturnType<typeof inMemoryEscalations>,
    fs: ReturnType<typeof fakeFactStore>,
    opts: { statements: string[]; judge?: ConflictJudge },
    ownerText: string,
    sent: { chatId: number; text: string }[]
  ) =>
    tryHandleEscalationReply(
      {
        escalations: es,
        resumer: fakeResumer([]),
        client: fakeClient(sent),
        logger: noopLogger(),
        factStore: fs,
        factDecomposer: fakeDecomposer(opts.statements),
        ...(opts.judge ? { conflictJudge: opts.judge } : {}),
      },
      ownerReply({ text: ownerText })
    )

  it("knowledge sin cercanos → descompone, guarda (commit + linkFact); confirma «Guardé»", async () => {
    const { es, id } = await setup("knowledge")
    const fs = fakeFactStore()
    const sent: { chatId: number; text: string }[] = []
    await run(
      es,
      fs,
      { statements: ["A Kevin le gusta la pasta"] },
      "Sí, me encanta",
      sent
    )
    await vi.waitFor(() => expect(fs.committed).toHaveLength(1))
    expect(fs.proposed).toContain("A Kevin le gusta la pasta")
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.text).toContain("Guardé")
    expect(sent[0]?.text).toContain("A Kevin le gusta la pasta")
    void id
  })

  it("statement COMPUESTO → se guarda como átomos separados", async () => {
    const { es } = await setup("knowledge")
    const fs = fakeFactStore()
    const sent: { chatId: number; text: string }[] = []
    await run(
      es,
      fs,
      {
        statements: [
          "A Kevin le daban miedo las piscinas",
          "A Kevin le gustaba explorar",
        ],
      },
      "La piscina me daba miedo y me gustaba explorar",
      sent
    )
    await vi.waitFor(() => expect(fs.committed).toHaveLength(2))
    expect(fs.proposed).toEqual([
      "A Kevin le daban miedo las piscinas",
      "A Kevin le gustaba explorar",
    ])
  })

  it("REGRESIÓN pasta/fútbol: cercano pero el juez dice COEXISTE → guarda igual, NADA pendiente", async () => {
    const { es } = await setup("knowledge")
    const fs = fakeFactStore({ conflict: true }) // propose devuelve un cercano (fútbol)
    const sent: { chatId: number; text: string }[] = []
    await run(
      es,
      fs,
      {
        statements: ["A Kevin le gusta la pasta"],
        judge: fakeJudge("coexists"),
      },
      "Sí",
      sent
    )
    await vi.waitFor(() => expect(fs.committed).toHaveLength(1))
    expect(fs.committed[0]?.supersedes ?? []).toHaveLength(0) // no invalidó nada
    expect(fs.rejected).toHaveLength(0)
  })

  it("cercano + juez CONTRADICE → guarda invalidando el viejo (supersedes) + avisa «Di de baja»", async () => {
    const { es } = await setup("knowledge")
    const fs = fakeFactStore({ conflict: true })
    const sent: { chatId: number; text: string }[] = []
    await run(
      es,
      fs,
      {
        statements: ["A Kevin ya no le gusta la pasta"],
        judge: fakeJudge("contradicts"),
      },
      "Ya no",
      sent
    )
    await vi.waitFor(() => expect(fs.committed).toHaveLength(1))
    expect(fs.committed[0]?.supersedes).toEqual(["old"])
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.text).toContain("Di de baja")
  })

  it("cercano + juez DUPLICADO → no duplica (reject), no commit", async () => {
    const { es } = await setup("knowledge")
    const fs = fakeFactStore({ conflict: true })
    const sent: { chatId: number; text: string }[] = []
    await run(
      es,
      fs,
      {
        statements: ["A Kevin le gusta la pasta"],
        judge: fakeJudge("duplicate"),
      },
      "Sí",
      sent
    )
    await vi.waitFor(() => expect(fs.rejected).toHaveLength(1))
    expect(fs.committed).toHaveLength(0)
  })

  it("UNIFICADO: claim que contradice → guarda el nuevo invalidando el viejo (no más gate por kind)", async () => {
    const { es } = await setup("claim")
    const fs = fakeFactStore({ conflict: true }) // propose devuelve "dato viejo"
    const sent: { chatId: number; text: string }[] = []
    await run(
      es,
      fs,
      {
        statements: ["A Kevin ya no le gusta la pasta"],
        judge: fakeJudge("contradicts"),
      },
      "Ya no me gusta la pasta",
      sent
    )
    await vi.waitFor(() => expect(fs.committed).toHaveLength(1))
    expect(fs.committed[0]?.supersedes).toEqual(["old"]) // invalidó el viejo
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.text).toContain("Di de baja")
  })

  it("UNIFICADO (caso C): claim aditivo+contradictorio → guarda AMBOS (tarta + contrapuesto)", async () => {
    const { es } = await setup("claim")
    const fs = fakeFactStore() // sin conflicto en el fake → ambos átomos commitean
    const sent: { chatId: number; text: string }[] = []
    await run(
      es,
      fs,
      {
        statements: [
          "A Kevin ya no le gusta la pasta",
          "A Kevin le gusta la tarta de manzana",
        ],
      },
      "Ya no me gusta la pasta, ahora me gusta la tarta de manzana",
      sent
    )
    await vi.waitFor(() => expect(fs.committed).toHaveLength(2)) // claim AHORA aprende (antes learned:0)
    expect(fs.proposed).toContain("A Kevin le gusta la tarta de manzana")
  })

  it("contact con instrucción no-factual (decomposer vacío) → no toca nada", async () => {
    const { es } = await setup("contact")
    const fs = fakeFactStore()
    const sent: { chatId: number; text: string }[] = []
    await run(es, fs, { statements: [] }, "Decile que me escriba", sent)
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(fs.committed).toHaveLength(0)
    expect(fs.invalidated).toHaveLength(0)
  })

  it("knowledge + veto («no lo aprendas») → no persiste", async () => {
    const { es } = await setup("knowledge")
    const fs = fakeFactStore()
    const sent: { chatId: number; text: string }[] = []
    await run(
      es,
      fs,
      { statements: ["A Kevin le gusta la pasta"] },
      "Sí, pero no lo aprendas",
      sent
    )
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(fs.committed).toHaveLength(0)
  })

  it("decomposer vacío (sensible/no-factual) → no guarda", async () => {
    const { es } = await setup("knowledge")
    const fs = fakeFactStore()
    const sent: { chatId: number; text: string }[] = []
    await run(es, fs, { statements: [] }, "Mi número es 300...", sent)
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(fs.committed).toHaveLength(0)
  })
})
