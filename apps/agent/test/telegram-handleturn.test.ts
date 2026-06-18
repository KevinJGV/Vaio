import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import type { Variables } from "../src/adapters/http/types.js"
import type {
  SendAudioOpts,
  SendOpts,
  TelegramClient,
} from "../src/adapters/telegram/client.js"
import { mountTelegram } from "../src/adapters/telegram/routes.js"
import type { Agent, TurnContext } from "../src/core/agent.js"
import type { Logger } from "../src/ports/logger.js"
import type { TraceSink } from "../src/ports/trace.js"
import { inMemoryEscalations } from "./fakes/in-memory-escalations.js"

const noopLog: Logger = {
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return noopLog
  },
}

/** App de test con el middleware que setea log/requestId (como en prod), y Telegram montado. */
function mkApp(deps: Parameters<typeof mountTelegram>[1]): Hono<{
  Variables: Variables
}> {
  const app = new Hono<{ Variables: Variables }>()
  app.use("*", async (c, next) => {
    c.set("log", noopLog)
    c.set("requestId", "r")
    await next()
  })
  mountTelegram(app, deps)
  return app
}

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch))
      c.close()
    },
  })
}

interface Calls {
  draft: number
  typing: number
  sent: string[]
}

/** Cliente fake que cuenta las llamadas y resuelve `done` cuando manda el mensaje final. */
function fakeClient(
  calls: Calls,
  done: () => void,
  draftSupported = true
): TelegramClient {
  return {
    async sendMessage(_c: number, text: string, _o?: SendOpts) {
      calls.sent.push(text)
      done()
    },
    async sendAudio(_c: number, _a: Uint8Array, _o?: SendAudioOpts) {
      return true
    },
    async sendChatAction(_c: number, _a: "typing", _o?: SendOpts) {
      calls.typing++
    },
    async sendMessageDraft(_c: number, _d: number, _t: string) {
      calls.draft++
      return draftSupported
    },
    async setWebhook() {},
  }
}

const fakeAgent = (chunks: string[], finalText: string): Agent =>
  ({
    respond: async () => ({
      stream: streamOf(chunks),
      text: Promise.resolve(finalText),
    }),
  }) as unknown as Agent

/** Agente que captura el TurnContext recibido (para verificar el threading de threadOrigin). */
const capturingAgent = (cap: { ctx?: TurnContext }): Agent =>
  ({
    respond: async (_req: unknown, ctx: TurnContext) => {
      cap.ctx = ctx
      return { stream: streamOf(["ok"]), text: Promise.resolve("ok") }
    },
  }) as unknown as Agent

/** Cliente mínimo que solo resuelve `done` al mandar el mensaje final (para los tests de wiring). */
const silentClient = (done: () => void): TelegramClient => ({
  async sendMessage() {
    done()
  },
  async sendAudio() {
    return true
  },
  async sendChatAction() {},
  async sendMessageDraft() {
    return false
  },
  async setWebhook() {},
})

const sink: TraceSink = { emit() {} }

function post(
  app: Hono<{ Variables: Variables }>,
  update: unknown
): Promise<Response> {
  return app.request("/tg", {
    method: "POST",
    headers: {
      "x-telegram-bot-api-secret-token": "s",
      "content-type": "application/json",
    },
    body: JSON.stringify(update),
  })
}

const msg = (over: Record<string, unknown>) => ({
  update_id: 1,
  message: {
    message_id: 1,
    text: "hola",
    from: { id: 42, language_code: "es" },
    ...over,
  },
})

