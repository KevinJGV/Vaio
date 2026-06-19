// INBOUND de escalaciones: intercepta la RESPUESTA del owner (Kevin) a una escalada antes de tratarla como un
// turno normal. Kevin responde DENTRO del hilo (Threaded Mode → threadId) o citando el DM (replyToMessageId) →
// correlacionamos por id (Inv #8, el sistema, no el modelo). Si matchea: marca answered (idempotente), RETOMA al
// visitante (await → "se lo transmití" solo si LLEGÓ de verdad) y CURA facts de la respuesta de Kevin: descompone
// en átomos (FactDecomposer, 3ª persona, nunca lo sensible) → el JUEZ decide la relación con los vigentes →
// persiste/invalida (auto-resuelve: contradice→guarda+invalida el viejo, dup→no duplica, aditivo→guarda). Aprende
// SIEMPRE de la respuesta del owner (info suya), gateado solo por el decomposer + el veto; el `kind` es solo para el
// framing del DM. Ejecución DETERMINÍSTICA (no una tool que el modelo decida → sin gap "dice pero no hace"). Si NO matchea → false.

import type { ConflictJudge } from "../../ports/conflict-judge.js"
import type {
  AnsweredEscalation,
  EscalationStore,
} from "../../ports/escalation.js"
import type { FactDecomposer } from "../../ports/fact-decomposer.js"
import type { ConflictCandidate, FactStore } from "../../ports/facts.js"
import type { Logger } from "../../ports/logger.js"
import type { ConversationResumer } from "../../ports/proactive.js"
import type { TelegramClient } from "./client.js"
import { escapeTelegramHtml } from "./html.js"
import type { NormalizeResult } from "./normalize.js"

type Turn = Extract<NormalizeResult, { kind: "turn" }>

const NOTIFY_CHANNEL = "telegram"

/** Veto del owner: "no lo aprendas / no guardes / no lo recuerdes" → no tocar la memoria con esta respuesta. */
const VETO_RE =
  /\bno\s+(lo\s+|los\s+|la\s+)?(aprend|guard|recuerd|almacen|anot)/i

interface InboundDeps {
  escalations: EscalationStore
  resumer: ConversationResumer
  client: TelegramClient
  logger: Logger
  /** Curación (opcionales: sin ellos, el inbound solo retoma/confirma — degradación Inv #1). */
  factStore?: FactStore
  factDecomposer?: FactDecomposer
  conflictJudge?: ConflictJudge
  /** Idioma CANÓNICO en que se redactan los facts curados (no el del visitante/owner) → memoria consistente. Default "es". */
  factCanonicalLocale?: "es" | "en"
}

