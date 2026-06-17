// INBOUND de escalaciones: intercepta la RESPUESTA del owner (Kevin) a una escalada antes de tratarla como un
// turno normal. Kevin responde DENTRO del hilo (Threaded Mode → threadId) o citando el DM (replyToMessageId) →
// correlacionamos por id (Inv #8, el sistema, no el modelo). Si matchea: marca answered (idempotente), RETOMA al
// visitante (await → "se lo transmití" solo si LLEGÓ de verdad) y, según el TIPO de escalada + lo que Kevin diga,
// CURA un fact (default-por-tipo, redactado 3ª persona por el FactDrafter, nunca lo sensible) — ejecución
// DETERMINÍSTICA del sistema (no una tool que el modelo deba decidir → no reintroduce el gap "dice pero no hace").
// Si NO matchea, es un turno normal de Kevin → devuelve false.

import type {
  AnsweredEscalation,
  EscalationStore,
} from "../../ports/escalation.js"
import type { FactDrafter } from "../../ports/fact-drafter.js"
import type { FactStore } from "../../ports/facts.js"
import type { Logger } from "../../ports/logger.js"
import type { ConversationResumer } from "../../ports/proactive.js"
import type { TelegramClient } from "./client.js"
import { escapeTelegramHtml } from "./html.js"
import type { NormalizeResult } from "./normalize.js"

type Turn = Extract<NormalizeResult, { kind: "turn" }>

const NOTIFY_CHANNEL = "telegram"

/** Veto del owner: "no lo aprendas / no guardes / no lo recuerdes" → no curar aunque el tipo aprenda por default. */
const VETO_RE =
  /\bno\s+(lo\s+|los\s+|la\s+)?(aprend|guard|recuerd|almacen|anot)/i
/** Override del owner: "guardalo / agregalo / recordá / anotá" → curar aunque el tipo NO aprenda por default. */
const FORCE_RE = /\b(guard[aá]|agreg[aá]|record[aá]|almacen[aá]|anot[aá])/i

interface InboundDeps {
  escalations: EscalationStore
  resumer: ConversationResumer
  client: TelegramClient
  logger: Logger
  /** Curación (opcionales: sin ellos, el inbound solo retoma/confirma — degradación Inv #1). */
  factStore?: FactStore
  factDrafter?: FactDrafter
}

interface CurationResult {
  statement: string | null // lo que se guardó (3ª persona), o null
  conflict: boolean // chocó con un fact previo → quedó PENDING (Kevin resuelve)
}

function parseTelegramKey(
  key: string
): { chatId: number; threadId?: number } | null {
  const [chatPart, threadPart] = key.split(":")
  const chatId = Number(chatPart)
  if (!Number.isInteger(chatId)) return null
  if (threadPart === undefined) return { chatId }
  const threadId = Number(threadPart)
  return Number.isInteger(threadId) ? { chatId, threadId } : { chatId }
}

/** ¿Esta respuesta debe volverse un fact? Default por TIPO, con veto/override del owner. knowledge aprende salvo
 *  veto; contact/claim NO aprenden salvo que Kevin lo fuerce. (El "qué" lo redacta el drafter; esto es el "si".) */
function shouldLearn(
  kind: AnsweredEscalation["kind"],
  ownerText: string
): boolean {
  if (kind === "knowledge") return !VETO_RE.test(ownerText)
  return FORCE_RE.test(ownerText) // contact | claim
}

/** Curación DETERMINÍSTICA (sistema): decide por tipo → redacta (drafter) → persiste (FactStore). El LLM solo
 *  produce el statement (Inv #8). Conflicto → deja PENDING (no auto-commit). best-effort: cualquier fallo → no guarda. */
async function curate(
  deps: InboundDeps,
  esc: AnsweredEscalation,
  ownerText: string,
  ownerPrincipalId: string,
  locale: "es" | "en"
): Promise<CurationResult> {
  if (!deps.factStore || !deps.factDrafter) {
    deps.logger.info(
      { escId: esc.id },
      "curación: sin factStore/drafter → skip"
    )
    return { statement: null, conflict: false }
  }
  if (!shouldLearn(esc.kind, ownerText)) {
    deps.logger.info(
      { escId: esc.id, kind: esc.kind },
      "curación: no aprende (default del tipo o veto del owner)"
    )
    return { statement: null, conflict: false }
  }
  const { statement, reason } = await deps.factDrafter.draft({
    question: esc.question,
    ownerAnswer: ownerText,
    locale,
  })
  if (!statement) {
    // no-factual o sensible (salvaguarda anti-fuga) o el drafter falló → no guarda
    deps.logger.info(
      { escId: esc.id, reason },
      "curación: el drafter no produjo fact (no-factual/sensible/error)"
    )
    return { statement: null, conflict: false }
  }
  const { id: factId, conflicts } = await deps.factStore.propose({
    statement,
    principalId: ownerPrincipalId,
    channel: NOTIFY_CHANNEL,
    conversationId: esc.origin.conversationId,
  })
  if (conflicts.length > 0) {
    deps.logger.info(
      { escId: esc.id, statement },
      "curación: conflicto con un fact previo → PENDING (Kevin resuelve)"
    )
    return { statement: null, conflict: true } // PENDING: Kevin adjudica con resolveFact
  }
  await deps.factStore.commit(factId)
  await deps.escalations.linkFact(esc.id, factId)
  deps.logger.info(
    { escId: esc.id, factId, statement },
    "curación: fact guardado"
  )
  return { statement, conflict: false }
}

