import type { TraceEvent } from "@vaio/contracts"
import { MockLanguageModelV3 } from "ai/test"
import { describe, expect, it } from "vitest"
import { courtesy, createAgent, type TurnContext } from "../src/core/agent.js"
import type { LogFields, Logger } from "../src/ports/logger.js"

function noopLogger(): Logger {
  const noop = (_a: LogFields | string, _b?: string): void => {}
  const logger: Logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => logger,
  }
  return logger
}

function collectingCtx(): { ctx: TurnContext; events: TraceEvent[] } {
  const events: TraceEvent[] = []
  const ctx: TurnContext = {
    logger: noopLogger(),
    sink: { emit: (e) => events.push(e) },
    requestId: "req-test",
  }
  return { ctx, events }
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const dec = new TextDecoder()
  let out = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) out += dec.decode(value)
  }
  return out
}

describe("agent.respond (instrumentación + degradación)", () => {
  it("emite turn.start con metadata del turno", async () => {
    const model = new MockLanguageModelV3({
      modelId: "mock/boom",
      doStream: async () => {
        throw new Error("modelo caído")
      },
    })
    const { ctx, events } = collectingCtx()
    await drain(
      createAgent({ model, memory: null }).respond(
        [{ role: "user", content: "hola vaio" }],
        "es",
        ctx
      )
    )
    const start = events.find((e) => e.type === "turn.start")
    expect(start).toMatchObject({
      type: "turn.start",
      requestId: "req-test",
      messageCount: 1,
      locale: "es",
    })
  })

  it("si el modelo falla: emite turn.error y responde la cortesía (nunca vacío)", async () => {
    const model = new MockLanguageModelV3({
      modelId: "mock/boom",
      doStream: async () => {
        throw new Error("modelo caído")
      },
    })
    const { ctx, events } = collectingCtx()
    const out = await drain(
      createAgent({ model, memory: null }).respond(
        [{ role: "user", content: "hola" }],
        "es",
        ctx
      )
    )
    expect(events.map((e) => e.type)).toContain("turn.error")
    expect(out).toBe(courtesy("es"))
  })
})
