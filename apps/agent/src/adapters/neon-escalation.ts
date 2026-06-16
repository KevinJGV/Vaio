// Adapter de la cola de ESCALACIONES: implementa EscalationStore con Drizzle sobre Neon. La correlación de la
// respuesta de Kevin es por (notify_channel, notify_message_id) — el sistema, nunca el modelo (Inv #8). Las
// transiciones de estado son UPDATE CONDICIONAL por el estado previo válido → idempotentes ante reintentos de
// webhook (Telegram reintenta; el dedupe in-memory se pierde al restart → esto es el guard real).

import { and, desc, eq, inArray, sql } from "drizzle-orm"
import type {
  AnsweredEscalation,
  EscalationStore,
} from "../ports/escalation.js"
import type { Database } from "./db/client.js"
import { escalations } from "./db/schema.js"

/** Estados "abiertos" (aún sin resolver) para el anti-spam (rate-limit + dedup). */
const OPEN_STATUSES = ["pending", "notified"] as const

/** Normaliza la pregunta para el dedup por texto (semántico = followup). */
function normalizeQuestion(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ")
}

export function createEscalationStore(db: Database): EscalationStore {
  return {
    async create({ question, origin }) {
      const [row] = await db
        .insert(escalations)
        .values({
          question,
          originChannel: origin.channel,
          originConversationId: origin.conversationId,
          originThreadKey: origin.threadKey,
          askerPrincipalId: origin.askerPrincipalId,
          locale: origin.locale,
          status: "pending",
        })
        .returning({ id: escalations.id })
      if (!row) throw new Error("escalations insert no devolvió id")
      return { id: row.id }
    },

    async markNotified(id, notifyChannel, notifyMessageId) {
      await db
        .update(escalations)
        .set({
          status: "notified",
          notifyChannel,
          notifyMessageId,
          notifiedAt: sql`now()`,
        })
        .where(and(eq(escalations.id, id), eq(escalations.status, "pending")))
    },

    async markFailed(id) {
      await db
        .update(escalations)
        .set({ status: "failed" })
        .where(and(eq(escalations.id, id), eq(escalations.status, "pending")))
    },

    async findByNotifyMessage(
      notifyChannel,
      notifyMessageId
    ): Promise<AnsweredEscalation | null> {
      // Matchea notified|answered: el message_id fue de una escalada REAL. La idempotencia (no re-actuar ante un
      // retry) la garantiza markAnswered (UPDATE condicional WHERE status='notified'), no este filtro.
      const [row] = await db
        .select({
          id: escalations.id,
          question: escalations.question,
          originChannel: escalations.originChannel,
          originConversationId: escalations.originConversationId,
          originThreadKey: escalations.originThreadKey,
          askerPrincipalId: escalations.askerPrincipalId,
          locale: escalations.locale,
        })
        .from(escalations)
        .where(
          and(
            eq(escalations.notifyChannel, notifyChannel),
            eq(escalations.notifyMessageId, notifyMessageId),
            inArray(escalations.status, ["notified", "answered"])
          )
        )
        .limit(1)
      if (!row) return null
      return {
        id: row.id,
        question: row.question,
        origin: {
          channel: row.originChannel,
          conversationId: row.originConversationId ?? undefined,
          threadKey: row.originThreadKey ?? undefined,
          askerPrincipalId: row.askerPrincipalId,
          locale: row.locale,
        },
      }
    },

    async markAnswered(id, answer, factId) {
      // UPDATE condicional (solo desde 'notified') → idempotente: un 2º reply (retry de webhook) no afecta filas.
      const res = await db
        .update(escalations)
        .set({
          status: "answered",
          answer,
          factId: factId ?? null,
          answeredAt: sql`now()`,
        })
        .where(and(eq(escalations.id, id), eq(escalations.status, "notified")))
        .returning({ id: escalations.id })
      return res.length > 0
    },

    async countOpenByPrincipal(principalId) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(escalations)
        .where(
          and(
            eq(escalations.askerPrincipalId, principalId),
            inArray(escalations.status, [...OPEN_STATUSES])
          )
        )
      return row?.n ?? 0
    },

    async findOpenDuplicate(principalId, question) {
      const norm = normalizeQuestion(question)
      // Dedup por texto normalizado (sin re-embeber): trae las abiertas del principal y compara en memoria.
      const rows = await db
        .select({ id: escalations.id, question: escalations.question })
        .from(escalations)
        .where(
          and(
            eq(escalations.askerPrincipalId, principalId),
            inArray(escalations.status, [...OPEN_STATUSES])
          )
        )
        .orderBy(desc(escalations.createdAt))
        .limit(20)
      const hit = rows.find((r) => normalizeQuestion(r.question) === norm)
      return hit ? { id: hit.id } : null
    },
  }
}
