import { afterEach, describe, expect, it } from "vitest"
import {
  createTelegramClient,
  splitForTelegram,
} from "../src/adapters/telegram/client.js"
import {
  conversationKeyFor,
  detectTelegramLocale,
  isOwnerId,
  type NormalizeResult,
  normalizeUpdate,
} from "../src/adapters/telegram/normalize.js"
import type { Logger } from "../src/ports/logger.js"

const allowed = new Set<number>([42])

function update(over: Record<string, unknown> = {}): unknown {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      text: "hola",
      chat: { id: 999 },
      from: { id: 42, language_code: "es-AR" },
      ...over,
    },
  }
}

describe("detectTelegramLocale", () => {
  it("es* → es, en → en, vacío → es", () => {
    expect(detectTelegramLocale("es-AR")).toBe("es")
    expect(detectTelegramLocale("en")).toBe("en")
    expect(detectTelegramLocale(undefined)).toBe("es")
    expect(detectTelegramLocale("fr")).toBe("en")
  })
})

describe("normalizeUpdate", () => {
  it("mensaje de texto de un user allowlisted → turn", () => {
    const r = normalizeUpdate(update(), allowed)
    expect(r).toEqual({
      kind: "turn",
      updateId: 1,
      chatId: 999,
      fromId: 42,
      text: "hola",
      locale: "es",
    })
  })

  it("sin texto → ignore(no-text)", () => {
    const r = normalizeUpdate(update({ text: undefined }), allowed)
    expect(r).toMatchObject({ kind: "ignore", reason: "no-text" })
  })

  it("sin from → ignore(no-from)", () => {
    const r = normalizeUpdate(update({ from: undefined }), allowed)
    expect(r).toMatchObject({ kind: "ignore", reason: "no-from" })
  })

  it("user fuera de la allowlist (no vacía) → ignore(not-allowlisted)", () => {
    const r = normalizeUpdate(
      update({ from: { id: 7, language_code: "es" } }),
      allowed
    )
    expect(r).toMatchObject({ kind: "ignore", reason: "not-allowlisted" })
  })

  it("allowlist vacía → cualquier user pasa (acceso abierto, gating en el bot)", () => {
    const r = normalizeUpdate(
      update({ from: { id: 7, language_code: "es" } }),
      new Set<number>()
    )
    expect(r).toMatchObject({ kind: "turn", fromId: 7 })
  })

  it("update con message_thread_id → threadId en el turn", () => {
    const r = normalizeUpdate(update({ message_thread_id: 77 }), allowed)
    expect(r).toMatchObject({ kind: "turn", chatId: 999, threadId: 77 })
  })

  it("update sin message_thread_id → sin threadId", () => {
    const r = normalizeUpdate(update(), allowed) as Extract<
      NormalizeResult,
      { kind: "turn" }
    >
    expect(r.threadId).toBeUndefined()
  })

  it("input basura no rompe → ignore", () => {
    expect(normalizeUpdate(null, allowed)).toMatchObject({ kind: "ignore" })
    expect(normalizeUpdate(42, allowed)).toMatchObject({ kind: "ignore" })
  })
})

describe("conversationKeyFor", () => {
  it("sin thread → chatId; con thread → chatId:threadId", () => {
    expect(conversationKeyFor(999)).toBe("999")
    expect(conversationKeyFor(999, 77)).toBe("999:77")
  })
})

describe("isOwnerId", () => {
  it("match sólo con el owner; sin owner configurado → nadie", () => {
    expect(isOwnerId(42, 42)).toBe(true)
    expect(isOwnerId(42, 7)).toBe(false)
    expect(isOwnerId(undefined, 42)).toBe(false)
  })
})

const noopLogger = {
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return noopLogger
  },
} as unknown as Logger

describe("createTelegramClient.sendMessage", () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it("manda parse_mode HTML; ante no-2xx reintenta en texto plano", async () => {
    const calls: Record<string, unknown>[] = []
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      calls.push(body)
      const ok = body.parse_mode === undefined // HTML → 400; plano → 200
      return new Response(ok ? "{}" : "bad", { status: ok ? 200 : 400 })
    }) as typeof fetch

    await createTelegramClient("T", noopLogger).sendMessage(123, "<b>hola")
    expect(calls).toHaveLength(2)
    expect(calls[0]?.parse_mode).toBe("HTML")
    expect(calls[1]?.parse_mode).toBeUndefined()
    expect(calls[1]?.text).toBe("<b>hola")
  })

  it("incluye message_thread_id cuando se pasa (responde en el topic)", async () => {
    const calls: Record<string, unknown>[] = []
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return new Response("{}", { status: 200 })
    }) as typeof fetch

    await createTelegramClient("T", noopLogger).sendMessage(123, "hola", {
      messageThreadId: 5,
    })
    expect(calls[0]?.message_thread_id).toBe(5)
  })
})

describe("splitForTelegram", () => {
  it("texto corto → una sola parte", () => {
    expect(splitForTelegram("hola")).toEqual(["hola"])
  })

  it("trocea respetando el límite de 4096", () => {
    const long = "a".repeat(5000)
    const parts = splitForTelegram(long)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every((p) => p.length <= 4096)).toBe(true)
    expect(parts.join("")).toBe(long)
  })
})
