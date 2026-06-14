import { describe, expect, it } from "vitest"
import { inMemoryFacts } from "./fakes/in-memory-facts.js"

describe("FactStore (contrato, vía fake)", () => {
  it("propose crea pending y devuelve id; listPending lo trae", async () => {
    const fs = inMemoryFacts()
    const { id } = await fs.propose({ statement: "A Kevin no le gusta el fútbol", principalId: "k", channel: "telegram" })
    const pend = await fs.listPending("k")
    expect(pend).toHaveLength(1)
    expect(pend[0]?.id).toBe(id)
  })

  it("commit confirma y es idempotente (2º commit → false)", async () => {
    const fs = inMemoryFacts()
    const { id } = await fs.propose({ statement: "X", principalId: "k", channel: "telegram" })
    expect(await fs.commit(id)).toBe(true)
    expect(await fs.commit(id)).toBe(false)
    expect(await fs.listPending("k")).toHaveLength(0)
  })

  it("reject descarta; commit posterior → false; commit a id inexistente → false", async () => {
    const fs = inMemoryFacts()
    const { id } = await fs.propose({ statement: "X", principalId: "k", channel: "telegram" })
    expect(await fs.reject(id)).toBe(true)
    expect(await fs.commit(id)).toBe(false)
    expect(await fs.commit("nope")).toBe(false)
  })

  it("listPending filtra por principal", async () => {
    const fs = inMemoryFacts()
    await fs.propose({ statement: "X", principalId: "k", channel: "telegram" })
    await fs.propose({ statement: "Y", principalId: "otro", channel: "telegram" })
    expect(await fs.listPending("k")).toHaveLength(1)
  })
})
