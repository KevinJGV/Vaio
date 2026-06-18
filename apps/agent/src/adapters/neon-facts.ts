// Adapter de la memoria de hechos: implementa FactStore con Drizzle sobre Neon. Embebe el statement al
// PROPONER (para detectar conflictos por cercanía vectorial) y reusa ese embedding al confirmar. Invalidar =
// marcar (bi-temporal), nunca borrar; el linaje del reemplazo va en `supersedes`.

import { and, asc, cosineDistance, eq, isNull, lt, ne, sql } from "drizzle-orm"
import type {
  ConflictCandidate,
  FactStore,
  PendingFact,
} from "../ports/facts.js"
import type { Logger } from "../ports/logger.js"
import type { Embedder } from "../ports/memory.js"
import type { Database } from "./db/client.js"
import { facts } from "./db/schema.js"

export interface FactConflictConfig {
  /** Distancia coseno máxima para considerar un fact "cercano" (candidato a conflicto). Generoso: el coseno solo
   *  acota ruido lejano; el JUEZ (ConflictJudge) decide la contradicción real. */
  conflictDistance: number
  /** Cap de SEGURIDAD del juicio: se traen TODOS los cercanos del umbral hasta este tope (si se alcanza, se loguea
   *  — no truncar el juicio en silencio). NO es el límite de presentación. */
  conflictMax: number
}

export function createFactStore(
  db: Database,
  embedder: Embedder,
  cfg: FactConflictConfig,
  logger?: Logger
): FactStore {
  // Candidatos a conflicto: facts confirmados vigentes del mismo principal, cercanos por coseno al embedding
  // dado (excluye `excludeId`). El JUEZ decide si REALMENTE se contradicen. Reusado por propose/listPending/
  // findConfirmedNear. Trae TODOS los del umbral hasta `conflictMax` (juicio completo, sin cabos sueltos).
  const findNearConfirmed = async (
    emb: number[],
    principalId: string,
    excludeId: string | undefined,
    limit: number = cfg.conflictMax
  ): Promise<ConflictCandidate[]> => {
    const dist = cosineDistance(facts.embedding, emb)
    // `excludeId` opcional: solo se filtra cuando hay un id real (propose excluye la fila recién insertada). NO
    // pasar "" → `facts.id != ''` castea "" a uuid y Postgres lanza "invalid input syntax for type uuid".
    const where = excludeId
      ? and(
          eq(facts.status, "confirmed"),
          isNull(facts.invalidAt),
          eq(facts.principalId, principalId),
          ne(facts.id, excludeId),
          lt(dist, cfg.conflictDistance)
        )
      : and(
          eq(facts.status, "confirmed"),
          isNull(facts.invalidAt),
          eq(facts.principalId, principalId),
          lt(dist, cfg.conflictDistance)
        )
    const rows = await db
      .select({
        id: facts.id,
        statement: facts.statement,
        validAt: facts.validAt,
      })
      .from(facts)
      .where(where)
      .orderBy(asc(dist))
      .limit(limit)
    // No truncar el juicio en silencio: si llenamos el cap, podría haber más cercanos sin evaluar (Inv: cabos sueltos).
    if (rows.length === limit && limit === cfg.conflictMax) {
      logger?.warn(
        { principalId, conflictMax: cfg.conflictMax },
        "findNearConfirmed alcanzó FACT_CONFLICT_MAX — posibles candidatos sin juzgar"
      )
    }
    return rows.map((r) => ({
      id: r.id,
      statement: r.statement,
      validAt: r.validAt,
    }))
  }

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
      const conflicts = await findNearConfirmed(emb, input.principalId, row.id)
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
          embedding: facts.embedding,
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
      // Recompute los conflictos de cada pendiente con su embedding YA guardado (sin re-embeber) → el turno de
      // confirmación tiene los ids para `supersedes`. Cierra el hueco de continuidad entre turnos.
      const out: PendingFact[] = []
      for (const r of rows) {
        const conflicts = r.embedding
          ? await findNearConfirmed(r.embedding, principalId, r.id)
          : []
        out.push({
          id: r.id,
          statement: r.statement,
          createdAt: r.createdAt,
          conflicts,
        })
      }
      return out
    },

    async invalidate(id) {
      // Desaprender = invalidar bi-temporal (reversible: la fila queda). UPDATE condicional → idempotente:
      // solo toca un confirmed-vigente; 2ª llamada (ya invalidado) afecta 0 filas → false. NUNCA borra.
      const res = await db
        .update(facts)
        .set({
          invalidAt: sql`now()`,
          expiredAt: sql`now()`,
          decidedAt: sql`now()`,
        })
        .where(
          and(
            eq(facts.id, id),
            eq(facts.status, "confirmed"),
            isNull(facts.invalidAt)
          )
        )
        .returning({ id: facts.id })
      return res.length > 0
    },

    async listConfirmed(principalId, limit) {
      // TODOS los confirmados vigentes del principal (recientes primero), sin coseno → el matcher juzga el conjunto
      // COMPLETO (recall total al desaprender). El `limit` es el cap de seguridad (el caller loguea si lo alcanza).
      const rows = await db
        .select({
          id: facts.id,
          statement: facts.statement,
          validAt: facts.validAt,
        })
        .from(facts)
        .where(
          and(
            eq(facts.status, "confirmed"),
            isNull(facts.invalidAt),
            eq(facts.principalId, principalId)
          )
        )
        .orderBy(sql`${facts.createdAt} desc`)
        .limit(limit)
      return rows.map((r) => ({
        id: r.id,
        statement: r.statement,
        validAt: r.validAt,
      }))
    },
  }
}
