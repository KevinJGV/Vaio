import { describe, expect, it } from "vitest"
import type { OwnerRepo } from "../src/core/repo-resolve.js"
import { normalizeRepoName, resolveRepoName } from "../src/core/repo-resolve.js"

const r = (name: string): OwnerRepo => ({ name, defaultBranch: "main" })

describe("normalizeRepoName", () => {
  it("baja a minúsculas y colapsa separadores (-_ .) y espacios", () => {
    expect(normalizeRepoName("Vaio")).toBe("vaio")
    expect(normalizeRepoName("vaio-web")).toBe("vaioweb")
    expect(normalizeRepoName("vaio_web")).toBe("vaioweb")
    expect(normalizeRepoName("vaio web")).toBe("vaioweb")
    expect(normalizeRepoName("clon.ai")).toBe("clonai")
  })
})

describe("resolveRepoName", () => {
  it("exacto normalizado único → match (case-insensitive; gana sobre substring)", () => {
    const res = resolveRepoName("vaio", [r("Vaio"), r("vaio-web")])
    expect(res).toEqual({ kind: "match", repo: r("Vaio") })
  })

  it("separador-insensitive → match", () => {
    const res = resolveRepoName("vaio_web", [r("vaio-web")])
    expect(res).toEqual({ kind: "match", repo: r("vaio-web") })
  })

  it("un solo substring → match (clear, sin doble confirmación)", () => {
    const res = resolveRepoName("portfol", [r("portfolio"), r("clon-ai")])
    expect(res).toEqual({ kind: "match", repo: r("portfolio") })
  })

  it("varios substring → ambiguous (lista candidatos, no asume)", () => {
    const res = resolveRepoName("port", [r("portfolio"), r("portafolio")])
    expect(res.kind).toBe("ambiguous")
    if (res.kind === "ambiguous")
      expect(res.candidates.map((c) => c.name).sort()).toEqual([
        "portafolio",
        "portfolio",
      ])
  })

  it("typo cercano sin substring → none con sugerencia (no auto-match)", () => {
    const res = resolveRepoName("vario", [r("vaio"), r("web")])
    expect(res.kind).toBe("none")
    if (res.kind === "none") expect(res.suggestions).toContain("vaio")
  })

  it("sin match alguno → none", () => {
    const res = resolveRepoName("zzzzz", [r("vaio"), r("web")])
    expect(res.kind).toBe("none")
  })

  it("lista vacía → none con suggestions []", () => {
    expect(resolveRepoName("vaio", [])).toEqual({
      kind: "none",
      suggestions: [],
    })
  })
})
