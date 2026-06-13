import { afterEach, describe, expect, it } from "vitest"
import { createTelegramClient } from "../src/adapters/telegram/client.js"
import { createTelegramMedia } from "../src/adapters/telegram/media.js"
import type { LogFields, Logger } from "../src/ports/logger.js"

const TOKEN = "SECRET-BOT-TOKEN-123"

/** Logger que captura todo lo logueado (para verificar que el token NUNCA aparece). */
function capturingLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = []
  const rec = (a: LogFields | string, b?: string) => {
    lines.push(JSON.stringify(a) + (b ? ` ${b}` : ""))
  }
  const logger: Logger = {
    trace: rec,
    debug: rec,
    info: rec,
    warn: rec,
    error: rec,
    child: () => logger,
  }
  return { logger, lines }
}

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

describe("createTelegramMedia.download", () => {
  it("hace getFile + descarga y devuelve los bytes (token nunca logueado)", async () => {
    const urls: string[] = []
    globalThis.fetch = (async (url: string) => {
      urls.push(String(url))
      if (String(url).includes("/getFile")) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: { file_path: "voice/file_1.ogg", file_size: 100 },
          }),
          { status: 200 }
        )
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    }) as typeof fetch

    const { logger, lines } = capturingLogger()
    const media = createTelegramMedia(TOKEN, logger, 20_000_000)
    const out = await media.download({
      kind: "audio",
      fileId: "v1",
      mediaType: "audio/ogg",
    })

    expect(out).not.toBeNull()
    expect(out?.kind).toBe("audio")
    expect(out?.ref).toBe("v1")
    expect(out?.data).toBeInstanceOf(Uint8Array)
    expect(urls).toHaveLength(2)
    expect(urls[1]).toContain("voice/file_1.ogg")
    // El token NO debe aparecer en ningún log (las URLs lo contienen).
    expect(lines.join("\n")).not.toContain(TOKEN)
  })

  it("getFile sin file_path → null", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, result: {} }), {
        status: 200,
      })) as typeof fetch
    const { logger } = capturingLogger()
    const media = createTelegramMedia(TOKEN, logger, 20_000_000)
    const out = await media.download({
      kind: "image",
      fileId: "p1",
      mediaType: "image/jpeg",
    })
    expect(out).toBeNull()
  })

  it("archivo más grande que el límite → null (no descarga)", async () => {
    let downloadCalled = false
    globalThis.fetch = (async (url: string) => {
      if (String(url).includes("/getFile")) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: { file_path: "x", file_size: 99_999 },
          }),
          { status: 200 }
        )
      }
      downloadCalled = true
      return new Response(new Uint8Array([1]), { status: 200 })
    }) as typeof fetch
    const { logger } = capturingLogger()
    const media = createTelegramMedia(TOKEN, logger, 1000)
    const out = await media.download({
      kind: "image",
      fileId: "p1",
      mediaType: "image/jpeg",
    })
    expect(out).toBeNull()
    expect(downloadCalled).toBe(false)
  })

  it("getFile no-2xx (token inválido) → null", async () => {
    globalThis.fetch = (async () =>
      new Response("Unauthorized", { status: 401 })) as typeof fetch
    const { logger } = capturingLogger()
    const media = createTelegramMedia(TOKEN, logger, 20_000_000)
    const out = await media.download({
      kind: "audio",
      fileId: "v1",
      mediaType: "audio/ogg",
    })
    expect(out).toBeNull()
  })
})

describe("createTelegramClient.sendAudio", () => {
  it("postea multipart a sendAudio y devuelve ok (token no en logs)", async () => {
    const seen: { url: string; isForm: boolean } = { url: "", isForm: false }
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seen.url = String(url)
      seen.isForm = init?.body instanceof FormData
      return new Response("{}", { status: 200 })
    }) as typeof fetch
    const { logger, lines } = capturingLogger()
    const ok = await createTelegramClient(TOKEN, logger).sendAudio(
      123,
      new Uint8Array([1, 2, 3]),
      { mediaType: "audio/mpeg" }
    )
    expect(ok).toBe(true)
    expect(seen.url).toContain("/sendAudio")
    expect(seen.isForm).toBe(true)
    expect(lines.join("\n")).not.toContain(TOKEN)
  })

  it("no-2xx → false (el caller cae a texto)", async () => {
    globalThis.fetch = (async () =>
      new Response("bad", { status: 400 })) as typeof fetch
    const { logger } = capturingLogger()
    const ok = await createTelegramClient(TOKEN, logger).sendAudio(
      123,
      new Uint8Array([1]),
      {}
    )
    expect(ok).toBe(false)
  })
})
