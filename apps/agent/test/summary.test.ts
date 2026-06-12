import { describe, expect, it } from "vitest"
import { buildSummaryPrompt, shouldSummarize } from "../src/core/summary.js"
import type { StoredMessage } from "../src/ports/conversation.js"

describe("shouldSummarize", () => {
  it("false debajo del threshold", () => {
    expect(shouldSummarize({ messageCount: 11, threshold: 12 })).toBe(false)
  })
  it("true al alcanzar/pasar el threshold", () => {
    expect(shouldSummarize({ messageCount: 12, threshold: 12 })).toBe(true)
    expect(shouldSummarize({ messageCount: 20, threshold: 12 })).toBe(true)
  })
})

describe("buildSummaryPrompt", () => {
  const older: StoredMessage[] = [
    { role: "user", content: "me llamo Kevin" },
    { role: "assistant", content: "¡hola Kevin!" },
  ]

  it("es → instrucciones en español; integra resumen previo + mensajes", () => {
    const { system, prompt } = buildSummaryPrompt({
      priorSummary: "El usuario es dev.",
      olderMessages: older,
      locale: "es",
    })
    expect(system).toContain("español")
    expect(prompt).toContain("El usuario es dev.")
    expect(prompt).toContain("me llamo Kevin")
    expect(prompt).toContain("¡hola Kevin!")
  })

  it("en → instrucciones en inglés y resumen previo vacío como '(empty)'", () => {
    const { system, prompt } = buildSummaryPrompt({
      priorSummary: "",
      olderMessages: older,
      locale: "en",
    })
    expect(system).toContain("English")
    expect(prompt.toLowerCase()).toContain("(empty)")
  })
})