describe("handleTurn — streaming/typing", () => {
  it("chat privado + draft soportado → streamea drafts y persiste el mensaje final", async () => {
    const calls: Calls = { draft: 0, typing: 0, sent: [] }
    let resolve!: () => void
    const done = new Promise<void>((r) => {
      resolve = r
    })
    const app = mkApp({
      agent: fakeAgent(["Hola", " mundo"], "Hola mundo"),
      client: fakeClient(calls, resolve),
      allowedIds: new Set(),
      webhookSecret: "s",
      sink,
      draftStreaming: true,
    })
    await post(app, msg({ chat: { id: 999, type: "private" } }))
    await done
    expect(calls.draft).toBeGreaterThan(0) // probe + parciales
    expect(calls.sent).toContain("Hola mundo") // mensaje final persistido
  })

  it("grupo/topic (no privado) → typing keepalive, SIN drafts", async () => {
    const calls: Calls = { draft: 0, typing: 0, sent: [] }
    let resolve!: () => void
    const done = new Promise<void>((r) => {
      resolve = r
    })
    const app = mkApp({
      agent: fakeAgent(["x"], "x"),
      client: fakeClient(calls, resolve),
      allowedIds: new Set(),
      webhookSecret: "s",
      sink,
      draftStreaming: true,
    })
    await post(app, msg({ chat: { id: -100, type: "supergroup" } }))
    await done
    expect(calls.draft).toBe(0) // no draft fuera de privado
    expect(calls.typing).toBeGreaterThan(0) // typing
    expect(calls.sent).toContain("x")
  })

  it("draft no soportado (probe false) → degrada a typing + mensaje final", async () => {
    const calls: Calls = { draft: 0, typing: 0, sent: [] }
    let resolve!: () => void
    const done = new Promise<void>((r) => {
      resolve = r
    })
    const app = mkApp({
      agent: fakeAgent(["y"], "y"),
      client: fakeClient(calls, resolve, false), // sendMessageDraft → false
      allowedIds: new Set(),
      webhookSecret: "s",
      sink,
      draftStreaming: true,
    })
    await post(app, msg({ chat: { id: 999, type: "private" } }))
    await done
    expect(calls.draft).toBe(1) // solo el probe
    expect(calls.typing).toBeGreaterThan(0) // cayó a typing
    expect(calls.sent).toContain("y")
  })
})

describe("handleTurn — conciencia del hilo (Inc 2)", () => {
  /** Siembra una escalada YA RESUELTA en el topic dado y devuelve el store listo. */
  const resolvedEsc = async (topicId: string) => {
    const es = inMemoryEscalations()
    const { id } = await es.create({
      question: "¿toca el piano?",
      kind: "knowledge",
      origin: {
        channel: "telegram",
        askerPrincipalId: "visitor1",
        locale: "es",
      },
    })
    await es.markNotified(id, "telegram", "m1", topicId)
    await es.markAnswered(id, "sí, desde chico")
    await es.linkFact(id, "fact-xyz")
    return es
  }

  it("owner en un hilo de escalada resuelta → threadOrigin llega al respond", async () => {
    const cap: { ctx?: TurnContext } = {}
    let resolve!: () => void
    const done = new Promise<void>((r) => {
      resolve = r
    })
    const app = mkApp({
      agent: capturingAgent(cap),
      client: silentClient(resolve),
      allowedIds: new Set(),
      webhookSecret: "s",
      sink,
      ownerId: 42, // el `from.id` del helper msg → trusted
      escalations: await resolvedEsc("5"),
    })
    await post(
      app,
      msg({ chat: { id: 999, type: "supergroup" }, message_thread_id: 5 })
    )
    await done
    expect(cap.ctx?.threadOrigin?.question).toBe("¿toca el piano?")
    expect(cap.ctx?.threadOrigin?.answer).toBe("sí, desde chico")
    expect(cap.ctx?.threadOrigin?.factId).toBe("fact-xyz")
  })

  it("visitante (no owner) en el mismo hilo → NO se hace lookup (sin threadOrigin)", async () => {
    const cap: { ctx?: TurnContext } = {}
    let resolve!: () => void
    const done = new Promise<void>((r) => {
      resolve = r
    })
    const app = mkApp({
      agent: capturingAgent(cap),
      client: silentClient(resolve),
      allowedIds: new Set(),
      webhookSecret: "s",
      ownerId: 7, // distinto del from.id (42) → visitante
      escalations: await resolvedEsc("5"),
    })
    await post(
      app,
      msg({ chat: { id: 999, type: "supergroup" }, message_thread_id: 5 })
    )
    await done
    expect(cap.ctx?.threadOrigin == null).toBe(true)
  })
})
