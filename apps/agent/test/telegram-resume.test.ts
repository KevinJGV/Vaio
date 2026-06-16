import type { TurnRequest } from "@vaio/contracts"
import { describe, expect, it, vi } from "vitest"
import type { TelegramClient } from "../src/adapters/telegram/client.js"
import { createTelegramConversationResumer } from "../src/adapters/telegram/resume.js"
import type { Agent, TurnContext } from "../src/core/agent.js"
import type { LogFields, Logger } from "../src/ports/logger.js"
import type { ResumeConversationInput } from "../src/ports/proactive.js"
import type { TraceSink } from "../src/ports/trace.js"

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

function fakeAgent(
  answer: string,
  calls: { req: TurnRequest; ctx: TurnContext }[]
): Agent {
  return {
    respond: async (req: TurnRequest, ctx: TurnContext) => {
      calls.push({ req, ctx })
      return {
        stream: new ReadableStream<Uint8Array>(),
        text: Promise.resolve(answer),
      }
    },
  } as unknown as Agent
}

function fakeClient(
  sent: { chatId: number; text: string; thread?: number }[]
): TelegramClient {
  return {
    sendMessage: async (
      chatId: number,
      text: string,
      opts?: { messageThreadId?: number }
    ) => {
      sent.push({ chatId, text, thread: opts?.messageThreadId })
      return 1
    },
  } as unknown as TelegramClient
}

const sink = {} as unknown as TraceSink

const baseInput: ResumeConversationInput = {
  conversationKey: "555",
  channel: "telegram",
  locale: "es",
  originalQuestion: "¿En qué trabaja Kevin?",
  injectedAnswer: "En ClonAI, como dev de IA.",
  routing: { chatId: 555 },
}

describe("createTelegramConversationResumer", () => {
  it("retoma la conversación del VISITANTE inyectando la respuesta de Kevin; anti-loop (resume null + denylist escalate)", async () => {
    const calls: { req: TurnRequest; ctx: TurnContext }[] = []
    const sent: { chatId: number; text: string; thread?: number }[] = []
    const resumer = createTelegramConversationResumer({
      agent: fakeAgent("Kevin labura en ClonAI 🙌", calls),
      client: fakeClient(sent),
      logger: noopLogger(),
      sink,
      newRequestId: () => "rid",
    })
    resumer.resumeConversation(baseInput)
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    // Re-entró en la conversación del visitante (555), como actor sintético, perfil visitante.
    expect(calls).toHaveLength(1)
    expect(calls[0]?.req.conversationKey).toBe("555")
    expect(calls[0]?.req.principalId).toBe("system:escalate-resume")
    expect(calls[0]?.req.trusted).toBe(false)
    // El framing inyecta pregunta + respuesta de Kevin.
    expect(calls[0]?.req.userText).toContain("¿En qué trabaja Kevin?")
    expect(calls[0]?.req.userText).toContain("En ClonAI, como dev de IA.")
    // Anti-loop.
    expect(calls[0]?.ctx.resume).toBeNull()
    expect(calls[0]?.ctx.toolDenylist).toEqual(["escalate"])
    // Entregó al hilo del visitante.
    expect(sent[0]).toEqual({
      chatId: 555,
      text: "Kevin labura en ClonAI 🙌",
      thread: undefined,
    })
  })

  it("respeta el threadId (topic) del visitante", async () => {
    const sent: { chatId: number; text: string; thread?: number }[] = []
    const resumer = createTelegramConversationResumer({
      agent: fakeAgent("x", []),
      client: fakeClient(sent),
      logger: noopLogger(),
      sink,
      newRequestId: () => "rid",
    })
    resumer.resumeConversation({
      ...baseInput,
      routing: { chatId: 5, threadId: 42 },
    })
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.thread).toBe(42)
  })

  it("web (sin chatId de routing) → no-op limpio: no corre el agente ni manda nada", async () => {
    const calls: { req: TurnRequest; ctx: TurnContext }[] = []
    const sent: { chatId: number; text: string; thread?: number }[] = []
    const resumer = createTelegramConversationResumer({
      agent: fakeAgent("no debería correr", calls),
      client: fakeClient(sent),
      logger: noopLogger(),
      sink,
      newRequestId: () => "rid",
    })
    resumer.resumeConversation({ ...baseInput, channel: "web", routing: {} })
    await new Promise((r) => setTimeout(r, 10))
    expect(calls).toHaveLength(0)
    expect(sent).toHaveLength(0)
  })

  it("si el agente tira, NO propaga (best-effort, Inv #1)", async () => {
    const warns: string[] = []
    const logger = noopLogger()
    logger.warn = () => {
      warns.push("warn")
    }
    const throwingAgent = {
      respond: async () => {
        throw new Error("boom")
      },
    } as unknown as Agent
    const resumer = createTelegramConversationResumer({
      agent: throwingAgent,
      client: fakeClient([]),
      logger,
      sink,
      newRequestId: () => "rid",
    })
    resumer.resumeConversation(baseInput)
    await vi.waitFor(() => expect(warns).toHaveLength(1))
  })
})
