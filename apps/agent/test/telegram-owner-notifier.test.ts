import { describe, expect, it } from "vitest"
import type { TelegramClient } from "../src/adapters/telegram/client.js"
import { createTelegramOwnerNotifier } from "../src/adapters/telegram/owner-notifier.js"
import type { LogFields, Logger } from "../src/ports/logger.js"

function noopLogger(): Logger {
  const noop = (_a: LogFields | string, _b?: string): void => {}
  const l: Logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => l,
  }
  return l
}

/** Fake client: sendMessage devuelve un message_id fijo (o undefined para simular fallo). */
function fakeClient(
  messageId: number | undefined,
  sent: { chatId: number; text: string }[]
): TelegramClient {
  return {
    sendMessage: async (chatId: number, text: string) => {
      sent.push({ chatId, text })
      return messageId
    },
  } as unknown as TelegramClient
}

describe("createTelegramOwnerNotifier", () => {
  it("entrega al DM del owner y devuelve el message_id como ancla (ref)", async () => {
    const sent: { chatId: number; text: string }[] = []
    const notifier = createTelegramOwnerNotifier({
      client: fakeClient(99, sent),
      ownerChatId: 555,
      logger: noopLogger(),
    })
    const res = await notifier.notify({ kind: "escalation", text: "duda X" })
    expect(res.delivered).toBe(true)
    expect(res.channel).toBe("telegram")
    expect(res.ref).toBe("99")
    expect(res.channelChatId).toBe("555")
    expect(sent).toEqual([{ chatId: 555, text: "duda X" }])
  })

  it("sin message_id (envío falló) → { delivered:false } (degradación, Inv #1)", async () => {
    const notifier = createTelegramOwnerNotifier({
      client: fakeClient(undefined, []),
      ownerChatId: 555,
      logger: noopLogger(),
    })
    const res = await notifier.notify({ kind: "system", text: "x" })
    expect(res.delivered).toBe(false)
    expect(res.ref).toBeUndefined()
  })

  it("si el client tira, degrada a { delivered:false } sin propagar (Inv #1)", async () => {
    const throwing = {
      sendMessage: async () => {
        throw new Error("network down")
      },
    } as unknown as TelegramClient
    const notifier = createTelegramOwnerNotifier({
      client: throwing,
      ownerChatId: 1,
      logger: noopLogger(),
    })
    await expect(
      notifier.notify({ kind: "escalation", text: "x" })
    ).resolves.toEqual({ delivered: false, channel: "telegram" })
  })
})
