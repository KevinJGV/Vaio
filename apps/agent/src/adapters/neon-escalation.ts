// Adapter de la cola de ESCALACIONES: implementa EscalationStore con Drizzle sobre Neon. La correlación de la
// respuesta de Kevin es por (notify_channel, notify_message_id) — el sistema, nunca el modelo (Inv #8). Las
// transiciones de estado son UPDATE CONDICIONAL por el estado previo válido → idempotentes ante reintentos de
// webhook (Telegram reintenta; el dedupe in-memory se pierde al restart → esto es el guard real).

import { and, desc, eq, inArray, type SQL, sql } from "drizzle-orm"
import type {
  AnsweredEscalation,
  EscalationKind,
  EscalationStore,
} from "../ports/escalation.js"
import type { Database } from "./db/client.js"
import { escalations, facts } from "./db/schema.js"

/** Estados "abiertos" (aún sin resolver) para el anti-spam (rate-limit + dedup). */
const OPEN_STATUSES = ["pending", "notified"] as const

/** Normaliza la pregunta para el dedup por texto (semántico = followup). */
function normalizeQuestion(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ")
}

/** SELECT + map compartido por las dos correlaciones (por message_id citado o por topic del hilo). Matchea SOLO
 *  'notified' (pendiente de responder): la PRIMERA respuesta del owner la procesa; una vez 'answered', los
 *  mensajes siguientes en el hilo NO se consumen → siguen como conversación normal (Kevin puede continuar). El
 *  retry de webhook lo filtra el dedupe por update_id del router; markAnswered (UPDATE WHERE notified) es la red. */
async function findOneAnswered(
  db: Database,
  match: SQL | undefined
): Promise<AnsweredEscalation | null> {
  const [row] = await db
    .select({
      id: escalations.id,
      question: escalations.question,
      kind: escalations.kind,
      originChannel: escalations.originChannel,
      originConversationId: escalations.originConversationId,
      originThreadKey: escalations.originThreadKey,
      askerPrincipalId: escalations.askerPrincipalId,
      locale: escalations.locale,
    })
    .from(escalations)
    .where(and(match, eq(escalations.status, "notified")))
    .limit(1)
  if (!row) return null
  return {
    id: row.id,
    question: row.question,
    kind: row.kind as EscalationKind,
    origin: {
      channel: row.originChannel,
      conversationId: row.originConversationId ?? undefined,
      threadKey: row.originThreadKey ?? undefined,
      askerPrincipalId: row.askerPrincipalId,
      locale: row.locale,
    },
  }
}

export function createEscalationStore(db: Database): EscalationStore {
  return {
    async create({ question, kind, origin }) {
      const [row] = await db
        .insert(escalations)
        .values({
          question,
          kind,
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

    async markNotified(id, notifyChannel, notifyMessageId, notifyTopicId) {
      await db
        .update(escalations)
        .set({
          status: "notified",
          notifyChannel,
          notifyMessageId,
          notifyTopicId: notifyTopicId ?? null,
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

    async findByNotifyMessage(notifyChannel, notifyMessageId) {
      return findOneAnswered(
        db,
        and(
          eq(escalations.notifyChannel, notifyChannel),
          eq(escalations.notifyMessageId, notifyMessageId)
        )
      )
    },

    async findByNotifyTopic(notifyChannel, notifyTopicId) {
      return findOneAnswered(
        db,
        and(
          eq(escalations.notifyChannel, notifyChannel),
          eq(escalations.notifyTopicId, notifyTopicId)
        )
      )
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

    async linkFact(id, factId) {
      await db.update(escalations).set({ factId }).where(eq(escalations.id, id))
    },

    async findResolvedByTopic(notifyChannel, notifyTopicId) {
      // Conciencia del hilo (Inc 2): la escalada ya RESUELTA cuyo topic coincide + el fact curado (LEFT JOIN
      // por escalations.fact_id → facts.statement, que puede no existir si la curación no guardó nada). NO muta.
      const [row] = await db
        .select({
          question: escalations.question,
          answer: escalations.answer,
          factId: escalations.factId,
          statement: facts.statement,
        })
        .from(escalations)
        .leftJoin(facts, eq(facts.id, escalations.factId))
        .where(
          and(
            eq(escalations.notifyChannel, notifyChannel),
            eq(escalations.notifyTopicId, notifyTopicId),
            eq(escalations.status, "answered")
          )
        )
        .limit(1)
      if (!row) return null
      return {
        question: row.question,
        answer: row.answer ?? "",
        ...(row.statement ? { statement: row.statement } : {}),
        ...(row.factId ? { factId: row.factId } : {}),
      }
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
