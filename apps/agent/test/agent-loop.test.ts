import type { TraceEvent, TurnRequest } from "@vaio/contracts"
import { convertArrayToReadableStream, MockLanguageModelV3 } from "ai/test"
import { describe, expect, it } from "vitest"
import { courtesy, createAgent, type TurnContext } from "../src/core/agent.js"
import type { Compressor } from "../src/ports/compress.js"
import type { LogFields, Logger } from "../src/ports/logger.js"
import type { Summarizer } from "../src/ports/summary.js"
import { createInMemoryConversationStore } from "./fakes/in-memory-conversation.js"

/** Compresor espía: registra qué textos se le pidió comprimir (identidad como salida). */
function spyCompressor(): { c: Compressor; seen: string[] } {
  const seen: string[] = []
  const c: Compressor = {
    compress: (t) => {
      seen.push(t)
      return t
    },
    expand: (t) => t,
    countTokens: (t) => t.length,
  }
  return { c, seen }
}

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

const webReq = (userText: string, conversationKey = "k"): TurnRequest => ({
  channel: "web",
  conversationKey,
  userText,
  locale: "es",
  principalId: "web",
  trusted: false,
})

/** Modelo mock que streamea "Hola Kevin" exitosamente (stream nuevo en cada llamada). */
function okModel(): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    modelId: "mock/ok",
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: "text-start", id: "0" },
        { type: "text-delta", id: "0", delta: "Hola" },
        { type: "text-delta", id: "0", delta: " Kevin" },
        { type: "text-end", id: "0" },
        {
          type: "finish",
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
        },
      ]),
    }),
  })
}

function boomModel(): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    modelId: "mock/boom",
    doStream: async () => {
      throw new Error("modelo caído")
    },
  })
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

