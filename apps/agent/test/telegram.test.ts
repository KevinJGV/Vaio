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
  it("mensaje de texto de un user allowlisted → turn (attachments vacío)", () => {
    const r = normalizeUpdate(update(), allowed)
    expect(r).toEqual({
      kind: "turn",
      updateId: 1,
      chatId: 999,
      fromId: 42,
      text: "hola",
      attachments: [],
      locale: "es",
      isPrivate: false, // chat sin type → no privado
    })
  })

  it("chat.type='private' → turn.isPrivate true (habilita el streaming por draft)", () => {
    const r = normalizeUpdate(
      update({ chat: { id: 999, type: "private" } }),
      allowed
    )
    expect(r).toMatchObject({ kind: "turn", isPrivate: true })
  })

  it("sin texto ni media → ignore(no-content)", () => {
    const r = normalizeUpdate(update({ text: undefined }), allowed)
    expect(r).toMatchObject({ kind: "ignore", reason: "no-content" })
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

  it("nota de voz → turn con attachment de audio", () => {
    const r = normalizeUpdate(
      update({
        text: undefined,
        voice: { file_id: "v1", mime_type: "audio/ogg" },
      }),
      allowed
    )
    expect(r).toMatchObject({
      kind: "turn",
      text: "",
      attachments: [{ kind: "audio", fileId: "v1", mediaType: "audio/ogg" }],
    })
  })

  it("foto (varios tamaños desordenados) → toma el de mayor file_size", () => {
    const r = normalizeUpdate(
      update({
        text: undefined,
        photo: [
          { file_id: "small", file_size: 100, width: 90, height: 90 },
          { file_id: "big", file_size: 9000, width: 1280, height: 1280 },
          { file_id: "mid", file_size: 1500, width: 320, height: 320 },
        ],
      }),
      allowed
    ) as Extract<NormalizeResult, { kind: "turn" }>
    expect(r.kind).toBe("turn")
    expect(r.attachments).toEqual([
      { kind: "image", fileId: "big", mediaType: "image/jpeg" },
    ])
  })

  it("foto con caption → el caption es el texto del turno", () => {
    const r = normalizeUpdate(
      update({
        text: undefined,
        caption: "mirá mi gato",
        photo: [{ file_id: "p1", file_size: 10, width: 10, height: 10 }],
      }),
      allowed
    )
    expect(r).toMatchObject({ kind: "turn", text: "mirá mi gato" })
  })

  it("foto sin caption → text vacío pero attachment presente", () => {
    const r = normalizeUpdate(
      update({
        text: undefined,
        photo: [{ file_id: "p1", file_size: 10, width: 10, height: 10 }],
      }),
      allowed
    ) as Extract<NormalizeResult, { kind: "turn" }>
    expect(r.text).toBe("")
    expect(r.attachments).toHaveLength(1)
  })

  it("document PDF → unsupported (no ignore silencioso)", () => {
    const r = normalizeUpdate(
      update({
        text: undefined,
        document: { file_id: "d1", mime_type: "application/pdf" },
      }),
      allowed
    )
    expect(r).toMatchObject({ kind: "unsupported", chatId: 999 })
  })

  it("document con mime image/* → tratado como imagen", () => {
    const r = normalizeUpdate(
      update({
        text: undefined,
        document: { file_id: "d1", mime_type: "image/png" },
      }),
      allowed
    )
    expect(r).toMatchObject({
      kind: "turn",
      attachments: [{ kind: "image", fileId: "d1", mediaType: "image/png" }],
    })
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
    expect(calls[0]?.text).toBe("<b>hola") // `<b>` es soportado → se conserva en el intento HTML
    expect(calls[1]?.parse_mode).toBeUndefined()
    expect(calls[1]?.text).toBe("hola") // fallback texto plano: SIN tags (no se ven crudos)
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

describe("createTelegramClient.sendMessageDraft", () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it("postea draft_id + text plano (sin parse_mode) y devuelve ok", async () => {
    let url = ""
    let body: Record<string, unknown> = {}
    globalThis.fetch = (async (u: string, init?: RequestInit) => {
      url = String(u)
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response('{"ok":true,"result":true}', { status: 200 })
    }) as typeof fetch

    const ok = await createTelegramClient("T", noopLogger).sendMessageDraft(
      123,
      77,
      "parcial"
    )
    expect(ok).toBe(true)
    expect(url).toContain("/sendMessageDraft")
    expect(body).toMatchObject({ chat_id: 123, draft_id: 77, text: "parcial" })
    expect(body.parse_mode).toBeUndefined() // plano (HTML a medias rompería)
  })

  it("no-2xx (bot no lo soporta) → false (el llamador degrada a typing)", async () => {
    globalThis.fetch = (async () =>
      new Response("not found", { status: 404 })) as typeof fetch
    const ok = await createTelegramClient("T", noopLogger).sendMessageDraft(
      1,
      2,
      ""
    )
    expect(ok).toBe(false)
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
