import { describe, expect, it, vi } from "vitest"
import { tryHandleEscalationReply } from "../src/adapters/telegram/escalation-inbound.js"
import {
  type NormalizeResult,
  normalizeUpdate,
} from "../src/adapters/telegram/normalize.js"
import type { EscalationOrigin } from "../src/ports/escalation.js"
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

function fakeResumer(calls: ResumeConversationInput[]): ConversationResumer {
  return { resumeConversation: (input) => calls.push(input) }
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
    // retomó al visitante (chat 555) con la respuesta de Kevin inyectada
    expect(resumeCalls).toHaveLength(1)
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

  it("idempotencia: 2º reply al mismo DM (retry) → consume pero NO re-retoma", async () => {
    const es = inMemoryEscalations()
    const { id } = await es.create({ question: "q", origin: tgOrigin() })
    await es.markNotified(id, "telegram", "42")
    const resumeCalls: ResumeConversationInput[] = []
    const deps = {
      escalations: es,
      resumer: fakeResumer(resumeCalls),
      client: fakeClient([]),
      logger: noopLogger(),
    }
    expect(await tryHandleEscalationReply(deps, ownerReply())).toBe(true)
    // 2º procesamiento del mismo reply (retry de webhook): ya está answered → no re-retoma
    expect(await tryHandleEscalationReply(deps, ownerReply())).toBe(true)
    expect(resumeCalls).toHaveLength(1)
  })

  it("origen WEB (sin push) → answered + NO retoma (cierra vía fact), igual confirma a Kevin", async () => {
    const es = inMemoryEscalations()
    const { id } = await es.create({
      question: "q",
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
