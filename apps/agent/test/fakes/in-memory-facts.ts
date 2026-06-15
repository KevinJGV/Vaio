import type {
  ConflictCandidate,
  FactStore,
  PendingFact,
} from "../../src/ports/facts.js"

interface Row {
  id: string
  statement: string
  status: "pending" | "confirmed" | "rejected"
  principalId: string
  createdAt: Date | null
  validAt: Date | null
  invalidAt: Date | null
  supersedes: string[] | null
}

const FIXED = new Date(0) // determinístico (sin Date.now → estable en tests)

/** Fake determinístico: ids "f1","f2",… La detección de conflictos del adapter real es VECTORIAL; acá se
 *  modela como "facts confirmados vigentes del mismo principal" (stub de contrato — el filtro por distancia se
 *  verifica en e2e). La invalidación bi-temporal (supersede) sí se modela fielmente. */
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
        validAt: null,
        invalidAt: null,
        supersedes: null,
      })
      const conflicts: ConflictCandidate[] = rows
        .filter(
          (x) =>
            x.status === "confirmed" &&
            x.invalidAt === null &&
            x.principalId === input.principalId &&
            x.id !== id
        )
        .map((x) => ({ id: x.id, statement: x.statement, validAt: x.validAt }))
      return { id, conflicts }
    },
    async commit(id, opts) {
      const r = rows.find((x) => x.id === id && x.status === "pending")
      if (!r) return false
      r.status = "confirmed"
      r.validAt = FIXED
      r.supersedes =
        opts?.supersedes && opts.supersedes.length > 0 ? opts.supersedes : null
      for (const oldId of opts?.supersedes ?? []) {
        const old = rows.find(
          (x) =>
            x.id === oldId && x.status === "confirmed" && x.invalidAt === null
        )
        if (old) old.invalidAt = FIXED
      }
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
