// Adapter de la memoria de hechos: implementa FactStore con Drizzle sobre Neon. Embebe el statement al
// PROPONER (para detectar conflictos por cercanía vectorial) y reusa ese embedding al confirmar. Invalidar =
// marcar (bi-temporal), nunca borrar; el linaje del reemplazo va en `supersedes`.

import { and, asc, cosineDistance, eq, isNull, lt, ne, sql } from "drizzle-orm"
import type {
  ConflictCandidate,
  FactStore,
  PendingFact,
} from "../ports/facts.js"
import type { Embedder } from "../ports/memory.js"
import type { Database } from "./db/client.js"
import { facts } from "./db/schema.js"

export interface FactConflictConfig {
  /** Distancia coseno máxima para considerar un fact "cercano" (candidato a conflicto). Generoso a propósito. */
  conflictDistance: number
  /** Cuántos candidatos cercanos devolver como máximo. */
  conflictCandidates: number
}

export function createFactStore(
  db: Database,
  embedder: Embedder,
  cfg: FactConflictConfig
): FactStore {
  return {
    async propose(input) {
      // Embeber ahora (best-effort): habilita la detección de conflictos y se reusa al confirmar.
      let emb: number[] | undefined
      try {
        const [e] = await embedder.embed([input.statement])
        emb = e
      } catch {
        emb = undefined
      }
      const [row] = await db
        .insert(facts)
        .values({
          statement: input.statement,
          status: "pending",
          embedding: emb ?? null,
          principalId: input.principalId,
          channel: input.channel,
          conversationId: input.conversationId,
          turnId: input.turnId,
        })
        .returning({ id: facts.id })
      if (!row) throw new Error("facts insert no devolvió id")
      if (!emb) return { id: row.id, conflicts: [] }

      // Candidatos: facts confirmados vigentes del mismo principal, cercanos por coseno (excluye la fila nueva).
      const dist = cosineDistance(facts.embedding, emb)
      const candidates = await db
        .select({
          id: facts.id,
          statement: facts.statement,
          validAt: facts.validAt,
          dist: dist.as("dist"),
        })
        .from(facts)
        .where(
          and(
            eq(facts.status, "confirmed"),
            isNull(facts.invalidAt),
            eq(facts.principalId, input.principalId),
            ne(facts.id, row.id),
            lt(dist, cfg.conflictDistance)
          )
        )
        .orderBy(asc(sql`dist`))
        .limit(cfg.conflictCandidates)
      const conflicts: ConflictCandidate[] = candidates.map((c) => ({
        id: c.id,
        statement: c.statement,
        validAt: c.validAt,
      }))
      return { id: row.id, conflicts }
    },

    async commit(id, opts) {
      const [existing] = await db
        .select({ statement: facts.statement, embedding: facts.embedding })
        .from(facts)
        .where(and(eq(facts.id, id), eq(facts.status, "pending")))
        .limit(1)
      if (!existing) return false
      // Reusa el embedding del propose; si faltara (embed falló al proponer), embebe ahora como fallback.
      let emb = existing.embedding
      if (!emb) {
        const [e] = await embedder.embed([existing.statement])
        if (!e) return false
        emb = e
      }
      const supersedes =
        opts?.supersedes && opts.supersedes.length > 0 ? opts.supersedes : null

      return await db.transaction(async (tx) => {
        const res = await tx
          .update(facts)
          .set({
            status: "confirmed",
            embedding: emb,
            validAt: sql`now()`,
            decidedAt: sql`now()`,
            supersedes,
          })
          .where(and(eq(facts.id, id), eq(facts.status, "pending")))
          .returning({ id: facts.id })
        if (res.length === 0) return false
        // Invalidar (bi-temporal) los facts reemplazados: solo los confirmados-vigentes (ids inválidos se saltean).
        for (const oldId of supersedes ?? []) {
          await tx
            .update(facts)
            .set({ invalidAt: sql`now()`, expiredAt: sql`now()` })
            .where(
              and(
                eq(facts.id, oldId),
                eq(facts.status, "confirmed"),
                isNull(facts.invalidAt)
              )
            )
        }
        return true
      })
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
        .orderBy(sql`${facts.createdAt} desc`)
        .limit(limit)
      return rows.map((r) => ({
        id: r.id,
        statement: r.statement,
        createdAt: r.createdAt,
      }))
    },
  }
}
