import { describe, expect, it, vi } from "vitest"
import { buildUserContent } from "../src/core/modality.js"
import type {
  MediaUnderstanding,
  ResolvedMedia,
  Transcriber,
} from "../src/ports/media.js"

const bytes = (s: string) => new TextEncoder().encode(s)

function media(over: Partial<ResolvedMedia> = {}): ResolvedMedia {
  return {
    kind: "image",
    mediaType: "image/jpeg",
    ref: "file-1",
    data: bytes("xxx"),
    ...over,
  }
}

const okTranscriber: Transcriber = {
  transcribe: async () => "hola desde el audio",
}
const okUnderstanding: MediaUnderstanding = {
  describe: async () => "una foto de un gato",
}

describe("buildUserContent (núcleo puro multimodal)", () => {
  it("sin adjuntos → content es el string original (camino actual intacto)", async () => {
    const out = await buildUserContent({
      userText: "qué tal",
      media: [],
      transcriber: okTranscriber,
      understanding: okUnderstanding,
      nativeImages: false,
      locale: "es",
    })
    expect(out.content).toBe("qué tal")
    expect(out.derivedText).toBe("qué tal")
  })

  it("audio → siempre transcribe a texto; content sigue siendo string", async () => {
    const out = await buildUserContent({
      userText: "",
      media: [media({ kind: "audio", mediaType: "audio/ogg", ref: "v1" })],
      transcriber: okTranscriber,
      understanding: okUnderstanding,
      nativeImages: false,
      locale: "es",
    })
    expect(typeof out.content).toBe("string")
    expect(out.content).toContain("hola desde el audio")
    expect(out.derivedText).toContain("[voz]")
    expect(out.derivedText).toContain("hola desde el audio")
  })

  it("imagen + nativeImages=false → describe a texto", async () => {
    const out = await buildUserContent({
      userText: "mirá esto",
      media: [media()],
      transcriber: okTranscriber,
      understanding: okUnderstanding,
      nativeImages: false,
      locale: "es",
    })
    expect(typeof out.content).toBe("string")
    expect(out.content).toContain("mirá esto")
    expect(out.content).toContain("una foto de un gato")
    expect(out.derivedText).toContain("[imagen]")
  })

  it("imagen + nativeImages=true → file part nativo + texto", async () => {
    const describe = vi.fn()
    const out = await buildUserContent({
      userText: "describí",
      media: [media({ caption: "mi gato" })],
      transcriber: okTranscriber,
      understanding: { describe },
      nativeImages: true,
      locale: "es",
    })
    expect(describe).not.toHaveBeenCalled() // no describe cuando va nativo
    expect(Array.isArray(out.content)).toBe(true)
    const parts = out.content as Array<Record<string, unknown>>
    expect(parts.some((p) => p.type === "text")).toBe(true)
    const file = parts.find((p) => p.type === "file")
    expect(file).toBeDefined()
    expect(file?.mediaType).toBe("image/jpeg")
    expect(file?.data).toBeInstanceOf(Uint8Array)
  })

  it("degrada si el transcriber lanza (marcador + sigue, nunca rompe)", async () => {
    const out = await buildUserContent({
      userText: "",
      media: [media({ kind: "audio", mediaType: "audio/ogg", ref: "v1" })],
      transcriber: {
        transcribe: async () => Promise.reject(new Error("boom")),
      },
      understanding: okUnderstanding,
      nativeImages: false,
      locale: "es",
    })
    expect(typeof out.content).toBe("string")
    expect(out.derivedText).toContain("no procesable")
  })

  it("degrada si el puerto es null", async () => {
    const out = await buildUserContent({
      userText: "qué ves",
      media: [media()],
      transcriber: null,
      understanding: null,
      nativeImages: false,
      locale: "es",
    })
    expect(out.content).toContain("qué ves")
    expect(out.derivedText).toContain("no procesable")
  })

  it("mezcla audio + imagen normalizada → todo en un string ordenado", async () => {
    const out = await buildUserContent({
      userText: "contexto",
      media: [
        media({ kind: "audio", mediaType: "audio/ogg", ref: "a" }),
        media({ kind: "image", mediaType: "image/png", ref: "b" }),
      ],
      transcriber: okTranscriber,
      understanding: okUnderstanding,
      nativeImages: false,
      locale: "es",
    })
    expect(typeof out.content).toBe("string")
    expect(out.content).toContain("contexto")
    expect(out.content).toContain("hola desde el audio")
    expect(out.content).toContain("una foto de un gato")
  })

  it("inglés → marcadores localizados", async () => {
    const out = await buildUserContent({
      userText: "",
      media: [media({ kind: "audio", mediaType: "audio/ogg", ref: "v1" })],
      transcriber: okTranscriber,
      understanding: okUnderstanding,
      nativeImages: false,
      locale: "en",
    })
    expect(out.derivedText).toContain("[voice]")
  })

  it("reporta degraded cuando el transcriber lanza, y cae al marcador", async () => {
    const reports: { component: string; detail?: string }[] = []
    const failing: Transcriber = {
      transcribe: async () => {
        throw new Error("transcriptions 400")
      },
    }
    const out = await buildUserContent({
      userText: "",
      media: [media({ kind: "audio", mediaType: "audio/ogg", ref: "v1" })],
      transcriber: failing,
      understanding: null,
      nativeImages: false,
      locale: "es",
      onDegrade: (d) => reports.push(d),
    })
    expect(out.derivedText).toContain("[audio no procesable]")
    expect(reports[0]).toMatchObject({ component: "transcribe" })
    expect(reports[0]?.detail).toContain("400")
  })

  it("NO reporta degraded si el puerto es null (off por config)", async () => {
    const reports: unknown[] = []
    await buildUserContent({
      userText: "",
      media: [media({ kind: "audio", mediaType: "audio/ogg", ref: "v1" })],
      transcriber: null,
      understanding: null,
      nativeImages: false,
      locale: "es",
      onDegrade: () => reports.push(1),
    })
    expect(reports).toHaveLength(0)
  })
})
