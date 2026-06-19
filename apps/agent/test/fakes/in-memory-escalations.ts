import type {
  AnsweredEscalation,
  EscalationKind,
  EscalationOrigin,
  EscalationStore,
  ThreadOrigin,
} from "../../src/ports/escalation.js"

type Status = "pending" | "notified" | "answered" | "dismissed" | "failed"

interface Row {
  id: string
  question: string
  kind: EscalationKind
  origin: EscalationOrigin
  notifyChannel: string | null
  notifyMessageId: string | null
  notifyTopicId: string | null
  status: Status
  answer: string | null
  factId: string | null
}

const OPEN: Status[] = ["pending", "notified"]
const norm = (q: string): string => q.trim().toLowerCase().replace(/\s+/g, " ")

/** Fake determinístico del EscalationStore: ids "e1","e2",… Modela fielmente la máquina de estados y la
 *  idempotencia de markAnswered (UPDATE condicional). El dedup es por texto normalizado (igual que el adapter). */
export function inMemoryEscalations(): EscalationStore & { rows: () => Row[] } {
  const rows: Row[] = []
  let n = 0
  return {
    rows: () => rows,
    async create({ question, kind, origin }) {
      const id = `e${++n}`
      rows.push({
        id,
        question,
        kind,
        origin,
        notifyChannel: null,
        notifyMessageId: null,
        notifyTopicId: null,
        status: "pending",
        answer: null,
        factId: null,
      })
      return { id }
    },
    async markNotified(id, notifyChannel, notifyMessageId, notifyTopicId) {
      const r = rows.find((x) => x.id === id && x.status === "pending")
      if (!r) return
      r.status = "notified"
      r.notifyChannel = notifyChannel
      r.notifyMessageId = notifyMessageId
      r.notifyTopicId = notifyTopicId ?? null
    },
    async markFailed(id) {
      const r = rows.find((x) => x.id === id && x.status === "pending")
      if (r) r.status = "failed"
    },
    async findByNotifyMessage(
      notifyChannel,
      notifyMessageId
    ): Promise<AnsweredEscalation | null> {
      // notified|answered: el message_id fue de una escalada real; la idempotencia la da markAnswered.
      const r = rows.find(
        (x) =>
          x.status === "notified" &&
          x.notifyChannel === notifyChannel &&
          x.notifyMessageId === notifyMessageId
      )
      return r
        ? { id: r.id, question: r.question, kind: r.kind, origin: r.origin }
        : null
    },
    async findByNotifyTopic(
      notifyChannel,
      notifyTopicId
    ): Promise<AnsweredEscalation | null> {
      const r = rows.find(
        (x) =>
          x.status === "notified" &&
          x.notifyChannel === notifyChannel &&
          x.notifyTopicId === notifyTopicId
      )
      return r
        ? { id: r.id, question: r.question, kind: r.kind, origin: r.origin }
        : null
    },
    async markAnswered(id, answer, factId) {
      const r = rows.find((x) => x.id === id && x.status === "notified")
      if (!r) return false
      r.status = "answered"
      r.answer = answer
      r.factId = factId ?? null
      return true
    },
    async linkFact(id, factId) {
      const r = rows.find((x) => x.id === id)
      if (r) r.factId = factId
    },
    async findResolvedByTopic(
      notifyChannel,
      notifyTopicId
    ): Promise<ThreadOrigin | null> {
      // El fake no tiene JOIN a facts → devuelve sin `statement` (el render del statement se testea aparte).
      const r = rows.find(
        (x) =>
          x.status === "answered" &&
          x.notifyChannel === notifyChannel &&
          x.notifyTopicId === notifyTopicId
      )
      if (!r) return null
      return {
        question: r.question,
        answer: r.answer ?? "",
        ...(r.factId ? { factId: r.factId } : {}),
        ...(r.origin.threadKey
          ? {
              visitor: {
                channel: r.origin.channel,
                conversationKey: r.origin.threadKey,
                locale: r.origin.locale,
              },
            }
          : {}),
      }
    },
    async countOpenByPrincipal(principalId) {
      return rows.filter(
        (x) =>
          x.origin.askerPrincipalId === principalId && OPEN.includes(x.status)
      ).length
    },
    async findOpenDuplicate(principalId, question) {
      const q = norm(question)
      const hit = rows.find(
        (x) =>
          x.origin.askerPrincipalId === principalId &&
          OPEN.includes(x.status) &&
          norm(x.question) === q
      )
      return hit ? { id: hit.id } : null
    },
  }
}
