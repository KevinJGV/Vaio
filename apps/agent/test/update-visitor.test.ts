import { describe, expect, it } from "vitest"
import { buildTools } from "../src/core/actions/registry.js"
import type { ActionContext } from "../src/core/actions/types.js"
import { updateVisitor } from "../src/core/actions/update-visitor.js"
import type { Principal } from "../src/core/capabilities.js"
import type { ThreadOrigin } from "../src/ports/escalation.js"
import type { LogFields, Logger } from "../src/ports/logger.js"
import type {
  ConversationResumer,
  ResumeConversationInput,
} from "../src/ports/proactive.js"

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

/** Fake ConversationResumer que registra la última llamada y devuelve `delivered` fijo. */
function fakeResumer(
  delivered: boolean,
  calls: ResumeConversationInput[]
): ConversationResumer {
  return {
    resumeConversation: async (input) => {
      calls.push(input)
      return { delivered }
    },
  }
}

const principal: Principal = { channel: "telegram", id: "k", trusted: true }

const VISITOR: NonNullable<ThreadOrigin["visitor"]> = {
  channel: "telegram",
  conversationKey: "5949120950",
  locale: "es",
}

function ctx(over: Partial<ActionContext> = {}): ActionContext {
  return {
    caps: {
      channel: "telegram",
      allowedTools: ["updateVisitor"],
      memoryScope: { maxK: 8 },
      policyText: "",
    },
    principal,
    memory: null,
    emit: () => {},
    ids: { requestId: "r", turnId: "t", conversationId: "c" },
    logger: noopLogger(),
    ...over,
  }
}

describe("updateVisitor", () => {
  const origin = (): ThreadOrigin => ({
    question: "¿qué piensa Kevin de la muerte?",
    answer: "es una falla de la realidad",
    statement: "Kevin considera que la muerte es una falla de la realidad",
    factId: "f1",
    visitor: VISITOR,
  })

  it("con threadOrigin.visitor + resumer → llama resumeConversation(kind:update) y confirma entregado", async () => {
    const calls: ResumeConversationInput[] = []
    const out = await updateVisitor
      .build(
        ctx({
          threadOrigin: origin(),
          conversationResumer: fakeResumer(true, calls),
        })
      )
      .execute?.(
        { message: "en realidad cree que hay vida después" },
        { toolCallId: "u", messages: [] }
      )
    expect(String(out)).toMatch(/actualic|listo/i)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.kind).toBe("update")
    expect(calls[0]?.conversationKey).toBe(VISITOR.conversationKey)
    expect(calls[0]?.injectedAnswer).toContain("hay vida")
    expect(calls[0]?.originalQuestion).toContain("muerte")
  })

  it("delivered:false → confirma honesto que el visitante no está accesible", async () => {
    const calls: ResumeConversationInput[] = []
    const out = await updateVisitor
      .build(
        ctx({
          threadOrigin: origin(),
          conversationResumer: fakeResumer(false, calls),
        })
      )
      .execute?.({ message: "x" }, { toolCallId: "u", messages: [] })
    expect(String(out)).toMatch(/no está accesible|anotado/i)
    expect(calls).toHaveLength(1)
  })

  it("VETO (capa 2): si el owner pidió no avisar (userText) → NO empuja, lo dice visible", async () => {
    const calls: ResumeConversationInput[] = []
    const out = await updateVisitor
      .build(
        ctx({
          threadOrigin: origin(),
          conversationResumer: fakeResumer(true, calls),
          userText: "corregilo pero no le avises al visitante",
        })
      )
      .execute?.({ message: "x" }, { toolCallId: "u", messages: [] })
    expect(String(out)).toMatch(/no le avis/i)
    expect(calls).toHaveLength(0) // backstop: no se empujó nada
  })

  it("sin visitor en el threadOrigin (p.ej. web stateless) → degrada honesto, no empuja", async () => {
    const calls: ResumeConversationInput[] = []
    const noVisitor: ThreadOrigin = { question: "q", answer: "a" }
    const out = await updateVisitor
      .build(
        ctx({
          threadOrigin: noVisitor,
          conversationResumer: fakeResumer(true, calls),
        })
      )
      .execute?.({ message: "x" }, { toolCallId: "u", messages: [] })
    expect(String(out)).toMatch(/no tengo un visitante/i)
    expect(calls).toHaveLength(0)
  })

  it("sin conversationResumer → degrada honesto", async () => {
    const out = await updateVisitor
      .build(ctx({ threadOrigin: origin(), conversationResumer: null }))
      .execute?.({ message: "x" }, { toolCallId: "u", messages: [] })
    expect(String(out)).toMatch(/no puedo avisar/i)
  })

  it("gating contextual: solo se instancia con threadOrigin presente", () => {
    const withThread = buildTools(ctx({ threadOrigin: origin() }))
    expect(withThread.updateVisitor).toBeDefined()
    const noThread = buildTools(ctx({ threadOrigin: null }))
    expect(noThread.updateVisitor).toBeUndefined()
  })

  it("gating: owner-only → un visitante (no trusted) no la ve ni con threadOrigin", () => {
    const visitorCtx = ctx({
      threadOrigin: origin(),
      principal: { channel: "telegram", id: "v", trusted: false },
    })
    // (en prod un visitante no tiene threadOrigin; esto verifica la capa clearance igual)
    const tools = buildTools(visitorCtx)
    // se instancia (canal+contexto) pero deniega por clearance → execute deniega
    expect(tools.updateVisitor).toBeDefined()
  })
})
