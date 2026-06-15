import { afterEach, describe, expect, it, vi } from "vitest"
import { createGithubActivityConnector } from "../src/adapters/connectors/github-activity.js"
import { buildConnectors } from "../src/adapters/connectors/index.js"
import { createLastfmConnector } from "../src/adapters/connectors/lastfm-now.js"
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

describe("conector Last.fm (live)", () => {
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

describe("conector GitHub actividad (live)", () => {
  const c = createGithubActivityConnector({ user: "kev" })
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
    expect(out).not.toContain("detalle") // solo la 1ª línea del commit
  })
  it("PushEvent SIN commits (solo ref) → fallback a repo (branch)", async () => {
    mockFetch(() => ({
      json: [
        { type: "PushEvent", repo: { name: "kev/vaio" }, payload: { ref: "refs/heads/main" } },
        { type: "PushEvent", repo: { name: "kev/vaio" }, payload: { ref: "refs/heads/main" } },
      ],
    }))
    const out = await c.live()
    expect(out).toContain("kev/vaio (main)")
    // dedup por repo+branch → no repite
    expect(out?.match(/kev\/vaio \(main\)/g)?.length).toBe(1)
  })

  it("sin push events → null", async () => {
    mockFetch(() => ({
      json: [{ type: "WatchEvent", repo: { name: "x" }, payload: {} }],
    }))
    expect(await c.live()).toBeNull()
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