/** Confirmación a Kevin (en su idioma) según el resultado REAL del retomo + la curación. NO promete "borrar"
 *  (el desaprender es un followup): invita a avisar si algo no cuadra. */
function ownerConfirmation(r: {
  delivered: boolean
  learned: string | null
  conflict: boolean
}): string {
  const head = r.delivered
    ? "✅ Listo, se lo transmití al visitante."
    : "✅ Anotado (el visitante no está en línea ahora)."
  if (r.learned) {
    return `${head} Guardé «${escapeTelegramHtml(r.learned)}» como dato tuyo (avisame si algo no cuadra).`
  }
  if (r.conflict) {
    return `${head} Eso choca con algo que ya sabía — decime con cuál te quedás y lo resuelvo.`
  }
  return `${head} Si querés que recuerde algo de esto como dato tuyo, decímelo y lo guardo.`
}

/** Intenta tratar `norm` como la respuesta del owner a una escalada. Devuelve true si la CONSUMIÓ (no es un turno
 *  nuevo). Awaitea solo la correlación + markAnswered (rápido); el retomo + la curación + la confirmación van en
 *  background (await interno para reportar el resultado REAL), tras el ACK del webhook. */
export async function tryHandleEscalationReply(
  deps: InboundDeps,
  norm: Turn
): Promise<boolean> {
  // Correlación: PRIMERO por topic (Kevin responde DENTRO del hilo, sin citar); FALLBACK por reply-to. Por id (Inv #8).
  const esc =
    (norm.threadId !== undefined
      ? await deps.escalations.findByNotifyTopic(
          NOTIFY_CHANNEL,
          String(norm.threadId)
        )
      : null) ??
    (norm.replyToMessageId !== undefined
      ? await deps.escalations.findByNotifyMessage(
          NOTIFY_CHANNEL,
          String(norm.replyToMessageId)
        )
      : null)
  if (!esc) return false // ni hilo ni reply de escalada → turno normal de Kevin

  // Idempotencia (UPDATE condicional): un retry de webhook ya procesado → answered=false → consumir sin re-actuar.
  const answered = await deps.escalations.markAnswered(esc.id, norm.text)
  if (!answered) {
    deps.logger.info(
      { escId: esc.id },
      "tg: reply de escalada ya procesado (idempotente)"
    )
    return true
  }

  deps.logger.info(
    { escId: esc.id, kind: esc.kind, originChannel: esc.origin.channel },
    "tg: escalada respondida por el owner"
  )

  const ownerPrincipalId = String(norm.fromId)
  const locale: "es" | "en" = norm.locale === "en" ? "en" : "es"

  // Trabajo PESADO (retomo re-entra el agente; curación llama al LLM) en BACKGROUND: ya consumimos (answered),
  // retornamos rápido para el ACK. Awaitea INTERNAMENTE para confirmarle a Kevin el resultado real.
  void (async () => {
    // 1) Retomo al visitante (delivered = LLEGÓ de verdad, no una promesa). Web → no push (cierra vía fact).
    let delivered = false
    if (esc.origin.channel === "telegram" && esc.origin.threadKey) {
      const routing = parseTelegramKey(esc.origin.threadKey)
      if (routing) {
        const res = await deps.resumer.resumeConversation({
          conversationKey: esc.origin.threadKey,
          channel: "telegram",
          locale: esc.origin.locale,
          originalQuestion: esc.question,
          injectedAnswer: norm.text,
          routing,
        })
        delivered = res.delivered
      }
    }
    // 2) Curación (default por tipo + veto/override). El dato lo aporta Kevin (owner), gated, 3ª persona.
    const { statement, conflict } = await curate(
      deps,
      esc,
      norm.text,
      ownerPrincipalId,
      locale
    )
    // 3) Confirmar a Kevin en el MISMO hilo, según el resultado real.
    const send =
      norm.threadId !== undefined ? { messageThreadId: norm.threadId } : {}
    await deps.client.sendMessage(
      norm.chatId,
      ownerConfirmation({ delivered, learned: statement, conflict }),
      send
    )
  })().catch((err) => {
    deps.logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "tg: post-proceso de escalada respondida falló"
    )
  })

  return true
}
