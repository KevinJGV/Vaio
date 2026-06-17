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

describe("FactStore.findConfirmedNear (buscar para desaprender por similitud)", () => {
  it("trae confirmados vigentes del mismo principal que matchean; excluye otros principales", async () => {
    const fs = inMemoryFacts()
    const { id } = await fs.propose({
      statement: "A Kevin le gusta la pasta",
      principalId: "k",
      channel: "telegram",
    })
    await fs.commit(id)
    await fs.propose({
      statement: "A Otro le gusta la pasta",
      principalId: "otro",
      channel: "telegram",
    })
    const found = await fs.findConfirmedNear("pasta", "k")
    expect(found.map((c) => c.id)).toEqual([id])
  })

  it("no trae un fact ya invalidado", async () => {
    const fs = inMemoryFacts()
    const { id } = await fs.propose({
      statement: "A Kevin le gusta la pasta",
      principalId: "k",
      channel: "telegram",
    })
    await fs.commit(id)
    await fs.invalidate(id)
    expect(await fs.findConfirmedNear("pasta", "k")).toHaveLength(0)
  })
})
