import { describe, expect, it, vi } from "vitest"
import type { Database } from "../src/adapters/db/client.js"
import { createCompositeTraceSink } from "../src/adapters/trace-composite.js"
import { createPgTraceSink } from "../src/adapters/trace-pg.js"
import type { Logger } from "../src/ports/logger.js"
import type { TraceEvent } from "../src/ports/trace.js"

const noop = (() => {}) as unknown as Logger["info"]
const logger: Logger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  child: () => logger,
}

function ev(over: Partial<TraceEvent> = {}): TraceEvent {
  return {
    type: "turn.start",
    requestId: "r1",
    turnId: "t1",
    locale: "es",
    messageCount: 1,
    ...over,
  } as TraceEvent
}

describe("createCompositeTraceSink", () => {
  it("reenvía cada evento a todos los sinks", () => {
    const a: TraceEvent[] = []
    const b: TraceEvent[] = []
    const sink = createCompositeTraceSink([
      { emit: (e) => a.push(e) },
      { emit: (e) => b.push(e) },
    ])
    const e = ev()
    sink.emit(e)
    expect(a).toEqual([e])
    expect(b).toEqual([e])
  })

  it("un sink que lanza no impide a los demás", () => {
    const got: TraceEvent[] = []
    const sink = createCompositeTraceSink([
      {
        emit: () => {
          throw new Error("boom")
        },
      },
      { emit: (e) => got.push(e) },
    ])
    expect(() => sink.emit(ev())).not.toThrow()
    expect(got).toHaveLength(1)
  })
})

/** Fake db que captura los values insertados; `fail` fuerza el rechazo del insert. */
function fakeDb(opts: { fail?: boolean } = {}) {
  const rows: Record<string, unknown>[] = []
  const db = {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        rows.push(v)
        return opts.fail
          ? Promise.reject(new Error("db down"))
          : Promise.resolve()
      },
    }),
  } as unknown as Database
  return { db, rows }
}

describe("createPgTraceSink", () => {
  it("inserta un row por evento con seq monótono por turno", async () => {
    const { db, rows } = fakeDb()
    const sink = createPgTraceSink(db, logger)
    sink.emit(ev({ type: "turn.start", turnId: "tA" }))
    sink.emit(
      ev({ type: "reasoning", turnId: "tA", text: "x" } as Partial<TraceEvent>)
    )
    sink.emit(ev({ type: "turn.start", turnId: "tB" }))
    await Promise.resolve()
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ turnId: "tA", seq: 0, type: "turn.start" })
    expect(rows[1]).toMatchObject({ turnId: "tA", seq: 1, type: "reasoning" })
    expect(rows[2]).toMatchObject({ turnId: "tB", seq: 0, type: "turn.start" })
  })

  it("conversationId no-uuid → null (turno stateless)", async () => {
    const { db, rows } = fakeDb()
    const sink = createPgTraceSink(db, logger)
    sink.emit(ev({ conversationId: "not-a-uuid" }))
    sink.emit(ev({ conversationId: "6a88fc34-30ae-4278-9eab-0381a4c055a3" }))
    await Promise.resolve()
    expect(rows[0]?.conversationId).toBeNull()
    expect(rows[1]?.conversationId).toBe("6a88fc34-30ae-4278-9eab-0381a4c055a3")
  })

  it("fallo de insert → no lanza (best-effort), loguea debug", async () => {
    const { db } = fakeDb({ fail: true })
    const dbg = vi.fn()
    const lg: Logger = { ...logger, debug: dbg as unknown as Logger["debug"] }
    const sink = createPgTraceSink(db, lg)
    expect(() => sink.emit(ev())).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
    expect(dbg).toHaveBeenCalled()
  })
})
