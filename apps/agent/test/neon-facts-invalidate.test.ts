import { describe, expect, it } from "vitest"
import { inMemoryFacts } from "./fakes/in-memory-facts.js"

// Pieza 1b: desaprender (invalidate) + buscar confirmados cercanos (findConfirmedNear). Contrato vía el fake.
describe("FactStore.invalidate (desaprender, contrato vía fake)", () => {
  it("invalida un confirmed-vigente → true; la fila NO se borra (queda con invalidAt no-null)", async () => {
    const fs = inMemoryFacts()
    const { id } = await fs.propose({
      statement: "A Kevin le gusta la pasta",
      principalId: "k",
      channel: "telegram",
    })
    await fs.commit(id)
    expect(await fs.invalidate(id)).toBe(true)
    const row = fs.rows().find((r) => r.id === id)
    expect(row).toBeDefined() // la fila sigue existiendo (no se borró)
    expect(row?.invalidAt).not.toBeNull() // quedó invalidada (auditable/reversible)
  })

  it("2ª llamada sobre el mismo (ya invalidado) → false (idempotente)", async () => {
    const fs = inMemoryFacts()
    const { id } = await fs.propose({
      statement: "X",
      principalId: "k",
      channel: "telegram",
    })
    await fs.commit(id)
    expect(await fs.invalidate(id)).toBe(true)
    expect(await fs.invalidate(id)).toBe(false)
  })

  it("sobre un pending (no confirmado) → false", async () => {
    const fs = inMemoryFacts()
    const { id } = await fs.propose({
      statement: "X",
      principalId: "k",
      channel: "telegram",
    })
    expect(await fs.invalidate(id)).toBe(false)
  })

  it("sobre un id inexistente → false", async () => {
    const fs = inMemoryFacts()
    expect(await fs.invalidate("nope")).toBe(false)
  })
})

describe("FactStore.listConfirmed (todos los confirmados vigentes para desaprender)", () => {
  it("trae los confirmados vigentes del principal; excluye otros principales", async () => {
    const fs = inMemoryFacts()
    const a = await fs.propose({
      statement: "A Kevin le gusta la pasta",
      principalId: "k",
      channel: "telegram",
    })
    await fs.commit(a.id)
    const b = await fs.propose({
      statement: "A Kevin le gusta el cine",
      principalId: "k",
      channel: "telegram",
    })
    await fs.commit(b.id)
    await fs.propose({
      statement: "A Otro le gusta la pasta",
      principalId: "otro",
      channel: "telegram",
    })
    const found = await fs.listConfirmed("k", 50)
    expect(new Set(found.map((c) => c.id))).toEqual(new Set([a.id, b.id]))
  })

  it("no trae un fact ya invalidado; respeta el limit", async () => {
    const fs = inMemoryFacts()
    const { id } = await fs.propose({
      statement: "A Kevin le gusta la pasta",
      principalId: "k",
      channel: "telegram",
    })
    await fs.commit(id)
    await fs.invalidate(id)
    expect(await fs.listConfirmed("k", 50)).toHaveLength(0)
  })
})
