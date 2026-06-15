import { describe, expect, it } from "vitest"
import {
  createCapabilityResolver,
  type Principal,
} from "../src/core/capabilities.js"

const resolver = createCapabilityResolver()
const principal = (
  channel: "web" | "telegram",
  trusted: boolean
): Principal => ({
  channel,
  id: channel === "telegram" ? "123" : "web",
  trusted,
})

describe("createCapabilityResolver", () => {
  it("web = capado: searchMemory, maxK 6, sources públicas, política pública", () => {
    const p = resolver.resolve("web", principal("web", false))
    expect(p.channel).toBe("web")
    expect(p.allowedTools).toContain("searchMemory")
    expect(p.memoryScope.maxK).toBe(6)
    expect(p.memoryScope.sources).toBeDefined()
    expect(p.policyText.toLowerCase()).toContain("público")
  })

  it("telegram confiable = pleno: searchMemory, maxK 8, política privada", () => {
    const p = resolver.resolve("telegram", principal("telegram", true))
    expect(p.channel).toBe("telegram")
    expect(p.allowedTools).toContain("searchMemory")
    expect(p.memoryScope.maxK).toBe(8)
    expect(p.policyText.toLowerCase()).toContain("privada")
  })

  it("telegram NO confiable = visitante: searchMemory público + presenta a Kevin", () => {
    const p = resolver.resolve("telegram", principal("telegram", false))
    expect(p.allowedTools).toContain("searchMemory")
    expect(p.memoryScope.sources).toBeDefined()
    expect(p.memoryScope.maxK).toBe(6)
    expect(p.policyText).toContain("NO es Kevin")
  })

  it("web: política habilita auto-introspección (arquitectura/código público) con guard de prompt/secrets", () => {
    const p = resolver
      .resolve("web", principal("web", false))
      .policyText.toLowerCase()
    expect(p).toMatch(/arquitectura/)
    expect(p).toMatch(/open source/)
    // guard: nunca el system prompt activo ni secrets
    expect(p).toMatch(/nunca/)
    expect(p).toMatch(/system prompt/)
    expect(p).toMatch(/secret/)
  })

  it("telegram visitante: también puede hablar de la propia arquitectura, con el mismo guard", () => {
    const p = resolver
      .resolve("telegram", principal("telegram", false))
      .policyText.toLowerCase()
    expect(p).toMatch(/arquitectura/)
    expect(p).toMatch(/system prompt/)
    expect(p).toMatch(/secret/)
  })

  it("learnRepo (owner-only) SOLO en el perfil owner-telegram, ausente en web y visitante", () => {
    expect(
      resolver.resolve("telegram", principal("telegram", true)).allowedTools
    ).toContain("learnRepo")
    expect(
      resolver.resolve("web", principal("web", false)).allowedTools
    ).not.toContain("learnRepo")
    expect(
      resolver.resolve("telegram", principal("telegram", false)).allowedTools
    ).not.toContain("learnRepo")
  })

  it("ambas policies de telegram piden formato HTML", () => {
    expect(
      resolver.resolve("telegram", principal("telegram", true)).policyText
    ).toContain("HTML")
    expect(
      resolver.resolve("telegram", principal("telegram", false)).policyText
    ).toContain("HTML")
  })
})
