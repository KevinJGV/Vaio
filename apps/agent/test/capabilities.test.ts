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

  it("ambas policies de telegram piden formato HTML", () => {
    expect(
      resolver.resolve("telegram", principal("telegram", true)).policyText
    ).toContain("HTML")
    expect(
      resolver.resolve("telegram", principal("telegram", false)).policyText
    ).toContain("HTML")
  })
})
