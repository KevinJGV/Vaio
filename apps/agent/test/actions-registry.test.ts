import type { TraceEvent } from "@vaio/contracts"
import { tool } from "ai"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { ACTIONS, buildTools } from "../src/core/actions/registry.js"
import type {
  ActionContext,
  ActionDescriptor,
  TraceIds,
} from "../src/core/actions/types.js"
import type { CapabilityProfile, Principal } from "../src/core/capabilities.js"
import type { LogFields, Logger } from "../src/ports/logger.js"

function noopLogger(): Logger {
  const noop = (_a: LogFields | string, _b?: string): void => {}
  const logger: Logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => logger,
  }
  return logger
}

const ids: TraceIds = { requestId: "req", turnId: "turn" }

function ctx(
  allowedTools: CapabilityProfile["allowedTools"],
  trusted: boolean,
  emit: (e: TraceEvent) => void = () => {}
): ActionContext {
  const principal: Principal = { channel: "telegram", id: "1", trusted }
  return {
    caps: {
      channel: "telegram",
      allowedTools,
      memoryScope: { maxK: 6 },
      policyText: "",
    },
    principal,
    memory: {
      searchMemory: async () => [],
      upsertDocuments: async () => {},
      clearSource: async () => {},
    },
    emit,
    ids,
    logger: noopLogger(),
  }
}

describe("buildTools — gating de 2 capas", () => {
  it("capa canal: oculta la tool si no está en allowedTools", () => {
    expect(buildTools(ctx([], true)).searchMemory).toBeUndefined()
    expect(buildTools(ctx(["searchMemory"], true)).searchMemory).toBeDefined()
  })

  it("clearance 'anyone' (searchMemory): visible para principal no-trusted", () => {
    expect(buildTools(ctx(["searchMemory"], false)).searchMemory).toBeDefined()
  })

  it("ACTIONS contiene searchMemory por defecto", () => {
    expect(ACTIONS.some((a) => a.name === "searchMemory")).toBe(true)
  })
})

describe("seam HITL — clearance 'owner' deniega en runtime", () => {
  // Descriptor owner-only SOLO de test: ejercita el deny path sin enviar una write-action real.
  // Reusa el nombre "searchMemory" para entrar por allowedTools; el test inyecta este registry.
  const ownerOnly: ActionDescriptor = {
    name: "searchMemory",
    sideEffecting: true,
    clearance: "owner",
    build: () => {
      throw new Error("no debería construirse para un principal no-trusted")
    },
  }

  it("principal no-trusted: la tool se expone pero su execute deniega (ok:false, denied:true) sin ejecutar", async () => {
    const events: TraceEvent[] = []
    const tools = buildTools(
      ctx(["searchMemory"], false, (e) => events.push(e)),
      [ownerOnly]
    )
    const out = await tools.searchMemory?.execute?.(
      {},
      { toolCallId: "tc", messages: [] }
    )
    expect(String(out)).toMatch(/no puedo/i)
    expect(events.find((e) => e.type === "tool.result")).toMatchObject({
      ok: false,
      denied: true,
    })
  })

  it("principal trusted: clearance 'owner' permite construir la tool real", () => {
    const built: ActionDescriptor = {
      ...ownerOnly,
      build: () =>
        tool({
          description: "x",
          inputSchema: z.object({}),
          execute: async () => "ok",
        }),
    }
    const tools = buildTools(ctx(["searchMemory"], true), [built])
    expect(tools.searchMemory).toBeDefined()
  })
})
