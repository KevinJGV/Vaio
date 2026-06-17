import { describe, expect, it } from "vitest"
import type { TelegramClient } from "../src/adapters/telegram/client.js"
import {
  createTelegramOwnerNotifier,
  frameOwnerNotification,
} from "../src/adapters/telegram/owner-notifier.js"
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

/** Fake client: sendMessage devuelve un message_id fijo (o undefined para simular fallo); createForumTopic
 *  devuelve `topicId` (undefined = creación falló → DM plano). `sent` captura el thread del envío. */
function fakeClient(
  messageId: number | undefined,
  sent: { chatId: number; text: string; threadId?: number }[],
  topicId?: number
): TelegramClient {
  return {
    createForumTopic: async (_chatId: number, _name: string) => topicId,
    sendMessage: async (
      chatId: number,
      text: string,
      opts?: { messageThreadId?: number }
    ) => {
      sent.push({ chatId, text, threadId: opts?.messageThreadId })
      return messageId
    },
  } as unknown as TelegramClient
}

describe("createTelegramOwnerNotifier", () => {
  it("crea un HILO y postea dentro; devuelve message_id (ref) + topic_id (topicId)", async () => {
    const sent: { chatId: number; text: string; threadId?: number }[] = []
    const notifier = createTelegramOwnerNotifier({
      client: fakeClient(99, sent, 42),
      ownerChatId: 555,
      logger: noopLogger(),
    })
    const res = await notifier.notify({
      kind: "escalation",
      text: "duda X",
      title: "¿Le gusta la pasta?",
    })
    expect(res.delivered).toBe(true)
    expect(res.channel).toBe("telegram")
    expect(res.ref).toBe("99")
    expect(res.topicId).toBe("42")
    expect(res.channelChatId).toBe("555")
    // se entrega ENMARCADO + DENTRO del hilo (messageThreadId)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.chatId).toBe(555)
    expect(sent[0]?.threadId).toBe(42)
    expect(sent[0]?.text).toContain("🔔 PENDIENTE · Consulta de un visitante")
    expect(sent[0]?.text).toContain("duda X")
  })

  it("si createForumTopic falla (undefined) → DM plano (sin thread), sigue entregando (Inv #1)", async () => {
    const sent: { chatId: number; text: string; threadId?: number }[] = []
    const notifier = createTelegramOwnerNotifier({
      client: fakeClient(99, sent, undefined),
      ownerChatId: 555,
      logger: noopLogger(),
    })
    const res = await notifier.notify({ kind: "escalation", text: "duda X" })
    expect(res.delivered).toBe(true)
    expect(res.topicId).toBeUndefined()
    expect(sent[0]?.threadId).toBeUndefined()
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

  it("frameOwnerNotification: encabezado por kind + cuerpo, distinguible del chat normal", () => {
    const out = frameOwnerNotification("escalation", "el cuerpo")
    expect(
      out.startsWith("<b>🔔 PENDIENTE · Consulta de un visitante</b>")
    ).toBe(true)
    expect(out).toContain("el cuerpo")
    // otro kind → otro título (mismo patrón visual)
    expect(frameOwnerNotification("routine-result", "x")).toContain(
      "Resultado de rutina"
    )
  })

  it("frameOwnerNotification: ESCAPA el cuerpo (input no confiable no inyecta tags ni rompe el parse)", () => {
    const out = frameOwnerNotification(
      "escalation",
      'pregunta <b>mala</b> & "x"'
    )
    expect(out).toContain("pregunta &lt;b&gt;mala&lt;/b&gt; &amp;")
    // el encabezado SÍ conserva su HTML real (es marco controlado, no input)
    expect(out).toContain("<b>🔔 PENDIENTE")
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
