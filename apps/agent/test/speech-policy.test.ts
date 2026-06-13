import { describe, expect, it } from "vitest"
import { shouldSpeak, stripForSpeech } from "../src/core/speech-policy.js"

describe("shouldSpeak", () => {
  it("default: texto (sin audio entrante ni pedido) → false", () => {
    expect(shouldSpeak({ inboundHadAudio: false, userText: "hola" })).toBe(
      false
    )
  })

  it("espejo: el turno entrante trajo audio → true", () => {
    expect(shouldSpeak({ inboundHadAudio: true, userText: "" })).toBe(true)
  })

  it("orden explícita ES → true (sin audio entrante)", () => {
    for (const t of [
      "respondeme con voz por favor",
      "respondé en voz",
      "hablame",
      "mandame un audio",
      "/voz contame de Kevin",
    ]) {
      expect(shouldSpeak({ inboundHadAudio: false, userText: t })).toBe(true)
    }
  })

  it("orden explícita EN → true", () => {
    for (const t of ["reply in voice", "send me a voice note", "/voice hi"]) {
      expect(shouldSpeak({ inboundHadAudio: false, userText: t })).toBe(true)
    }
  })

  it("texto normal que MENCIONA voz pero no la pide → false", () => {
    expect(
      shouldSpeak({
        inboundHadAudio: false,
        userText: "¿Kevin tiene buena voz para cantar?",
      })
    ).toBe(false)
  })
})

describe("stripForSpeech", () => {
  it("saca tags HTML", () => {
    expect(stripForSpeech("<b>hola</b> <i>mundo</i>")).toBe("hola mundo")
  })
  it("saca markdown básico (**, _, #, `, links)", () => {
    expect(stripForSpeech("**hola** _mundo_ `code`")).toContain("hola")
    expect(stripForSpeech("**hola**")).not.toContain("*")
    expect(stripForSpeech("[texto](https://x.com)")).toContain("texto")
    expect(stripForSpeech("[texto](https://x.com)")).not.toContain("http")
  })
  it("colapsa espacios y recorta", () => {
    expect(stripForSpeech("  hola   mundo \n\n ")).toBe("hola mundo")
  })
})
