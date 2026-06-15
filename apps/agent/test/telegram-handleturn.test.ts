import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import type {
  SendAudioOpts,
  SendOpts,
  TelegramClient,
} from "../src/adapters/telegram/client.js"
import { mountTelegram } from "../src/adapters/telegram/routes.js"
import type { Agent } from "../src/core/agent.js"
import type { TraceSink } from "../src/ports/trace.js"

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

const sink: TraceSink = { emit() {} }

function post(app: Hono, update: unknown): Promise<Response> {
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
    const app = new Hono()
    mountTelegram(app, {
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
    const app = new Hono()
    mountTelegram(app, {
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
    const app = new Hono()
    mountTelegram(app, {
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
