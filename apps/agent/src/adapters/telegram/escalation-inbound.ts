// INBOUND de escalaciones: intercepta la RESPUESTA del owner (Kevin) a una escalada antes de tratarla como un
// turno normal. Kevin responde CITANDO (reply) el DM de la escalada → correlacionamos por message_id (Inv #8, el
// sistema, no el modelo). Si matchea: marca answered (idempotente), RETOMA al visitante (si su canal tiene push) y
// le confirma a Kevin + lo invita a curar (la curación va por su flujo conversacional normal — NUNCA auto). Si NO
// matchea, es un reply normal de Kevin → devuelve false y sigue el flujo de turno habitual.

import type { EscalationStore } from "../../ports/escalation.js"
import type { Logger } from "../../ports/logger.js"
import type { ConversationResumer } from "../../ports/proactive.js"
import type { TelegramClient } from "./client.js"
import type { NormalizeResult } from "./normalize.js"

type Turn = Extract<NormalizeResult, { kind: "turn" }>

const NOTIFY_CHANNEL = "telegram"

/** Invierte conversationKeyFor: "chatId" | "chatId:threadId" → {chatId, threadId?}. null si no es parseable
 *  (p.ej. una conversationKey de WEB, que es un uuid) → ese origen no tiene push (cierra vía fact). */
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

/** Confirmación + invitación a curar que Vaio le manda a Kevin tras procesar su respuesta (en español, su idioma). */
function ownerConfirmation(pushed: boolean): string {
  return pushed
    ? "✅ Listo, se lo transmití al visitante. Si querés que recuerde algo de esto como dato tuyo, decímelo y lo guardo."
    : "✅ Anotado (el visitante no está en línea ahora). Si querés que lo recuerde como dato tuyo para la próxima, decímelo y lo guardo."
}

/** Intenta tratar `norm` como la respuesta del owner a una escalada. Devuelve true si la CONSUMIÓ (no es un turno
 *  nuevo). Awaitea solo la correlación + markAnswered (rápido); el retomo y la confirmación van fire-and-forget. */
export async function tryHandleEscalationReply(
  deps: {
    escalations: EscalationStore
    resumer: ConversationResumer
    client: TelegramClient
    logger: Logger
  },
  norm: Turn
): Promise<boolean> {
  if (norm.replyToMessageId === undefined) return false
  const esc = await deps.escalations.findByNotifyMessage(
    NOTIFY_CHANNEL,
    String(norm.replyToMessageId)
  )
  if (!esc) return false // reply a otra cosa → turno normal de Kevin

  // Transición idempotente (UPDATE condicional): un retry de webhook que ya se procesó → answered=false → consumir
  // sin re-actuar (no doble retomo / doble confirmación).
  const answered = await deps.escalations.markAnswered(esc.id, norm.text)
  if (!answered) {
    deps.logger.info(
      { escId: esc.id },
      "tg: reply de escalada ya procesado (idempotente)"
    )
    return true
  }

  deps.logger.info(
    { escId: esc.id, originChannel: esc.origin.channel },
    "tg: escalada respondida por el owner"
  )

  // Retomar al visitante si su canal tiene push (Telegram). Web → no-op (cierra vía fact si Kevin lo cura).
  let pushed = false
  if (esc.origin.channel === "telegram" && esc.origin.threadKey) {
    const routing = parseTelegramKey(esc.origin.threadKey)
    if (routing) {
      pushed = true
      deps.resumer.resumeConversation({
        conversationKey: esc.origin.threadKey,
        channel: "telegram",
        locale: esc.origin.locale,
        originalQuestion: esc.question,
        injectedAnswer: norm.text,
        routing,
      })
    }
  }

  // Confirmar a Kevin + invitarlo a curar (fire-and-forget; no bloquea el ACK del webhook).
  const send =
    norm.threadId !== undefined ? { messageThreadId: norm.threadId } : {}
  void deps.client
    .sendMessage(norm.chatId, ownerConfirmation(pushed), send)
    .catch(() => {})

  return true
}