/** Deja correr la persistencia en background (void persist) tras cerrar el stream. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10))

describe("agent.respond (instrumentación + degradación)", () => {
  it("emite turn.start con metadata del turno", async () => {
    const { ctx, events } = collectingCtx()
    const agent = createAgent({
      model: boomModel(),
      memory: null,
      conversations: null,
      summarizer: null,
    })
    const { stream } = await agent.respond(webReq("hola vaio"), ctx)
    await drain(stream)
    expect(events.find((e) => e.type === "turn.start")).toMatchObject({
      type: "turn.start",
      requestId: "req-test",
      messageCount: 1,
      locale: "es",
    })
  })

  it("si el modelo falla: emite turn.error y responde la cortesía (stream y text)", async () => {
    const { ctx, events } = collectingCtx()
    const agent = createAgent({
      model: boomModel(),
      memory: null,
      conversations: null,
      summarizer: null,
    })
    const { stream, text } = await agent.respond(webReq("hola"), ctx)
    const out = await drain(stream)
    expect(events.map((e) => e.type)).toContain("turn.error")
    expect(out).toBe(courtesy("es"))
    expect(await text).toBe(courtesy("es"))
  })
})

describe("agent.respond (memoria conversacional)", () => {
  it("persiste el turno (user+assistant) tras responder", async () => {
    const { ctx } = collectingCtx()
    const store = createInMemoryConversationStore()
    const agent = createAgent({
      model: okModel(),
      memory: null,
      conversations: store,
      summarizer: null,
    })
    const { stream, text } = await agent.respond(webReq("hola", "k1"), ctx)
    expect(await drain(stream)).toBe("Hola Kevin")
    expect(await text).toBe("Hola Kevin")
    await tick()
    const id = await store.ensure("web", "k1", "es")
    const after = await store.loadContext(id, 10)
    expect(after.messageCount).toBe(2)
    expect(after.recent.map((m) => m.content)).toEqual(["hola", "Hola Kevin"])
  })

  it("turno multimodal: transcribe el audio y persiste el texto derivado", async () => {
    const { ctx } = collectingCtx()
    const store = createInMemoryConversationStore()
    const agent = createAgent({
      model: okModel(),
      memory: null,
      conversations: store,
      summarizer: null,
      transcriber: { transcribe: async () => "che, cómo andás" },
      mediaUnderstanding: null,
    })
    const req: TurnRequest = {
      channel: "telegram",
      conversationKey: "k-media",
      userText: "",
      attachments: [{ kind: "audio", mediaType: "audio/ogg", ref: "v1" }],
      locale: "es",
      principalId: "1",
      trusted: true,
    }
    const media = [
      {
        kind: "audio" as const,
        mediaType: "audio/ogg",
        ref: "v1",
        data: new Uint8Array([1, 2, 3]),
      },
    ]
    const { stream } = await agent.respond(req, ctx, media)
    await drain(stream)
    await tick()
    const id = await store.ensure("telegram", "k-media", "es")
    const after = await store.loadContext(id, 10)
    expect(after.recent[0]?.content).toContain("[voz]")
    expect(after.recent[0]?.content).toContain("che, cómo andás")
  })

  it("turno multimodal degradado: transcriber null → persiste marcador, nunca rompe", async () => {
    const { ctx } = collectingCtx()
    const store = createInMemoryConversationStore()
    const agent = createAgent({
      model: okModel(),
      memory: null,
      conversations: store,
      summarizer: null,
      transcriber: null,
      mediaUnderstanding: null,
    })
    const req: TurnRequest = {
      channel: "telegram",
      conversationKey: "k-degr",
      userText: "",
      attachments: [{ kind: "audio", mediaType: "audio/ogg", ref: "v1" }],
      locale: "es",
      principalId: "1",
      trusted: true,
    }
    const media = [
      {
        kind: "audio" as const,
        mediaType: "audio/ogg",
        ref: "v1",
        data: new Uint8Array([1]),
      },
    ]
    const { stream, text } = await agent.respond(req, ctx, media)
    expect(await drain(stream)).toBe("Hola Kevin")
    await tick()
    const id = await store.ensure("telegram", "k-degr", "es")
    const after = await store.loadContext(id, 10)
    expect(after.recent[0]?.content).toContain("no procesable")
    expect(await text).toBe("Hola Kevin")
  })

  it("sobre el threshold: invoca el summarizer y guarda el resumen", async () => {
    const { ctx } = collectingCtx()
    const store = createInMemoryConversationStore()
    const id = await store.ensure("web", "k2", "es")
    await store.appendTurn(id, "p1", { user: "viejo1", assistant: "r1" })
    await store.appendTurn(id, "p2", { user: "viejo2", assistant: "r2" })
    let summarizeCalls = 0
    const summarizer: Summarizer = {
      summarize: async () => {
        summarizeCalls++
        return "RESUMEN"
      },
    }
    const agent = createAgent({
      model: okModel(),
      memory: null,
      conversations: store,
      summarizer,
      summaryThreshold: 2,
      recentLimit: 2,
    })
    const { stream } = await agent.respond(webReq("nuevo", "k2"), ctx)
    await drain(stream)
    await tick()
    expect(summarizeCalls).toBe(1)
    expect((await store.loadContext(id, 2)).summary).toBe("RESUMEN")
  })
})

describe("agent.respond (compresión de contexto, Tier 1)", () => {
  it("comprime resumen + turnos históricos, pero NO el mensaje vivo", async () => {
    const { ctx } = collectingCtx()
    const store = createInMemoryConversationStore()
    const id = await store.ensure("web", "kc", "es")
    await store.appendTurn(id, "h1", {
      user: "viejo uno",
      assistant: "resp uno",
    })
    await store.updateSummary(id, "RESUMEN PREVIO", 0)
    const { c, seen } = spyCompressor()
    const agent = createAgent({
      model: okModel(),
      memory: null,
      conversations: store,
      summarizer: null,
      compressor: c,
    })
    const { stream } = await agent.respond(
      webReq("mensaje vivo nuevo", "kc"),
      ctx
    )
    await drain(stream)
    expect(seen).toContain("RESUMEN PREVIO")
    expect(seen).toContain("viejo uno")
    expect(seen).toContain("resp uno")
    expect(seen).not.toContain("mensaje vivo nuevo")
  })
})
