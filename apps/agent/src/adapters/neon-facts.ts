// Adapter de la memoria de hechos: implementa FactStore con Drizzle sobre Neon. Embebe el statement al
// confirmar (no al proponer → no se gasta embedding en rechazos). Invalidar = marcar, nunca borrar.

import { and, desc, eq, isNull, sql } from "drizzle-orm"
import type { FactStore, PendingFact } from "../ports/facts.js"
import type { Embedder } from "../ports/memory.js"
import type { Database } from "./db/client.js"
import { facts } from "./db/schema.js"

export function createFactStore(db: Database, embedder: Embedder): FactStore {
  return {
    async propose(input) {
      const [row] = await db
        .insert(facts)
        .values({
          statement: input.statement,
          status: "pending",
          principalId: input.principalId,
          channel: input.channel,
          conversationId: input.conversationId,
          turnId: input.turnId,
        })
        .returning({ id: facts.id })
      if (!row) throw new Error("facts insert no devolvió id")
      return { id: row.id }
    },

    async commit(id) {
      const [existing] = await db
        .select({ statement: facts.statement })
        .from(facts)
        .where(and(eq(facts.id, id), eq(facts.status, "pending")))
        .limit(1)
      if (!existing) return false
      const [emb] = await embedder.embed([existing.statement])
      if (!emb) return false
      const res = await db
        .update(facts)
        .set({
          status: "confirmed",
          embedding: emb,
          validAt: sql`now()`,
          decidedAt: sql`now()`,
        })
        .where(and(eq(facts.id, id), eq(facts.status, "pending")))
        .returning({ id: facts.id })
      return res.length > 0
    },

    async reject(id) {
      const res = await db
        .update(facts)
        .set({ status: "rejected", decidedAt: sql`now()` })
        .where(and(eq(facts.id, id), eq(facts.status, "pending")))
        .returning({ id: facts.id })
      return res.length > 0
    },

    async listPending(principalId, limit = 10): Promise<PendingFact[]> {
      const rows = await db
        .select({
          id: facts.id,
          statement: facts.statement,
          createdAt: facts.createdAt,
        })
        .from(facts)
        .where(
          and(
            eq(facts.principalId, principalId),
            eq(facts.status, "pending"),
            isNull(facts.invalidAt)
          )
        )
        .orderBy(desc(facts.createdAt))
        .limit(limit)
      return rows.map((r) => ({
        id: r.id,
        statement: r.statement,
        createdAt: r.createdAt,
      }))
    },
  }
}
