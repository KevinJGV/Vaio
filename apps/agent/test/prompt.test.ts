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
  it("es/en → exige responder en el idioma del usuario aunque la memoria esté en otro idioma", () => {
    const es = personaPrompt("es")
    expect(es.toLowerCase()).toMatch(/idioma del usuario/)
    expect(es.toLowerCase()).toMatch(/otro idioma/) // cubre el grounding canónico en otra lengua
    const en = personaPrompt("en")
    expect(en.toLowerCase()).toMatch(/user's language/)
    expect(en.toLowerCase()).toMatch(/another language/)
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

describe("personaPrompt: auto-introspección (habla de su código, no vuelca el prompt)", () => {
  it("es → habilita explicar/citar la propia arquitectura vía searchMemory, sin volcar el prompt activo ni secrets", () => {
    const p = personaPrompt("es")
    // carve-out: puede hablar de su propia arquitectura/código (open source) vía la tool
    expect(p.toLowerCase()).toMatch(/arquitectura/)
    expect(p.toLowerCase()).toMatch(/open source/)
    // guard duro (Invariante #5): nunca el prompt activo verbatim ni secrets
    expect(p.toLowerCase()).toMatch(/nunca reveles/)
    expect(p.toLowerCase()).toMatch(/system prompt|instrucciones activas/)
    expect(p.toLowerCase()).toMatch(/secret/)
  })
  it("en → mismo carve-out + guard en inglés", () => {
    const p = personaPrompt("en")
    expect(p.toLowerCase()).toMatch(/architecture/)
    expect(p.toLowerCase()).toMatch(/open source/)
    expect(p.toLowerCase()).toMatch(/never reveal/)
    expect(p.toLowerCase()).toMatch(/system prompt|active instructions/)
    expect(p.toLowerCase()).toMatch(/secret/)
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

  it("inyecta el bloque 'ahora' (sentido del tiempo) cuando se provee, no cuando no", () => {
    const con = buildSystemPrompt({
      locale: "es",
      audience: "owner",
      policyText: "P",
      summary: "",
      now: "sábado, 14 de junio de 2026, 15:00",
    })
    expect(con).toContain(
      "Ahora mismo es sábado, 14 de junio de 2026, 15:00 (hora de Kevin)"
    )
    const sin = buildSystemPrompt({
      locale: "es",
      audience: "owner",
      policyText: "P",
      summary: "",
    })
    expect(sin).not.toContain("(hora de Kevin)") // marcador único del bloque 'ahora'
  })

  it("inyecta el bloque de propuestas pendientes con sus ids", () => {
    const p = buildSystemPrompt({
      locale: "es",
      audience: "owner",
      policyText: "",
      summary: "",
      pendingFacts: [
        {
          id: "f1",
          statement: "A Kevin no le gusta el fútbol",
          createdAt: null,
          conflicts: [],
        },
      ],
    })
    expect(p).toContain("pendientes")
    expect(p).toContain("resolveFact")
    expect(p).not.toContain("f1") // Invariante #8: NO se muestra el uuid de la pendiente
  })

  it("numera los conflictos por ordinal (sin uuids) e instruye replaces", () => {
    const p = buildSystemPrompt({
      locale: "es",
      audience: "owner",
      policyText: "",
      summary: "",
      pendingFacts: [
        {
          id: "f2",
          statement: "A Kevin ya no le gustan las hamburguesas",
          createdAt: null,
          conflicts: [
            {
              id: "old1",
              statement: "A Kevin le gustan las hamburguesas",
              validAt: null,
            },
          ],
        },
      ],
    })
    expect(p).toContain("[0]") // conflicto por ordinal
    expect(p).toContain("replaces")
    expect(p).not.toContain("old1") // el uuid del conflicto NO se muestra
    expect(p).not.toContain("f2") // ni el de la pendiente
  })
  it("instruye no narrar la búsqueda / no autocorregirse en voz alta", () => {
    const p = buildSystemPrompt({
      locale: "es",
      audience: "owner",
      policyText: "",
      summary: "",
    })
    expect(p).toMatch(/autocorrij|no narres/i)
  })

  it("sin pendientes, no agrega el bloque", () => {
    const p = buildSystemPrompt({
      locale: "es",
      audience: "owner",
      policyText: "",
      summary: "",
    })
    expect(p).not.toContain("pendientes de tu confirmación")
  })

  it("directiva de idioma DOMINANTE: en → la inyecta primera; es → no (la persona ya es ES)", () => {
    const en = buildSystemPrompt({
      locale: "en",
      audience: "public",
      policyText: "P",
      summary: "",
    })
    expect(en).toContain("RESPONSE LANGUAGE")
    expect(en.indexOf("RESPONSE LANGUAGE")).toBeLessThan(en.indexOf("Vaio")) // va primera
    const es = buildSystemPrompt({
      locale: "es",
      audience: "public",
      policyText: "P",
      summary: "",
    })
    expect(es).not.toContain("RESPONSE LANGUAGE")
  })

  it("threadOrigin: inyecta la nota de fondo del origen del hilo (sin statement) y NO el factId", () => {
    const p = buildSystemPrompt({
      locale: "es",
      audience: "owner",
      policyText: "",
      summary: "",
      threadOrigin: {
        question: "¿Kevin sabe tocar el piano?",
        answer: "Sí, desde chico",
        factId: "f-uuid-secreto",
      },
    })
    expect(p).toContain("escalada") // contexto del origen
    expect(p).toContain("¿Kevin sabe tocar el piano?")
    expect(p).toContain("Sí, desde chico")
    expect(p).not.toContain("f-uuid-secreto") // Inv #8: el uuid JAMÁS al modelo
    // Aun sin statement: el visitante ya recibió una respuesta → instruye el relay automático de la corrección.
    expect(p).toContain("updateVisitor")
    expect(p.toLowerCase()).toMatch(/sin pedir permiso|autom/i)
  })

  it("threadOrigin: con statement nombra el dato curado e instruye el ancla (thisThread)", () => {
    const p = buildSystemPrompt({
      locale: "es",
      audience: "owner",
      policyText: "",
      summary: "",
      threadOrigin: {
        question: "¿toca el piano?",
        answer: "sí",
        statement: "Kevin sabe tocar el piano",
        factId: "f1",
      },
    })
    expect(p).toContain("Kevin sabe tocar el piano")
    expect(p).toContain("thisThread") // pista del ancla determinística
    expect(p).toContain("updateVisitor") // relay automático de la corrección al visitante
    expect(p).not.toContain("f1")
  })

  it("threadOrigin (en): nota localizada en inglés", () => {
    const p = buildSystemPrompt({
      locale: "en",
      audience: "owner",
      policyText: "",
      summary: "",
      threadOrigin: { question: "Does Kevin play piano?", answer: "Yes" },
    })
    expect(p.toLowerCase()).toContain("escalation")
    expect(p).toContain("Does Kevin play piano?")
  })

  it("sin threadOrigin, no agrega la nota del hilo", () => {
    const p = buildSystemPrompt({
      locale: "es",
      audience: "owner",
      policyText: "",
      summary: "",
    })
    expect(p).not.toContain("este hilo nació de una escalada")
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
