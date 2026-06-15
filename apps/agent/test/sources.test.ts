import { afterEach, describe, expect, it, vi } from "vitest"
import { collectRawRepo } from "../src/adapters/sources/repo.js"

/** Mock que distingue respuestas JSON (githubApi) de texto crudo (githubRaw), con status configurable. */
function mockGithub(
  routes: (url: string) => {
    ok?: boolean
    status?: number
    json?: unknown
    text?: string
  }
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const r = routes(String(input))
      return {
        ok: r.ok ?? true,
        status: r.status ?? 200,
        json: async () => r.json ?? {},
        text: async () => r.text ?? "",
      }
    })
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("collectRawRepo", () => {
  it("ingiere md+código con source/url/header de procedencia y resuelve el default branch", async () => {
    mockGithub((url) => {
      if (url.endsWith("/repos/kev/vaio"))
        return { json: { default_branch: "main" } }
      if (url.includes("/git/trees/")) {
        return {
          json: {
            truncated: false,
            tree: [
              { path: "README.md", type: "blob", size: 20, sha: "a" },
              { path: "src/index.ts", type: "blob", size: 30, sha: "b" },
              { path: "node_modules/x.js", type: "blob", size: 10, sha: "c" },
              { path: ".env", type: "blob", size: 10, sha: "d" },
            ],
          },
        }
      }
      if (url.includes("/contents/README.md"))
        return { text: "# Vaio\nun agente" }
      if (url.includes("/contents/src/index.ts"))
        return { text: "const x = 1\nexport {}" }
      return { text: "" }
    })

    const rows = await collectRawRepo({
      repos: [{ owner: "kev", repo: "vaio" }],
    })
    // solo README.md + src/index.ts pasan el filtro (node_modules y .env descartados)
    expect(rows.every((r) => r.source === "repo:kev/vaio")).toBe(true)
    const readme = rows.find((r) => r.url.includes("README.md"))
    const code = rows.find((r) => r.url.includes("src/index.ts"))
    expect(readme?.url).toBe("https://github.com/kev/vaio/blob/main/README.md")
    expect(readme?.chunk).toContain("<!-- repo: kev/vaio · path: README.md")
    expect(code?.chunk).toContain("// repo: kev/vaio · path: src/index.ts")
    expect(code?.chunk).toContain("const x = 1")
    // no se ingirió nada de node_modules ni del .env
    expect(rows.some((r) => r.url.includes("node_modules"))).toBe(false)
    expect(rows.some((r) => r.url.includes(".env"))).toBe(false)
  })

  it("descarta un archivo que contiene un secret (no aparece en la salida)", async () => {
    mockGithub((url) => {
      if (url.endsWith("/repos/kev/vaio"))
        return { json: { default_branch: "main" } }
      if (url.includes("/git/trees/")) {
        return {
          json: {
            truncated: false,
            tree: [
              { path: "ok.ts", type: "blob", size: 20, sha: "a" },
              { path: "leak.ts", type: "blob", size: 60, sha: "b" },
            ],
          },
        }
      }
      if (url.includes("/contents/ok.ts"))
        return { text: "export const ok = true" }
      if (url.includes("/contents/leak.ts"))
        return { text: 'const k = "ghp_0123456789012345678901234567890123ab"' }
      return { text: "" }
    })

    const rows = await collectRawRepo({
      repos: [{ owner: "kev", repo: "vaio" }],
    })
    expect(rows.some((r) => r.url.includes("ok.ts"))).toBe(true)
    expect(rows.some((r) => r.url.includes("leak.ts"))).toBe(false)
  })

  it("best-effort: un repo que falla (404) no rompe el ingreso de otro", async () => {
    mockGithub((url) => {
      if (url.includes("/repos/kev/privado"))
        return { ok: false, status: 404, text: "Not Found" }
      if (url.endsWith("/repos/kev/vaio"))
        return { json: { default_branch: "main" } }
      if (url.includes("/git/trees/")) {
        return {
          json: {
            truncated: false,
            tree: [{ path: "README.md", type: "blob", size: 10, sha: "a" }],
          },
        }
      }
      if (url.includes("/contents/README.md")) return { text: "# ok" }
      return { text: "" }
    })

    const rows = await collectRawRepo({
      repos: [
        { owner: "kev", repo: "privado" },
        { owner: "kev", repo: "vaio" },
      ],
    })
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.source === "repo:kev/vaio")).toBe(true)
  })
})
