import { describe, expect, it } from "vitest"
import { buildSystemPrompt, personaPrompt } from "../src/core/prompt.js"

describe("personaPrompt", () => {
  it("es → persona en español: nombre 'Vaio' desambiguado + origen palmireño", () => {
    const p = personaPrompt("es")
    expect(p).toContain("Vaio")
    expect(p).toContain("Tu nombre es Vaio") // no más "Sos Vaio" (el modelo leía "Sos" como apellido)
    expect(p).toContain("Palmira")
    expect(p).toContain("searchMemory")
    expect(p).not.toContain("You are")
  })
  it("en → persona en inglés (no en español)", () => {
    const p = personaPrompt("en")
    expect(p).toContain("Vaio")
    expect(p).toContain("Your name is Vaio")
    expect(p).toContain("searchMemory")
    expect(p).not.toContain("Tu nombre es Vaio")
  })
})

describe("buildSystemPrompt", () => {
  it("compone persona + policyText cuando hay política", () => {
    const out = buildSystemPrompt({
      locale: "es",
      audience: "owner",
      policyText: "POLICY_CANAL",
      summary: "",
    })
    expect(out).toContain("Vaio")
    expect(out).toContain("POLICY_CANAL")
  })

  it("bloque de identidad según audience (owner / visitor / public)", () => {
    const owner = buildSystemPrompt({
      locale: "es",
      audience: "owner",
      policyText: "P",
      summary: "",
    })
    expect(owner).toContain("Kevin (Vin) en persona")

    const visitor = buildSystemPrompt({
      locale: "es",
      audience: "visitor",
      policyText: "P",
      summary: "",
    })
    expect(visitor).toContain("NO estás hablando con Kevin")

    const pub = buildSystemPrompt({
      locale: "es",
      audience: "public",
      policyText: "P",
      summary: "",
    })
    expect(pub).not.toContain("Kevin (Vin) en persona")
    expect(pub).not.toContain("NO estás hablando con Kevin")
  })

  it("identidad localizada en inglés", () => {
    const owner = buildSystemPrompt({
      locale: "en",
      audience: "owner",
      policyText: "P",
      summary: "",
    })
    expect(owner).toContain("Kevin (Vin) himself")
  })

  it("bloque de resumen localizado y solo cuando no está vacío", () => {
    const es = buildSystemPrompt({
      locale: "es",
      audience: "owner",
      policyText: "P",
      summary: "Kevin pidió X",
    })
    expect(es).toContain("Kevin pidió X")
    expect(es.toLowerCase()).toContain("resumen")

    const en = buildSystemPrompt({
      locale: "en",
      audience: "owner",
      policyText: "P",
      summary: "Kevin asked X",
    })
    expect(en).toContain("Kevin asked X")
    expect(en.toLowerCase()).toContain("summary")

    const none = buildSystemPrompt({
      locale: "es",
      audience: "owner",
      policyText: "P",
      summary: "   ",
    })
    expect(none.toLowerCase()).not.toContain("resumen")
  })
})
