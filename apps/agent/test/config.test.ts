import { describe, expect, it } from "vitest"
import type { Env } from "../src/config.js"
import {
  modelChain,
  multimodalChain,
  telegramAllowedIds,
  telegramEnabled,
} from "../src/config.js"

function envWith(models: string | undefined): Env {
  return { OPENROUTER_MODELS: models } as Env
}

describe("modelChain", () => {
  it("parsea lista separada por comas, trimea y filtra vacíos", () => {
    expect(modelChain(envWith("a/x, b/y ,, c/z "))).toEqual([
      "a/x",
      "b/y",
      "c/z",
    ])
  })

  it("devuelve [] si no hay OPENROUTER_MODELS", () => {
    expect(modelChain(envWith(undefined))).toEqual([])
  })

  it("preserva el orden (primario primero = cadena de fallback)", () => {
    const chain = modelChain(envWith("primary,fallback,free"))
    expect(chain[0]).toBe("primary")
    expect(chain.at(-1)).toBe("free")
  })
})

describe("multimodalChain", () => {
  it("usa MULTIMODAL_MODELS si está (csv trimeado)", () => {
    const env = { MULTIMODAL_MODELS: "g/flash, g/pro " } as Env
    expect(multimodalChain(env)).toEqual(["g/flash", "g/pro"])
  })
  it("vacío → cae al primer modelo de OPENROUTER_MODELS", () => {
    const env = { OPENROUTER_MODELS: "primary/x,fallback/y" } as Env
    expect(multimodalChain(env)).toEqual(["primary/x"])
  })
  it("sin ninguno → []", () => {
    expect(multimodalChain({} as Env)).toEqual([])
  })
})

describe("telegramAllowedIds", () => {
  it("parsea csv a Set<number>, descarta no-numéricos", () => {
    const env = { TELEGRAM_ALLOWED_USER_IDS: "42, 7 , x, 100" } as Env
    expect([...telegramAllowedIds(env)].sort((a, b) => a - b)).toEqual([
      7, 42, 100,
    ])
  })
  it("vacío → set vacío", () => {
    expect(telegramAllowedIds({} as Env).size).toBe(0)
  })
})

describe("telegramEnabled", () => {
  it("true con token + secret (allowlist opcional)", () => {
    // sin allowlist → habilitado igual (acceso abierto, control en el bot)
    expect(
      telegramEnabled({
        TELEGRAM_BOT_TOKEN: "t",
        TELEGRAM_WEBHOOK_SECRET: "s",
      } as Env)
    ).toBe(true)
    // con allowlist → también habilitado (modo whitelist)
    expect(
      telegramEnabled({
        TELEGRAM_BOT_TOKEN: "t",
        TELEGRAM_WEBHOOK_SECRET: "s",
        TELEGRAM_ALLOWED_USER_IDS: "42",
      } as Env)
    ).toBe(true)
  })
  it("false si falta token o secret", () => {
    expect(telegramEnabled({ TELEGRAM_BOT_TOKEN: "t" } as Env)).toBe(false)
    expect(telegramEnabled({ TELEGRAM_WEBHOOK_SECRET: "s" } as Env)).toBe(false)
    expect(telegramEnabled({} as Env)).toBe(false)
  })
})
