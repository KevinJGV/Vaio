import { afterEach, describe, expect, it } from "vitest"
import { createReranker } from "../src/adapters/rerank-openrouter.js"
import type { LogFields, Logger } from "../src/ports/logger.js"

function capturingLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = []
  const rec = (a: LogFields | string, b?: string) => {
    lines.push(JSON.stringify(a) + (b ? ` ${b}` : ""))
  }
  const logger: Logger = {
    trace: rec,
    debug: rec,
    info: rec,
    warn: rec,
    error: rec,
    child: () => logger,
  }
  return { logger, lines }
}

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function reranker(chain: string[], logger: Logger) {
  return createReranker({
    apiKey: "SECRET-KEY",
    baseURL: "https://openrouter.ai/api/v1",
    chain,
    logger,
  })
}

const DOCS = ["doc a", "doc b", "doc c"]

describe("createReranker (cadena REST /rerank)", () => {
  it("mapea results → [{index, score}] (key no en logs)", async () => {
    const bodies: Record<string, unknown>[] = []
    globalThis.fetch = (async (_u: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return Response.json({
        results: [
          { document: { text: "doc c" }, index: 2, relevance_score: 0.9 },
          { document: { text: "doc a" }, index: 0, relevance_score: 0.4 },
        ],
        usage: {},
      })
    }) as typeof fetch
    const { logger, lines } = capturingLogger()
    const out = await reranker(["r/x"], logger).rerank("q", DOCS, 2)
    expect(out).toEqual([
      { index: 2, score: 0.9 },
      { index: 0, score: 0.4 },
    ])
    expect(bodies[0]).toMatchObject({
      model: "r/x",
      query: "q",
      documents: DOCS,
      top_n: 2,
    })
    expect(lines.join("\n")).not.toContain("SECRET-KEY")
  })

  it("fallback: 1º no-ok (500) → prueba el 2º y gana", async () => {
    let n = 0
    globalThis.fetch = (async () => {
      n++
      return n === 1
        ? new Response("bad", { status: 500 })
        : Response.json({
            results: [
              { document: { text: "doc a" }, index: 0, relevance_score: 1 },
            ],
          })
    }) as typeof fetch
    const { logger } = capturingLogger()
    const out = await reranker(["r/a", "r/b"], logger).rerank("q", DOCS, 1)
    expect(n).toBe(2)
    expect(out).toEqual([{ index: 0, score: 1 }])
  })

  it("todas fallan → [] (el llamador degrada a vector)", async () => {
    globalThis.fetch = (async () =>
      new Response("bad", { status: 500 })) as typeof fetch
    const { logger } = capturingLogger()
    expect(await reranker(["r/a", "r/b"], logger).rerank("q", DOCS, 3)).toEqual(
      []
    )
  })

  it("HTTP 200 con {error} → trata como fallo (→ [] si es el único)", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        error: { code: 429, message: "cap upstream" },
      })) as typeof fetch
    const { logger } = capturingLogger()
    expect(await reranker(["r/x"], logger).rerank("q", DOCS, 3)).toEqual([])
  })

  it("cadena vacía o documents vacío → [] sin llamar a fetch", async () => {
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return Response.json({ results: [] })
    }) as typeof fetch
    const { logger } = capturingLogger()
    expect(await reranker([], logger).rerank("q", DOCS, 3)).toEqual([])
    expect(await reranker(["r/x"], logger).rerank("q", [], 3)).toEqual([])
    expect(called).toBe(false)
  })
})
