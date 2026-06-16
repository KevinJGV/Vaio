import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createOwnerRepoActivity,
  createOwnerRepoCatalog,
  publicReposOnly,
  searchItemsToOpenPRs,
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

describe("searchItemsToOpenPRs (puro)", () => {
  it("mapea items → OpenPR y descarta los sin repo parseable", () => {
    expect(
      searchItemsToOpenPRs([
        {
          repository_url: "https://api.github.com/repos/kev/Vaio",
          number: 12,
          title: "fix sync",
          html_url: "https://github.com/kev/Vaio/pull/12",
        },
        {
          repository_url: "url-rara",
          number: 99,
          title: "x",
          html_url: "y",
        },
      ])
    ).toEqual([
      {
        repo: "Vaio",
        number: 12,
        title: "fix sync",
        url: "https://github.com/kev/Vaio/pull/12",
      },
    ])
  })
})

describe("createOwnerRepoActivity.openPullRequests", () => {
  function stubSearch(
    items: unknown[],
    state: { calls: number; url?: string }
  ) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        state.calls++
        state.url = String(input)
        return { ok: true, status: 200, json: async () => ({ items }) }
      })
    )
  }

  it("trae PRs abiertos (query is:pull-request+is:public) y CACHEA", async () => {
    const state = { calls: 0 }
    stubSearch(
      [
        {
          repository_url: "https://api.github.com/repos/kev/Vaio",
          number: 7,
          title: "rerank",
          html_url: "https://github.com/kev/Vaio/pull/7",
        },
      ],
      state
    )
    const act = createOwnerRepoActivity({ user: "kev", ttlMs: 60_000 })
    expect(await act.openPullRequests()).toEqual([
      {
        repo: "Vaio",
        number: 7,
        title: "rerank",
        url: "https://github.com/kev/Vaio/pull/7",
      },
    ])
    expect(state.url).toContain("/search/issues")
    expect(decodeURIComponent(state.url ?? "")).toContain("is:pull-request")
    expect(decodeURIComponent(state.url ?? "")).toContain("is:public")
    await act.openPullRequests()
    expect(state.calls).toBe(1) // 2ª cae en cache
  })

  it("sin PRs → [] (no es lo mismo que fallo)", async () => {
    stubSearch([], { calls: 0 })
    const act = createOwnerRepoActivity({ user: "kev" })
    expect(await act.openPullRequests()).toEqual([])
  })

  it("ante error de Search (rate-limit) degrada a null (Invariante #1)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 403,
        text: async () => "rate limited",
      }))
    )
    const act = createOwnerRepoActivity({ user: "kev" })
    expect(await act.openPullRequests()).toBeNull()
  })
})
