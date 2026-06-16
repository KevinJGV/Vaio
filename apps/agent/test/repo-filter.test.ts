import { describe, expect, it } from "vitest"
import { filterRepos } from "../src/core/repo-filter.js"
import type { OwnerRepo } from "../src/core/repo-resolve.js"

const repos: OwnerRepo[] = [
  {
    name: "ACME",
    defaultBranch: "main",
    language: "Java",
    topics: ["jdbc"],
    description: "control de acceso",
  },
  {
    name: "Vaio",
    defaultBranch: "main",
    language: "TypeScript",
    topics: ["agent", "ai"],
    description: "agente",
  },
  {
    name: "Tienda",
    defaultBranch: "main",
    language: "Java",
    topics: ["sql"],
    description: "tienda",
  },
]

describe("filterRepos", () => {
  it("filtra por lenguaje (case-insensitive)", () => {
    const r = filterRepos(repos, { language: "java" })
    expect(r.matched.map((x) => x.name)).toEqual(["ACME", "Tienda"])
    expect(r.unknownLanguage).toBeUndefined()
  })

  it("filtra por topic", () => {
    expect(
      filterRepos(repos, { topic: "ai" }).matched.map((x) => x.name)
    ).toEqual(["Vaio"])
  })

  it("lenguaje + topic = AND", () => {
    expect(
      filterRepos(repos, { language: "java", topic: "sql" }).matched.map(
        (x) => x.name
      )
    ).toEqual(["Tienda"])
  })

  it("lenguaje inexistente → unknownLanguage + availableLanguages (fallo visible)", () => {
    const r = filterRepos(repos, { language: "rust" })
    expect(r.unknownLanguage).toBe("rust")
    expect(r.availableLanguages.sort()).toEqual(["Java", "TypeScript"])
  })

  it("topic inexistente → unknownTopic", () => {
    expect(filterRepos(repos, { topic: "zzz" }).unknownTopic).toBe("zzz")
  })

  it("sin filtros → todos", () => {
    expect(filterRepos(repos, {}).matched).toHaveLength(3)
  })
})
