import type {
  AnsweredEscalation,
  EscalationOrigin,
  EscalationStore,
} from "../../src/ports/escalation.js"

type Status = "pending" | "notified" | "answered" | "dismissed" | "failed"

interface Row {
  id: string
  question: string
  origin: EscalationOrigin
  notifyChannel: string | null
  notifyMessageId: string | null
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
    async create({ question, origin }) {
      const id = `e${++n}`
      rows.push({
        id,
        question,
        origin,
        notifyChannel: null,
        notifyMessageId: null,
        status: "pending",
        answer: null,
        factId: null,
      })
      return { id }
    },
    async markNotified(id, notifyChannel, notifyMessageId) {
      const r = rows.find((x) => x.id === id && x.status === "pending")
      if (!r) return
      r.status = "notified"
      r.notifyChannel = notifyChannel
      r.notifyMessageId = notifyMessageId
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
          (x.status === "notified" || x.status === "answered") &&
          x.notifyChannel === notifyChannel &&
          x.notifyMessageId === notifyMessageId
      )
      return r ? { id: r.id, question: r.question, origin: r.origin } : null
    },
    async markAnswered(id, answer, factId) {
      const r = rows.find((x) => x.id === id && x.status === "notified")
      if (!r) return false
      r.status = "answered"
      r.answer = answer
      r.factId = factId ?? null
      return true
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
