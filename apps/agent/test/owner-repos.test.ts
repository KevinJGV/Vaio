import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createOwnerRepoCatalog,
  publicReposOnly,
} from "../src/adapters/sources/owner-repos.js"

afterEach(() => vi.unstubAllGlobals())

describe("publicReposOnly (puro)", () => {
  it("filtra private===true y mapea name/defaultBranch + metadata (language/topics/description/stars)", () => {
    const out = publicReposOnly([
      {
        name: "a",
        private: false,
        default_branch: "main",
        language: "Java",
        topics: ["cli", "java"],
        description: "un cli",
        stargazers_count: 3,
      },
      { name: "b", private: true, default_branch: "main" },
      { name: "c", private: false, default_branch: "dev" }, // sin metadata → defaults
    ])
    expect(out).toEqual([
      {
        name: "a",
        defaultBranch: "main",
        language: "Java",
        topics: ["cli", "java"],
        description: "un cli",
        stars: 3,
      },
      {
        name: "c",
        defaultBranch: "dev",
        language: null,
        topics: [],
        description: null,
        stars: 0,
      },
    ])
  })
})

describe("createOwnerRepoCatalog.listPublic", () => {
  function stubFetch(items: unknown[], state: { calls: number }) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        state.calls++
        return { ok: true, status: 200, json: async () => items }
      })
    )
  }

  it("lista públicos y CACHEA (2ª llamada no re-fetchea dentro del TTL)", async () => {
    const state = { calls: 0 }
    stubFetch([{ name: "vaio", private: false, default_branch: "main" }], state)
    const cat = createOwnerRepoCatalog({ user: "kev", ttlMs: 60_000 })
    expect(await cat.listPublic()).toEqual([
      {
        name: "vaio",
        defaultBranch: "main",
        language: null,
        topics: [],
        description: null,
        stars: 0,
      },
    ])
    await cat.listPublic()
    expect(state.calls).toBe(1) // 2ª cae en cache
  })

  it("ante error de GitHub (rate-limit) degrada a [] (Invariante #1)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 403,
        text: async () => "rate limited",
      }))
    )
    const cat = createOwnerRepoCatalog({ user: "kev" })
    expect(await cat.listPublic()).toEqual([])
  })
})
