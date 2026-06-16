import type { TurnRequest } from "@vaio/contracts"
import { describe, expect, it, vi } from "vitest"
import type { TelegramClient } from "../src/adapters/telegram/client.js"
import { createTelegramResume } from "../src/adapters/telegram/proactive.js"
import type { Agent, TurnContext } from "../src/core/agent.js"
import type { LogFields, Logger } from "../src/ports/logger.js"
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

const baseReq: TurnRequest = {
  channel: "telegram",
  conversationKey: "123",
  userText: "trae el repo Vaio",
  attachments: [],
  locale: "es",
  principalId: "999",
  trusted: true,
}

/** Fake agent: respond devuelve un texto fijo y registra los (req, ctx) con que lo llamaron. */
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
    },
  } as unknown as TelegramClient
}

const sink = {} as unknown as TraceSink

describe("createTelegramResume", () => {
  it("task RESUELTA → re-entra el loop con la duda original y manda la respuesta con prefijo", async () => {
    const calls: { req: TurnRequest; ctx: TurnContext }[] = []
    const sent: { chatId: number; text: string; thread?: number }[] = []
    const resume = createTelegramResume({
      agent: fakeAgent("Vaio es un agente en TypeScript.", calls),
      client: fakeClient(sent),
      logger: noopLogger(),
      sink,
      req: baseReq,
      chatId: 123,
      newRequestId: () => "rid-2",
    })
    resume.resume(Promise.resolve("ok"), { label: "learnRepo" })

    await vi.waitFor(() => expect(sent).toHaveLength(1))
    // Re-entró con el MISMO turno (conversationKey + userText original).
    expect(calls).toHaveLength(1)
    expect(calls[0]?.req.conversationKey).toBe("123")
    expect(calls[0]?.req.userText).toBe("trae el repo Vaio")
    // Mensaje proactivo: prefijo + la respuesta del modelo.
    expect(sent[0]?.chatId).toBe(123)
    expect(sent[0]?.text).toBe("✅ Listo — Vaio es un agente en TypeScript.")
  })

  it("ANTI-LOOP: el turno sintético lleva resume=null (no anida turnos proactivos)", async () => {
    const calls: { req: TurnRequest; ctx: TurnContext }[] = []
    const resume = createTelegramResume({
      agent: fakeAgent("respuesta", calls),
      client: fakeClient([]),
      logger: noopLogger(),
      sink,
      req: baseReq,
      chatId: 1,
      newRequestId: () => "rid",
    })
    resume.resume(Promise.resolve())
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]?.ctx.resume).toBeNull()
  })

  it("respeta el threadId (topic) en el envío", async () => {
    const sent: { chatId: number; text: string; thread?: number }[] = []
    const resume = createTelegramResume({
      agent: fakeAgent("x", []),
      client: fakeClient(sent),
      logger: noopLogger(),
      sink,
      req: baseReq,
      chatId: 5,
      threadId: 42,
      newRequestId: () => "rid",
    })
    resume.resume(Promise.resolve())
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.thread).toBe(42)
  })

  it("prefijo en inglés cuando locale=en", async () => {
    const sent: { chatId: number; text: string; thread?: number }[] = []
    const resume = createTelegramResume({
      agent: fakeAgent("Vaio is an agent.", []),
      client: fakeClient(sent),
      logger: noopLogger(),
      sink,
      req: { ...baseReq, locale: "en" },
      chatId: 7,
      newRequestId: () => "rid",
    })
    resume.resume(Promise.resolve())
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.text).toBe("✅ Done — Vaio is an agent.")
  })

  it("task RECHAZADA → NO manda nada y NO tira (best-effort, Inv #1)", async () => {
    const calls: { req: TurnRequest; ctx: TurnContext }[] = []
    const sent: { chatId: number; text: string; thread?: number }[] = []
    const warns: string[] = []
    const logger = noopLogger()
    logger.warn = (_a, _b) => {
      warns.push("warn")
    }
    const resume = createTelegramResume({
      agent: fakeAgent("no debería correr", calls),
      client: fakeClient(sent),
      logger,
      sink,
      req: baseReq,
      chatId: 1,
      newRequestId: () => "rid",
    })
    resume.resume(Promise.reject(new Error("la tarea falló")))
    await vi.waitFor(() => expect(warns).toHaveLength(1))
    expect(calls).toHaveLength(0) // no re-entró el loop
    expect(sent).toHaveLength(0) // no mandó respuesta
  })
})
