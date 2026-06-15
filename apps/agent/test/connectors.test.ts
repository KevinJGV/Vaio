import { afterEach, describe, expect, it, vi } from "vitest"
import { createGithubConnector } from "../src/adapters/connectors/github.js"
import { createGithubStatsConnector } from "../src/adapters/connectors/github-stats.js"
import { buildConnectors } from "../src/adapters/connectors/index.js"
import { createLastfmConnector } from "../src/adapters/connectors/lastfm.js"
import { createSteamConnector } from "../src/adapters/connectors/steam.js"
import { createWakatimeConnector } from "../src/adapters/connectors/wakatime.js"
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

describe("conector WakaTime — live()", () => {
  const c = createWakatimeConnector({ apiKey: "k" })
  it("stats con datos → resumen de la semana", async () => {
    mockFetch(() => ({
      json: {
        data: {
          human_readable_total: "18 hrs",
          total_seconds: 64800,
          languages: [
            { name: "TypeScript", percent: 52 },
            { name: "Python", percent: 19 },
          ],
        },
      },
    }))
    const out = await c.live()
    expect(out).toContain("18 hrs")
    expect(out).toContain("TypeScript (52%)")
  })
  it("total 0 → null; fetch !ok → null", async () => {
    mockFetch(() => ({ json: { data: { total_seconds: 0, languages: [] } } }))
    expect(await c.live()).toBeNull()
    mockFetch(() => ({ ok: false }))
    expect(await c.live()).toBeNull()
  })
})

describe("conector WakaTime — collect()", () => {
  const c = createWakatimeConnector({ apiKey: "k" })
  it("stats del último año → 1 chunk source 'wakatime'", async () => {
    mockFetch(() => ({
      json: {
        data: {
          human_readable_total: "400 hrs",
          languages: [{ name: "TypeScript", percent: 60 }],
          editors: [{ name: "VS Code", percent: 90 }],
          projects: [{ name: "Vaio", percent: 40 }],
        },
      },
    }))
    const rows = (await c.collect?.()) ?? []
    expect(rows[0]?.source).toBe("wakatime")
    expect(rows[0]?.chunk).toContain("TypeScript")
    expect(rows[0]?.chunk).toContain("VS Code")
  })
})

describe("conector Steam — live()", () => {
  const c = createSteamConnector({ apiKey: "k", steamId: "123" })
  it("jugando ahora → gameextrainfo", async () => {
    mockFetch(() => ({
      json: { response: { players: [{ gameextrainfo: "Hades II" }] } },
    }))
    expect(await c.live()).toContain("jugando ahora: Hades II")
  })
  it("no juega → fallback a recently played", async () => {
    mockFetch((url) => {
      if (url.includes("GetPlayerSummaries")) {
        return { json: { response: { players: [{ personaname: "kev" }] } } }
      }
      return {
        json: {
          response: { games: [{ name: "Hades II", playtime_2weeks: 600 }] },
        },
      }
    })
    const out = await c.live()
    expect(out).toContain("Lo último que jugó")
    expect(out).toContain("Hades II")
  })
  it("nada → null", async () => {
    mockFetch((url) =>
      url.includes("GetPlayerSummaries")
        ? { json: { response: { players: [{}] } } }
        : { json: { response: { games: [] } } }
    )
    expect(await c.live()).toBeNull()
  })
})

describe("conector Steam — collect()", () => {
  const c = createSteamConnector({ apiKey: "k", steamId: "123" })
  it("biblioteca → 1 chunk source 'steam' top por horas", async () => {
    mockFetch(() => ({
      json: {
        response: {
          games: [
            { name: "Dota 2", playtime_forever: 12000 },
            { name: "CS2", playtime_forever: 6000 },
          ],
        },
      },
    }))
    const rows = (await c.collect?.()) ?? []
    expect(rows[0]?.source).toBe("steam")
    expect(rows[0]?.chunk).toContain("Dota 2 (200h)")
  })
  it("perfil privado / sin juegos → []", async () => {
    mockFetch(() => ({ json: { response: {} } }))
    expect(await c.collect?.()).toEqual([])
  })
})

const ghStatsPayload = {
  data: {
    user: {
      repositories: {
        totalCount: 2,
        nodes: [
          {
            stargazers: { totalCount: 5 },
            languages: { edges: [{ size: 100, node: { name: "TypeScript" } }] },
          },
          {
            stargazers: { totalCount: 3 },
            languages: { edges: [{ size: 50, node: { name: "Java" } }] },
          },
        ],
      },
      contributionsCollection: {
        totalCommitContributions: 120,
        totalPullRequestContributions: 10,
        totalIssueContributions: 4,
        contributionCalendar: {
          totalContributions: 134,
          weeks: [
            {
              contributionDays: [
                { contributionCount: 1, date: "2026-06-13" },
                { contributionCount: 2, date: "2026-06-14" },
              ],
            },
          ],
        },
      },
    },
  },
}

describe("conector GitHub-stats — collect()", () => {
  const c = createGithubStatsConnector({ user: "kev", token: "t" })
  it("stats agregadas → 1 chunk source 'github-stats'", async () => {
    mockFetch(() => ({ json: ghStatsPayload }))
    const rows = (await c.collect?.()) ?? []
    expect(rows[0]?.source).toBe("github-stats")
    expect(rows[0]?.chunk).toContain("8 stars") // 5 + 3
    expect(rows[0]?.chunk).toContain("120 commits")
    expect(rows[0]?.chunk).toContain("TypeScript")
  })
})

describe("conector GitHub-stats — live()", () => {
  const c = createGithubStatsConnector({ user: "kev", token: "t" })
  it("racha actual > 0 → mensaje de racha", async () => {
    mockFetch(() => ({ json: ghStatsPayload }))
    const out = await c.live()
    expect(out).toContain("racha")
  })
})

describe("buildConnectors (gating por keys)", () => {
  it("cada conector se habilita solo con sus keys", () => {
    const full = buildConnectors({
      LASTFM_API_KEY: "k",
      LASTFM_USER: "kev",
      GITHUB_USER: "kev",
      GITHUB_TOKEN: "t",
      WAKATIME_API_KEY: "w",
      STEAM_API_KEY: "s",
      STEAM_ID: "123",
    } as Env)
    expect(full.map((c) => c.name).sort()).toEqual([
      "github",
      "github-stats",
      "lastfm",
      "steam",
      "wakatime",
    ])
  })
  it("github-stats requiere token; steam requiere ambas; wakatime su key", () => {
    const noTokenNoExtras = buildConnectors({ GITHUB_USER: "kev" } as Env)
    expect(noTokenNoExtras.map((c) => c.name)).toEqual(["github"])
    const steamHalf = buildConnectors({ STEAM_API_KEY: "s" } as Env)
    expect(steamHalf.map((c) => c.name)).toEqual([])
  })
})
