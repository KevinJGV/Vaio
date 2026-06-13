import { describe, expect, it } from "vitest"
import { splitForTelegram } from "../src/adapters/telegram/client.js"
import {
  detectTelegramLocale,
  normalizeUpdate,
} from "../src/adapters/telegram/normalize.js"

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

  it("input basura no rompe → ignore", () => {
    expect(normalizeUpdate(null, allowed)).toMatchObject({ kind: "ignore" })
    expect(normalizeUpdate(42, allowed)).toMatchObject({ kind: "ignore" })
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