interface CurationResult {
  learned: string[] // statements guardados (3ª persona)
  superseded: string[] // statements viejos dados de baja (invalidados) por contradicción de alta confianza
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

/** ¿El owner VETÓ tocar la memoria con esta respuesta? ("no lo aprendas / no guardes / no lo recuerdes".) */
function isVetoed(ownerText: string): boolean {
  return VETO_RE.test(ownerText)
}

/** Curación DETERMINÍSTICA (sistema): descompone la respuesta de Kevin en facts ATÓMICOS → el JUEZ decide la
 *  relación de cada uno con los vigentes → el sistema persiste/invalida (Inv #8/#9). AUTO-RESUELVE (no cuelga
 *  pendientes): contradicción de alta confianza → guarda el nuevo INVALIDANDO el viejo (el contrapuesto queda
 *  registrado); duplicado → no duplica; aditivo → guarda. **Aprende SIEMPRE de la respuesta del owner** (info suya,
 *  confiable) gateado solo por el decomposer (filtra no-factual/sensible/contacto) + el veto; el `kind` es solo para
 *  el framing del DM, no gatea la curación. best-effort: fallo → no toca nada. */
async function curate(
  deps: InboundDeps,
  esc: AnsweredEscalation,
  ownerText: string,
  ownerPrincipalId: string
): Promise<CurationResult> {
  // Los facts se REDACTAN/juzgan en el idioma CANÓNICO (no el del visitante/owner) → memoria consistente.
  const locale: "es" | "en" = deps.factCanonicalLocale ?? "es"
  const empty: CurationResult = { learned: [], superseded: [] }
  if (!deps.factStore || !deps.factDecomposer) {
    deps.logger.info(
      { escId: esc.id },
      "curación: sin factStore/decomposer → skip"
    )
    return empty
  }
  if (isVetoed(ownerText)) {
    deps.logger.info(
      { escId: esc.id },
      "curación: veto del owner → no toca la memoria"
    )
    return empty
  }
  const factStore = deps.factStore
  // Descomponer en átomos mono-idea (el decomposer ya filtra lo no-factual/sensible/contacto → [] si no hay nada).
  let atoms: string[]
  try {
    const r = await deps.factDecomposer.decompose({
      rawText: ownerText,
      question: esc.question,
      locale,
    })
    atoms = r.statements
  } catch {
    atoms = []
  }
  if (atoms.length === 0) return empty

  const learned: string[] = []
  const superseded: string[] = []
  let firstFactId: string | null = null // costura Inc 2: anclar la escalada al 1er fact curado (hilo→fact)

  // Veredicto del juez por candidato cercano (emite ordinales; el sistema conoce los ids — Inv #8).
  const verdicts = async (
    atom: string,
    candidates: ConflictCandidate[]
  ): Promise<{ contradicts: ConflictCandidate[]; anyDuplicate: boolean }> => {
    if (!deps.conflictJudge || candidates.length === 0) {
      return { contradicts: [], anyDuplicate: false }
    }
    const { decisions } = await deps.conflictJudge.judge({
      rawText: ownerText,
      statement: atom,
      candidates: candidates.map((c, i) => ({
        ordinal: i,
        statement: c.statement,
      })),
      locale,
    })
    const contradicts = candidates.filter(
      (_c, i) =>
        decisions.find((d) => d.ordinal === i)?.verdict === "contradicts"
    )
    const anyDuplicate = decisions.some((d) => d.verdict === "duplicate")
    return { contradicts, anyDuplicate }
  }

  for (const atom of atoms) {
    try {
      const { id, conflicts } = await factStore.propose({
        statement: atom,
        principalId: ownerPrincipalId,
        channel: NOTIFY_CHANNEL,
        conversationId: esc.origin.conversationId,
      })
      if (conflicts.length === 0) {
        await factStore.commit(id)
        learned.push(atom)
        firstFactId ??= id
      } else {
        const { contradicts, anyDuplicate } = await verdicts(atom, conflicts)
        if (contradicts.length > 0) {
          // Contradice (alta confianza) → guarda el nuevo invalidando los viejos (commit con supersedes).
          await factStore.commit(id, {
            supersedes: contradicts.map((c) => c.id),
          })
          learned.push(atom)
          superseded.push(...contradicts.map((c) => c.statement))
          firstFactId ??= id
        } else if (anyDuplicate) {
          await factStore.reject(id) // dedup: no duplicar
        } else {
          await factStore.commit(id) // coexiste/dudoso → aditivo
          learned.push(atom)
          firstFactId ??= id
        }
      }
    } catch (err) {
      deps.logger.warn(
        {
          escId: esc.id,
          err: err instanceof Error ? err.message : String(err),
        },
        "curación: átomo falló (best-effort)"
      )
    }
  }

  if (firstFactId) await deps.escalations.linkFact(esc.id, firstFactId)
  deps.logger.info(
    { escId: esc.id, learned: learned.length, superseded: superseded.length },
    "curación: resuelta"
  )
  return { learned, superseded }
}

/** Confirmación a Kevin (en su idioma) según el resultado REAL del retomo + la curación. La invalidación es
 *  SIEMPRE VISIBLE (nombra lo que dio de baja). Invita a avisar si algo no cuadra. */
function ownerConfirmation(r: {
  delivered: boolean
  learned: string[]
  superseded: string[]
}): string {
  const head = r.delivered
    ? "✅ Listo, se lo transmití al visitante."
    : "✅ Anotado (el visitante no está en línea ahora)."
  const parts: string[] = [head]
  if (r.learned.length > 0) {
    parts.push(
      `Guardé ${r.learned.map((s) => `«${escapeTelegramHtml(s)}»`).join(", ")} como dato tuyo.`
    )
  }
  if (r.superseded.length > 0) {
    parts.push(
      `Di de baja ${r.superseded.map((s) => `«${escapeTelegramHtml(s)}»`).join(", ")} (ya no aplicaba).`
    )
  }
  if (r.learned.length === 0 && r.superseded.length === 0) {
    parts.push(
      "Si querés que recuerde algo de esto como dato tuyo, decímelo y lo guardo."
    )
  } else {
    parts.push("(avisame si algo no cuadra).")
  }
  return parts.join(" ")
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
    // 2) Curación (default por tipo + veto/override + middleware-siempre). El dato lo aporta Kevin (owner), gated.
    const { learned, superseded } = await curate(
      deps,
      esc,
      norm.text,
      ownerPrincipalId
    )
    // 3) Confirmar a Kevin en el MISMO hilo, según el resultado real.
    const send =
      norm.threadId !== undefined ? { messageThreadId: norm.threadId } : {}
    await deps.client.sendMessage(
      norm.chatId,
      ownerConfirmation({ delivered, learned, superseded }),
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
