import { describe, expect, it } from "vitest"
import { inMemoryFacts } from "./fakes/in-memory-facts.js"

describe("FactStore (contrato, vía fake)", () => {
  it("propose crea pending y devuelve id; listPending lo trae", async () => {
    const fs = inMemoryFacts()
    const { id } = await fs.propose({
      statement: "A Kevin no le gusta el fútbol",
      principalId: "k",
      channel: "telegram",
    })
    const pend = await fs.listPending("k")
    expect(pend).toHaveLength(1)
    expect(pend[0]?.id).toBe(id)
  })

  it("commit confirma y es idempotente (2º commit → false)", async () => {
    const fs = inMemoryFacts()
    const { id } = await fs.propose({
      statement: "X",
      principalId: "k",
      channel: "telegram",
    })
    expect(await fs.commit(id)).toBe(true)
    expect(await fs.commit(id)).toBe(false)
    expect(await fs.listPending("k")).toHaveLength(0)
  })

  it("reject descarta; commit posterior → false; commit a id inexistente → false", async () => {
    const fs = inMemoryFacts()
    const { id } = await fs.propose({
      statement: "X",
      principalId: "k",
      channel: "telegram",
    })
    expect(await fs.reject(id)).toBe(true)
    expect(await fs.commit(id)).toBe(false)
    expect(await fs.commit("nope")).toBe(false)
  })

  it("listPending filtra por principal", async () => {
    const fs = inMemoryFacts()
    await fs.propose({ statement: "X", principalId: "k", channel: "telegram" })
    await fs.propose({
      statement: "Y",
      principalId: "otro",
      channel: "telegram",
    })
    expect(await fs.listPending("k")).toHaveLength(1)
  })

  it("propose surface un fact confirmado vigente del mismo principal como conflicto; no de otro principal", async () => {
    const fs = inMemoryFacts()
    const { id: viejo } = await fs.propose({
      statement: "A Kevin le gusta X",
      principalId: "k",
      channel: "telegram",
    })
    await fs.commit(viejo)
    // mismo principal → aparece como candidato a conflicto
    const { conflicts } = await fs.propose({
      statement: "A Kevin ya no le gusta X",
      principalId: "k",
      channel: "telegram",
    })
    expect(conflicts.map((c) => c.id)).toContain(viejo)
    // otro principal → no ve el conflicto
    const { conflicts: otros } = await fs.propose({
      statement: "algo",
      principalId: "otro",
      channel: "telegram",
    })
    expect(otros).toHaveLength(0)
  })

  it("commit con supersedes invalida el viejo y guarda el linaje; sin supersedes lo deja vigente", async () => {
    const fs = inMemoryFacts()
    const { id: viejo } = await fs.propose({
      statement: "A Kevin le gusta X",
      principalId: "k",
      channel: "telegram",
    })
    await fs.commit(viejo)
    const { id: nuevo } = await fs.propose({
      statement: "Ahora le gusta Y",
      principalId: "k",
      channel: "telegram",
    })
    expect(await fs.commit(nuevo, { supersedes: [viejo] })).toBe(true)
    const viejoRow = fs.rows().find((r) => r.id === viejo)
    const nuevoRow = fs.rows().find((r) => r.id === nuevo)
    expect(viejoRow?.invalidAt).not.toBeNull() // el viejo quedó invalidado
    expect(nuevoRow?.supersedes).toEqual([viejo]) // linaje guardado
    // un fact que no se contradice: commit SIN supersedes no toca a nadie
    const { id: coexiste } = await fs.propose({
      statement: "También le gusta Z",
      principalId: "k",
      channel: "telegram",
    })
    await fs.commit(coexiste)
    expect(fs.rows().find((r) => r.id === nuevo)?.invalidAt).toBeNull()
  })

  it("commit con supersedes a un id inexistente/no-confirmado no rompe", async () => {
    const fs = inMemoryFacts()
    const { id } = await fs.propose({
      statement: "X",
      principalId: "k",
      channel: "telegram",
    })
    expect(await fs.commit(id, { supersedes: ["nope"] })).toBe(true)
  })
})
