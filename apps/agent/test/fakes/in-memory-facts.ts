import type { FactStore, PendingFact } from "../../src/ports/facts.js"

interface Row {
  id: string
  statement: string
  status: "pending" | "confirmed" | "rejected"
  principalId: string
  createdAt: Date | null
}

/** Fake determinístico: ids "f1","f2",… (sin Date.now/random → estable en tests). */
export function inMemoryFacts(): FactStore & { rows: () => Row[] } {
  const rows: Row[] = []
  let n = 0
  return {
    rows: () => rows,
    async propose(input) {
      const id = `f${++n}`
      rows.push({
        id,
        statement: input.statement,
        status: "pending",
        principalId: input.principalId,
        createdAt: null,
      })
      return { id }
    },
    async commit(id) {
      const r = rows.find((x) => x.id === id && x.status === "pending")
      if (!r) return false
      r.status = "confirmed"
      return true
    },
    async reject(id) {
      const r = rows.find((x) => x.id === id && x.status === "pending")
      if (!r) return false
      r.status = "rejected"
      return true
    },
    async listPending(principalId, limit = 10): Promise<PendingFact[]> {
      return rows
        .filter((x) => x.status === "pending" && x.principalId === principalId)
        .slice(0, limit)
        .map((x) => ({
          id: x.id,
          statement: x.statement,
          createdAt: x.createdAt,
        }))
    },
  }
}
