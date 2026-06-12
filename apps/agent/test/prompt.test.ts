import { describe, expect, it } from "vitest"
import { buildSystemPrompt, personaPrompt } from "../src/core/prompt.js"

describe("personaPrompt", () => {
  it("es → persona escrita en español (no en inglés)", () => {
    const p = personaPrompt("es")
    expect(p).toContain("Sos Vaio")
    expect(p).toContain("searchMemory")
    expect(p).not.toContain("You are")
  })
  it("en → persona escrita en inglés (no en español)", () => {
    const p = personaPrompt("en")
    expect(p).toContain("You are Vaio")
    expect(p).toContain("searchMemory")
    expect(p).not.toContain("Sos Vaio")
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
  it("bloque de resumen localizado y solo cuando no está vacío", () => {
    const es = buildSystemPrompt({
      locale: "es",
      policyText: "P",
      summary: "Kevin pidió X",
    })
    expect(es).toContain("Kevin pidió X")
    expect(es.toLowerCase()).toContain("resumen")

    const en = buildSystemPrompt({
      locale: "en",
      policyText: "P",
      summary: "Kevin asked X",
    })
    expect(en).toContain("Kevin asked X")
    expect(en.toLowerCase()).toContain("summary")

    const none = buildSystemPrompt({
      locale: "es",
      policyText: "P",
      summary: "   ",
    })
    expect(none.toLowerCase()).not.toContain("resumen")
  })
})
