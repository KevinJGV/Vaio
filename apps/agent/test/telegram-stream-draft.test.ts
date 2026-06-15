import { describe, expect, it } from "vitest"
import { pumpStream } from "../src/adapters/telegram/stream-draft.js"

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch))
      c.close()
    },
  })
}

describe("pumpStream", () => {
  it("acumula y devuelve el texto final completo", async () => {
    const out = await pumpStream(streamOf(["Hola", " ", "mundo"]), () => {}, {
      now: () => 0,
    })
    expect(out).toBe("Hola mundo")
  })

  it("throttle: con reloj constante, solo el 1er parcial + el final", async () => {
    const calls: string[] = []
    const out = await pumpStream(
      streamOf(["a", "b", "c", "d"]),
      (p) => {
        calls.push(p)
      },
      { now: () => 1000 } // tiempo constante → todo lo intermedio cae en la ventana
    )
    expect(out).toBe("abcd")
    expect(calls).toEqual(["a", "abcd"]) // 1er chunk + parcial final
  })

  it("onUpdate que tira NO corta el pump (best-effort)", async () => {
    const out = await pumpStream(
      streamOf(["x", "y"]),
      () => {
        throw new Error("boom")
      },
      { now: () => 0 }
    )
    expect(out).toBe("xy")
  })

  it("siempre emite el parcial final aunque no haya chunks intermedios", async () => {
    const calls: string[] = []
    await pumpStream(streamOf(["único"]), (p) => calls.push(p), {
      now: () => 0,
    })
    expect(calls.at(-1)).toBe("único")
  })
})
