import { describe, expect, it } from "vitest"
import { buildSystemPrompt, personaPrompt } from "../src/core/prompt.js"

describe("personaPrompt", () => {
  it("es → persona en español: nombre desambiguado + voz (voseo) + grounding duro", () => {
    const p = personaPrompt("es")
    expect(p).toContain("Vaio")
    expect(p).toContain("Tu nombre es Vaio") // no más "Sos Vaio" (el modelo leía "Sos" como apellido)
    expect(p).toContain("voseo") // la VOZ (estilo) se conserva
    expect(p).toContain("searchMemory")
    expect(p).not.toContain("You are")
    // grounding duro: hechos de Kevin SOLO de searchMemory (constraint de fuente, no "no inventes")
    expect(p.toLowerCase()).toMatch(/solo con lo que/)
  })
  it("es → voz ≠ hechos: NO afirma origen/ciudad como biografía (raíz del bug 'caleño')", () => {
    const p = personaPrompt("es")
    expect(p).not.toContain("caleño")
    expect(p).not.toContain("Palmira")
    expect(p).not.toContain("Cali")
  })
  it("en → persona en inglés (no en español) + grounding duro, sin biografía", () => {
    const p = personaPrompt("en")
    expect(p).toContain("Vaio")
    expect(p).toContain("Your name is Vaio")
    expect(p).toContain("searchMemory")
    expect(p).not.toContain("Tu nombre es Vaio")
    expect(p.toLowerCase()).toMatch(/only what/)
    expect(p).not.toContain("Palmira")
    expect(p).not.toContain("Cali")
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

  it("inyecta el bloque de propuestas pendientes con sus ids", () => {
    const p = buildSystemPrompt({ locale: "es", audience: "owner", policyText: "", summary: "",
      pendingFacts: [{ id: "f1", statement: "A Kevin no le gusta el fútbol", createdAt: null }] })
    expect(p).toContain("pendientes de tu confirmación")
    expect(p).toContain("[f1]")
    expect(p).toContain("commitFact")
  })
  it("sin pendientes, no agrega el bloque", () => {
    const p = buildSystemPrompt({ locale: "es", audience: "owner", policyText: "", summary: "" })
    expect(p).not.toContain("pendientes de tu confirmación")
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
