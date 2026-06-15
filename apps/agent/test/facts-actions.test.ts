import type { TraceEvent } from "@vaio/contracts"
import { describe, expect, it } from "vitest"
import { commitFact } from "../src/core/actions/commit-fact.js"
import { proposeFact } from "../src/core/actions/propose-fact.js"
import type { ActionContext } from "../src/core/actions/types.js"
import type { Principal } from "../src/core/capabilities.js"
import type { LogFields, Logger } from "../src/ports/logger.js"
import { inMemoryFacts } from "./fakes/in-memory-facts.js"

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
const principal: Principal = { channel: "telegram", id: "k", trusted: true }
function ctx(
  factStore: ActionContext["factStore"],
  emit: (e: TraceEvent) => void = () => {}
): ActionContext {
  return {
    caps: {
      channel: "telegram",
      allowedTools: ["proposeFact", "commitFact"],
      memoryScope: { maxK: 8 },
      policyText: "",
    },
    principal,
    memory: null,
    factStore,
    emit,
    ids: { requestId: "r", turnId: "t", conversationId: "c" },
    logger: noopLogger(),
  }
}

describe("proposeFact / commitFact", () => {
  it("proposeFact registra la propuesta y devuelve el id en el texto", async () => {
    const fs = inMemoryFacts()
    const out = await proposeFact
      .build(ctx(fs))
      .execute?.(
        { statement: "A Kevin no le gusta el fútbol" },
        { toolCallId: "tc", messages: [] }
      )
    expect(String(out)).toMatch(/id f1/)
    expect(await fs.listPending("k")).toHaveLength(1)
  })

  it("commitFact confirm guarda; id inexistente → 'no encontré'", async () => {
    const fs = inMemoryFacts()
    await proposeFact
      .build(ctx(fs))
      .execute?.({ statement: "X" }, { toolCallId: "t1", messages: [] })
    const okOut = await commitFact
      .build(ctx(fs))
      .execute?.(
        { id: "f1", decision: "confirm" },
        { toolCallId: "t2", messages: [] }
      )
    expect(String(okOut)).toMatch(/guard/i)
    expect(await fs.listPending("k")).toHaveLength(0)
    const missOut = await commitFact
      .build(ctx(fs))
      .execute?.(
        { id: "nope", decision: "confirm" },
        { toolCallId: "t3", messages: [] }
      )
    expect(String(missOut)).toMatch(/no encontré/i)
  })

  it("degradan a cortesía si no hay factStore", async () => {
    const out = await proposeFact
      .build(ctx(null))
      .execute?.({ statement: "X" }, { toolCallId: "tc", messages: [] })
    expect(String(out)).toMatch(/no configurada/i)
  })

  it("proposeFact sin conflicto instruye guardar YA (auto-save, sin pedir confirmación)", async () => {
    const fs = inMemoryFacts()
    const out = await proposeFact
      .build(ctx(fs))
      .execute?.(
        { statement: "A Kevin le gustan las hamburguesas" },
        { toolCallId: "tc", messages: [] }
      )
    expect(String(out)).toMatch(/no choca/i)
    expect(String(out)).toMatch(/ahora mismo/i)
    expect(String(out)).not.toMatch(/pedile confirmación/i)
  })

  it("proposeFact lista los conflictos detectados e instruye supersedes", async () => {
    const fs = inMemoryFacts()
    // un fact confirmado del mismo principal → el siguiente propose lo trae como conflicto
    await proposeFact
      .build(ctx(fs))
      .execute?.(
        { statement: "A Kevin le gusta X" },
        { toolCallId: "t1", messages: [] }
      )
    await commitFact
      .build(ctx(fs))
      .execute?.(
        { id: "f1", decision: "confirm" },
        { toolCallId: "t2", messages: [] }
      )
    const out = await proposeFact
      .build(ctx(fs))
      .execute?.(
        { statement: "A Kevin ya no le gusta X" },
        { toolCallId: "t3", messages: [] }
      )
    expect(String(out)).toMatch(/chocar/i)
    expect(String(out)).toMatch(/f1/)
    expect(String(out)).toMatch(/supersedes/i)
  })

  it("commitFact pasa supersedes y avisa el reemplazo", async () => {
    const fs = inMemoryFacts()
    await proposeFact
      .build(ctx(fs))
      .execute?.(
        { statement: "le gusta X" },
        { toolCallId: "t1", messages: [] }
      )
    await commitFact
      .build(ctx(fs))
      .execute?.(
        { id: "f1", decision: "confirm" },
        { toolCallId: "t2", messages: [] }
      )
    await proposeFact
      .build(ctx(fs))
      .execute?.({ statement: "ahora Y" }, { toolCallId: "t3", messages: [] })
    const out = await commitFact
      .build(ctx(fs))
      .execute?.(
        { id: "f2", decision: "confirm", supersedes: ["f1"] },
        { toolCallId: "t4", messages: [] }
      )
    expect(String(out)).toMatch(/reemplac/i)
    expect(fs.rows().find((r) => r.id === "f1")?.invalidAt).not.toBeNull()
  })
})
