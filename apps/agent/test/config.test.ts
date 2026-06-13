import { describe, expect, it } from "vitest"
import type { Env } from "../src/config.js"
import {
  modelChain,
  speechChain,
  telegramAllowedIds,
  telegramEnabled,
  transcribeModel,
  visionChain,
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

describe("envs por modalidad (fase 2)", () => {
  it("visionChain usa VISION_MODELS; si no, cae a MULTIMODAL_MODELS; si no, al 1er chat", () => {
    expect(visionChain({ VISION_MODELS: "v/a, v/b " } as Env)).toEqual([
      "v/a",
      "v/b",
    ])
    expect(visionChain({ MULTIMODAL_MODELS: "m/x" } as Env)).toEqual(["m/x"])
    expect(visionChain({ OPENROUTER_MODELS: "c/1,c/2" } as Env)).toEqual([
      "c/1",
    ])
    expect(visionChain({} as Env)).toEqual([])
  })
  it("transcribeModel usa TRANSCRIBE_MODEL; si no, el fallback multimodal[0]", () => {
    expect(transcribeModel({ TRANSCRIBE_MODEL: " stt/x " } as Env)).toBe(
      "stt/x"
    )
    expect(transcribeModel({ MULTIMODAL_MODELS: "m/x,m/y" } as Env)).toBe("m/x")
    expect(transcribeModel({ OPENROUTER_MODELS: "c/1" } as Env)).toBe("c/1")
    expect(transcribeModel({} as Env)).toBeUndefined()
  })
  it("speechChain: parsea model|voice|format por entrada (fallback client-side)", () => {
    expect(
      speechChain({
        SPEECH_MODELS: "k/o|af_bella|mp3, g/tts|Zephyr|pcm ",
      } as Env)
    ).toEqual([
      { model: "k/o", voice: "af_bella", format: "mp3" },
      { model: "g/tts", voice: "Zephyr", format: "pcm" },
    ])
  })
  it("speechChain: voz omitida → 'alloy'; formato omitido/ inválido → mp3", () => {
    expect(speechChain({ SPEECH_MODELS: "k/o" } as Env)).toEqual([
      { model: "k/o", voice: "alloy", format: "mp3" },
    ])
    expect(speechChain({ SPEECH_MODELS: "k/o|v|xyz" } as Env)).toEqual([
      { model: "k/o", voice: "v", format: "mp3" },
    ])
  })
  it("speechChain: vacío → []", () => {
    expect(speechChain({} as Env)).toEqual([])
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
