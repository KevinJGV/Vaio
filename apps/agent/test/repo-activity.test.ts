import { describe, expect, it } from "vitest"
import {
  groupPRsByRepo,
  type OpenPR,
  parseRepoFromUrl,
} from "../src/core/repo-activity.js"

describe("parseRepoFromUrl", () => {
  it("extrae el repo de una repository_url estándar", () => {
    expect(parseRepoFromUrl("https://api.github.com/repos/KevinJGV/Vaio")).toBe(
      "Vaio"
    )
  })
  it("tolera barra final", () => {
    expect(
      parseRepoFromUrl("https://api.github.com/repos/KevinJGV/ACME/")
    ).toBe("ACME")
  })
  it("url que no matchea → null", () => {
    expect(parseRepoFromUrl("https://example.com/foo")).toBeNull()
    expect(parseRepoFromUrl("")).toBeNull()
  })
})

describe("groupPRsByRepo", () => {
  const pr = (repo: string, number: number): OpenPR => ({
    repo,
    number,
    title: `t${number}`,
    url: `u${number}`,
  })

  it("agrupa por repo preservando el orden de aparición", () => {
    const g = groupPRsByRepo([pr("Vaio", 1), pr("ACME", 2), pr("Vaio", 3)])
    expect([...g.keys()]).toEqual(["Vaio", "ACME"]) // orden de 1ª aparición
    expect(g.get("Vaio")?.map((p) => p.number)).toEqual([1, 3])
    expect(g.get("ACME")?.map((p) => p.number)).toEqual([2])
  })

  it("lista vacía → mapa vacío", () => {
    expect(groupPRsByRepo([]).size).toBe(0)
  })
})
