import { afterEach, describe, expect, it, vi } from "vitest"
import { createGithubConnector } from "../src/adapters/connectors/github.js"
import { buildConnectors } from "../src/adapters/connectors/index.js"
import { createLastfmConnector } from "../src/adapters/connectors/lastfm.js"
import type { Env } from "../src/config.js"

function mockFetch(handler: (url: string) => { ok?: boolean; json?: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const r = handler(String(input))
      return { ok: r.ok ?? true, status: 200, json: async () => r.json ?? {} }
    })
  )
}
afterEach(() => vi.unstubAllGlobals())

describe("conector Last.fm — live()", () => {
  const c = createLastfmConnector({ apiKey: "k", user: "kev" })
  it("now-playing → 'escuchando ahora'", async () => {
    mockFetch(() => ({
      json: {
        recenttracks: {
          track: [
            {
              name: "Idioteque",
              artist: { "#text": "Radiohead" },
              "@attr": { nowplaying: "true" },
            },
          ],
        },
      },
    }))
    expect(await c.live()).toContain("escuchando ahora: Radiohead — Idioteque")
  })
  it("sin nowplaying → 'lo último'", async () => {
    mockFetch(() => ({
      json: {
        recenttracks: {
          track: [{ name: "Reckoner", artist: { "#text": "Radiohead" } }],
        },
      },
    }))
    expect(await c.live()).toContain("Lo último")
  })
  it("sin tracks → null; fetch falla → null", async () => {
    mockFetch(() => ({ json: { recenttracks: { track: [] } } }))
    expect(await c.live()).toBeNull()
    mockFetch(() => ({ ok: false }))
    expect(await c.live()).toBeNull()
  })
})

describe("conector Last.fm — collect()", () => {
  const c = createLastfmConnector({ apiKey: "k", user: "kev" })
  it("artistas más escuchados → 1 chunk source 'lastfm'", async () => {
    mockFetch(() => ({
      json: {
        topartists: {
          artist: [{ name: "Radiohead" }, { name: "Tame Impala" }],
        },
      },
    }))
    const rows = await c.collect?.()
    expect(rows).toHaveLength(1)
    expect(rows?.[0]?.source).toBe("lastfm")
    expect(rows?.[0]?.chunk).toContain("Radiohead")
    expect(rows?.[0]?.chunk).toContain("Tame Impala")
  })
  it("sin artistas → []", async () => {
    mockFetch(() => ({ json: { topartists: { artist: [] } } }))
    expect(await c.collect?.()).toEqual([])
  })
})

describe("conector GitHub — live()", () => {
  const c = createGithubConnector({ user: "kev" })
  it("PushEvent → actividad de código reciente", async () => {
    mockFetch(() => ({
      json: [
        {
          type: "PushEvent",
          repo: { name: "kev/vaio" },
          payload: { commits: [{ message: "feat: x\n\ndetalle" }] },
        },
        { type: "WatchEvent", repo: { name: "kev/otro" }, payload: {} },
      ],
    }))
    const out = await c.live()
    expect(out).toContain("kev/vaio: feat: x")
    expect(out).not.toContain("detalle")
  })
  it("PushEvent SIN commits (solo ref) → fallback a repo (branch)", async () => {
    mockFetch(() => ({
      json: [
        {
          type: "PushEvent",
          repo: { name: "kev/vaio" },
          payload: { ref: "refs/heads/main" },
        },
        {
          type: "PushEvent",
          repo: { name: "kev/vaio" },
          payload: { ref: "refs/heads/main" },
        },
      ],
    }))
    const out = await c.live()
    expect(out).toContain("kev/vaio (main)")
    expect(out?.match(/kev\/vaio \(main\)/g)?.length).toBe(1)
  })
  it("sin push events → null", async () => {
    mockFetch(() => ({
      json: [{ type: "WatchEvent", repo: { name: "x" }, payload: {} }],
    }))
    expect(await c.live()).toBeNull()
  })
})

describe("conector GitHub — collect()", () => {
  const c = createGithubConnector({ user: "kev" })
  it("perfil + repos → chunks source 'github', salta fork/archived", async () => {
    mockFetch((url) => {
      if (url.endsWith("/users/kev")) {
        return {
          json: { name: "Kevin", bio: "dev", public_repos: 2, followers: 10 },
        }
      }
      return {
        json: [
          {
            name: "vaio",
            description: "agente",
            language: "TypeScript",
            stargazers_count: 5,
            topics: ["ai"],
            html_url: "https://github.com/kev/vaio",
            fork: false,
            archived: false,
          },
          {
            name: "un-fork",
            description: null,
            language: null,
            stargazers_count: 0,
            html_url: "https://github.com/kev/un-fork",
            fork: true,
            archived: false,
          },
        ],
      }
    })
    const rows = (await c.collect?.()) ?? []
    const text = rows.map((r) => r.chunk).join("\n")
    expect(rows[0]?.source).toBe("github")
    expect(text).toContain("Kevin")
    expect(text).toContain("vaio")
    expect(text).toContain("TypeScript")
    expect(text).not.toContain("un-fork")
  })
})

describe("buildConnectors (gating por keys)", () => {
  it("lastfm solo con keys; github con user", () => {
    const full = buildConnectors({
      LASTFM_API_KEY: "k",
      LASTFM_USER: "kev",
      GITHUB_USER: "kev",
    } as Env)
    expect(full.map((c) => c.name).sort()).toEqual(["github", "lastfm"])
    const noLastfm = buildConnectors({ GITHUB_USER: "kev" } as Env)
    expect(noLastfm.map((c) => c.name)).toEqual(["github"])
  })
})
