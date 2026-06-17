// Adapter Telegram del puerto OwnerNotifier: empuja un aviso proactivo al DM del owner (Kevin) y devuelve el
// message_id como ancla del reply-to. Singleton de proceso (no per-turn). best-effort: NUNCA tira (Inv #1); sin
// owner / si el envío falla → { delivered:false }. El consumidor pasa el cuerpo en texto PLANO; ACÁ se ENMARCA
// (encabezado distinguible por kind) y se ESCAPA el cuerpo (puede traer input no confiable) — el formato HTML es
// telegram-específico, no del core (Inv #4). Un adapter WhatsApp/correo futuro hace su propio marco/escape igual.

import type { Logger } from "../../ports/logger.js"
import type {
  OwnerNotifier,
  OwnerNotifyKind,
} from "../../ports/owner-notifier.js"
import type { TelegramClient } from "./client.js"
import { escapeTelegramHtml } from "./html.js"

/** Marco visual por `kind`: emoji + etiqueta de estado + título representativo. Da a TODA notificación proactiva
 *  un encabezado distinguible del chat normal (lo que pidió Kevin) y un título que dice de qué se trata. Como en
 *  un DM privado el bot NO puede crear hilos/topics ni título de chat (solo en grupos), el "título" es este
 *  encabezado dentro del mensaje. Extensible: cada kind nuevo suma su entrada (Inv #10), sin tocar consumidores. */
const KIND_FRAME: Record<
  OwnerNotifyKind,
  { emoji: string; label: string; title: string }
> = {
  escalation: {
    emoji: "🔔",
    label: "PENDIENTE",
    title: "Consulta de un visitante",
  },
  "routine-result": {
    emoji: "✅",
    label: "RUTINA",
    title: "Resultado de rutina",
  },
  "task-done": { emoji: "✅", label: "LISTO", title: "Tarea completada" },
  webhook: { emoji: "📩", label: "AVISO", title: "Evento entrante" },
  system: { emoji: "⚙️", label: "SISTEMA", title: "Aviso operativo" },
}

const RULE = "━━━━━━━━━━━━━━━━━"

/** Arma el mensaje final para el DM del owner: encabezado HTML (marco por kind) + el cuerpo ESCAPADO. El cuerpo
 *  llega en texto PLANO del consumidor y puede contener input no confiable (la pregunta del visitante) → se escapa
 *  acá, en el borde de salida, para que no inyecte tags ni rompa el parse. Pura/testeable. */
export function frameOwnerNotification(
  kind: OwnerNotifyKind,
  text: string
): string {
  const f = KIND_FRAME[kind]
  return `<b>${f.emoji} ${f.label} · ${f.title}</b>\n${RULE}\n${escapeTelegramHtml(text)}`
}

export function createTelegramOwnerNotifier(deps: {
  client: TelegramClient
  ownerChatId: number
  logger: Logger
}): OwnerNotifier {
  return {
    async notify({ kind, text, title }) {
      try {
        // Threaded Mode: 1 hilo por aviso (título representativo = la pregunta; el "lobby" queda limpio). Si la
        // creación falla → DM plano (sin thread) — degradación (Inv #1). El topic_id ancla la respuesta del owner.
        const topicId = await deps.client.createForumTopic(
          deps.ownerChatId,
          title ?? KIND_FRAME[kind].title
        )
        const messageId = await deps.client.sendMessage(
          deps.ownerChatId,
          frameOwnerNotification(kind, text),
          topicId !== undefined ? { messageThreadId: topicId } : {}
        )
        if (messageId === undefined) {
          deps.logger.warn({ kind }, "owner-notify: envío sin message_id")
          return { delivered: false, channel: "telegram" }
        }
        deps.logger.info(
          { kind, messageId, topicId },
          "owner-notify: entregado"
        )
        return {
          delivered: true,
          channel: "telegram",
          ref: String(messageId),
          ...(topicId !== undefined ? { topicId: String(topicId) } : {}),
          channelChatId: String(deps.ownerChatId),
        }
      } catch (err) {
        deps.logger.warn(
          { kind, err: err instanceof Error ? err.message : String(err) },
          "owner-notify: falló"
        )
        return { delivered: false, channel: "telegram" }
      }
    },
  }
}
