import { describe, expect, it } from "vitest"
import { recentActivity } from "../src/core/actions/recent-activity.js"
import type { ActionContext, TraceIds } from "../src/core/actions/types.js"
import type { CapabilityProfile, Principal } from "../src/core/capabilities.js"
import type { Connector } from "../src/ports/connector.js"
import type { LogFields, Logger } from "../src/ports/logger.js"

function noopLogger(): Logger {
  const noop = (_a: LogFields | string, _b?: string): void => {}
  const l: Logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => l,
  }
  return l
}
const ids: TraceIds = { requestId: "r", turnId: "t" }
const principal: Principal = { channel: "web", id: "web", trusted: false }
const caps: CapabilityProfile = {
  channel: "web",
  allowedTools: ["recentActivity"],
  memoryScope: { maxK: 6 },
  policyText: "",
}
function ctx(connectors: Connector[]): ActionContext {
  return {
    caps,
    principal,
    memory: null,
    emit: () => {},
    ids,
    logger: noopLogger(),
    connectors,
  }
}
const conn = (name: string, snap: string | null): Connector => ({
  name,
  live: async () => snap,
})

describe("recentActivity", () => {
  it("concatena los snapshots no-null de los conectores", async () => {
    const t = recentActivity.build(
      ctx([conn("lastfm", "🎧 X"), conn("github", "💻 Y")])
    )
    const out = String(await t.execute?.({}, { toolCallId: "c", messages: [] }))
    expect(out).toContain("🎧 X")
    expect(out).toContain("💻 Y")
  })

  it("omite los null (best-effort) y no rompe si un conector tira", async () => {
    const throwing: Connector = {
      name: "boom",
      live: async () => {
        throw new Error("down")
      },
    }
    const t = recentActivity.build(
      ctx([conn("lastfm", "🎧 X"), conn("github", null), throwing])
    )
    const out = String(await t.execute?.({}, { toolCallId: "c", messages: [] }))
    expect(out).toBe("🎧 X")
  })

  it("sin conectores → degrada con cortesía", async () => {
    const t = recentActivity.build(ctx([]))
    const out = String(await t.execute?.({}, { toolCallId: "c", messages: [] }))
    expect(out.toLowerCase()).toContain("no tengo señales")
  })
})
