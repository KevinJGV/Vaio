import type { TraceEvent } from "@vaio/contracts"
import { describe, expect, it } from "vitest"
import { rememberFact } from "../src/core/actions/remember-fact.js"
import { resolveFact } from "../src/core/actions/resolve-fact.js"
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
      allowedTools: ["rememberFact", "resolveFact"],
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

describe("rememberFact", () => {
  it("sin conflicto → guarda EN EL ACTO (auto-save, sin pendiente, sin confirmación)", async () => {
    const fs = inMemoryFacts()
    const out = await rememberFact
      .build(ctx(fs))
      .execute?.(
        { statement: "A Kevin le gustan las hamburguesas" },
        { toolCallId: "tc", messages: [] }
      )
    expect(String(out)).toMatch(/guard/i)
    expect(await fs.listPending("k")).toHaveLength(0) // se confirmó, no quedó pendiente
  })

  it("con conflicto → deja pendiente y numera los conflictos por ordinal (sin uuids)", async () => {
    const fs = inMemoryFacts()
    // un fact confirmado del mismo principal → el siguiente remember choca con él
    await rememberFact
      .build(ctx(fs))
      .execute?.(
        { statement: "A Kevin le gustan las hamburguesas" },
        { toolCallId: "t1", messages: [] }
      )
    const out = await rememberFact
      .build(ctx(fs))
      .execute?.(
        { statement: "A Kevin ya no le gustan las hamburguesas" },
        { toolCallId: "t2", messages: [] }
      )
    expect(String(out)).toMatch(/pendiente/i)
    expect(String(out)).toMatch(/\[0\]/) // conflicto por ordinal
    expect(String(out)).toMatch(/resolveFact/)
    expect(await fs.listPending("k")).toHaveLength(1) // sí quedó pendiente
  })

  it("degrada a cortesía si no hay factStore", async () => {
    const out = await rememberFact
      .build(ctx(null))
      .execute?.({ statement: "X" }, { toolCallId: "tc", messages: [] })
    expect(String(out)).toMatch(/no configurada/i)
  })
})

describe("resolveFact", () => {
  it("confirm con replaces:[0] → mapea el ordinal al uuid e invalida el viejo (el modelo no pasa ids)", async () => {
    const fs = inMemoryFacts()
    await rememberFact
      .build(ctx(fs))
      .execute?.(
        { statement: "A Kevin le gustan las hamburguesas" },
        { toolCallId: "t1", messages: [] }
      )
    await rememberFact
      .build(ctx(fs))
      .execute?.(
        { statement: "A Kevin ya no le gustan las hamburguesas" },
        { toolCallId: "t2", messages: [] }
      )
    const viejo = fs.rows().find((r) => r.statement.includes("le gustan"))?.id
    const out = await resolveFact
      .build(ctx(fs))
      .execute?.(
        { decision: "confirm", replaces: [0] },
        { toolCallId: "t3", messages: [] }
      )
    expect(String(out)).toMatch(/reemplac/i)
    expect(fs.rows().find((r) => r.id === viejo)?.invalidAt).not.toBeNull()
  })

  it("confirm sin replaces → confirma sin invalidar nada (coexistencia)", async () => {
    const fs = inMemoryFacts()
    await rememberFact
      .build(ctx(fs))
      .execute?.(
        { statement: "A Kevin le gusta la pizza" },
        { toolCallId: "t1", messages: [] }
      )
    // segundo (cercano en el fake) → pendiente
    await rememberFact
      .build(ctx(fs))
      .execute?.(
        { statement: "A Kevin le gusta la pasta" },
        { toolCallId: "t2", messages: [] }
      )
    const out = await resolveFact
      .build(ctx(fs))
      .execute?.({ decision: "confirm" }, { toolCallId: "t3", messages: [] })
    expect(String(out)).toMatch(/guard/i)
    // ninguno invalidado
    expect(fs.rows().every((r) => r.invalidAt === null)).toBe(true)
  })

  it("reject → descarta la pendiente", async () => {
    const fs = inMemoryFacts()
    await rememberFact
      .build(ctx(fs))
      .execute?.(
        { statement: "A Kevin le gusta X" },
        { toolCallId: "t1", messages: [] }
      )
    await rememberFact
      .build(ctx(fs))
      .execute?.(
        { statement: "A Kevin ya no le gusta X" },
        { toolCallId: "t2", messages: [] }
      )
    const out = await resolveFact
      .build(ctx(fs))
      .execute?.({ decision: "reject" }, { toolCallId: "t3", messages: [] })
    expect(String(out)).toMatch(/descart/i)
    expect(await fs.listPending("k")).toHaveLength(0)
  })

  it("sin pendiente → avisa que no hay nada que resolver", async () => {
    const fs = inMemoryFacts()
    const out = await resolveFact
      .build(ctx(fs))
      .execute?.({ decision: "confirm" }, { toolCallId: "t1", messages: [] })
    expect(String(out)).toMatch(/no tengo ninguna propuesta pendiente/i)
  })

  it("replaces con ordinal fuera de rango → se ignora, no rompe (confirma sin invalidar)", async () => {
    const fs = inMemoryFacts()
    await rememberFact
      .build(ctx(fs))
      .execute?.(
        { statement: "A Kevin le gusta Y" },
        { toolCallId: "t1", messages: [] }
      )
    await rememberFact
      .build(ctx(fs))
      .execute?.(
        { statement: "A Kevin ya no le gusta Y" },
        { toolCallId: "t2", messages: [] }
      )
    const out = await resolveFact
      .build(ctx(fs))
      .execute?.(
        { decision: "confirm", replaces: [99] },
        { toolCallId: "t3", messages: [] }
      )
    expect(String(out)).toMatch(/guard/i)
    expect(fs.rows().every((r) => r.invalidAt === null)).toBe(true)
  })
})
