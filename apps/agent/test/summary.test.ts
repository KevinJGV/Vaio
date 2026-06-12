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

  it("integra el resumen previo y los mensajes nuevos, en el idioma del locale", () => {
    const { system, prompt } = buildSummaryPrompt({
      priorSummary: "El usuario es dev.",
      olderMessages: older,
      locale: "es",
    })
    expect(system).toContain("Spanish")
    expect(prompt).toContain("El usuario es dev.")
    expect(prompt).toContain("me llamo Kevin")
    expect(prompt).toContain("¡hola Kevin!")
  })

  it("marca el resumen previo vacío explícitamente", () => {
    const { prompt } = buildSummaryPrompt({
      priorSummary: "",
      olderMessages: older,
      locale: "en",
    })
    expect(prompt.toLowerCase()).toContain("(vacío)")
  })
})
