import { describe, expect, it } from "vitest"
import { buildSystemPrompt, personaPrompt } from "../src/core/prompt.js"

describe("personaPrompt", () => {
  it("instruye responder en español por defecto", () => {
    expect(personaPrompt("es")).toContain("Spanish")
    expect(personaPrompt("es")).not.toContain("English")
  })
  it("instruye responder en inglés con locale en", () => {
    expect(personaPrompt("en")).toContain("English")
  })
  it("incluye la identidad de Vaio y la regla de no inventar", () => {
    const p = personaPrompt("es")
    expect(p).toContain("Vaio")
    expect(p).toContain("searchMemory")
  })
})

describe("buildSystemPrompt", () => {
  it("compone persona + policyText cuando hay política", () => {
    const out = buildSystemPrompt({
      locale: "es",
      policyText: "POLICY_CANAL",
      summary: "",
    })
    expect(out).toContain("Vaio")
    expect(out).toContain("POLICY_CANAL")
  })
  it("agrega el bloque de resumen SOLO cuando summary no está vacío", () => {
    const withSummary = buildSystemPrompt({
      locale: "es",
      policyText: "P",
      summary: "Kevin pidió X",
    })
    expect(withSummary).toContain("Kevin pidió X")
    expect(withSummary.toLowerCase()).toContain("resumen")

    const without = buildSystemPrompt({
      locale: "es",
      policyText: "P",
      summary: "   ",
    })
    expect(without.toLowerCase()).not.toContain("resumen")
  })
})
