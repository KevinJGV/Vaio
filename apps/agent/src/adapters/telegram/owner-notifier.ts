// Adapter Telegram del puerto OwnerNotifier: empuja un aviso proactivo al DM del owner (Kevin) y devuelve el
// message_id como ancla del reply-to. Singleton de proceso (no per-turn). best-effort: NUNCA tira (Inv #1); sin
// owner / si el envío falla → { delivered:false }. El TEXTO ya viene listo del llamador (la action lo sanea +
// delimita); acá solo se entrega. Un adapter WhatsApp/correo futuro implementa el mismo puerto sin tocar consumidores.

import type { Logger } from "../../ports/logger.js"
import type { OwnerNotifier } from "../../ports/owner-notifier.js"
import type { TelegramClient } from "./client.js"

export function createTelegramOwnerNotifier(deps: {
  client: TelegramClient
  ownerChatId: number
  logger: Logger
}): OwnerNotifier {
  return {
    async notify({ kind, text }) {
      try {
        // DM directo al owner (sin thread). El message_id del 1er mensaje = ancla para correlacionar su reply.
        const messageId = await deps.client.sendMessage(deps.ownerChatId, text)
        if (messageId === undefined) {
          deps.logger.warn({ kind }, "owner-notify: envío sin message_id")
          return { delivered: false, channel: "telegram" }
        }
        deps.logger.info({ kind, messageId }, "owner-notify: entregado")
        return {
          delivered: true,
          channel: "telegram",
          ref: String(messageId),
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
