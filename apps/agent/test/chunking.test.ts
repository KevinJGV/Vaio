import { describe, expect, it } from "vitest"
import { chunkText, htmlToText } from "../src/core/chunking.js"

describe("htmlToText", () => {
  it("quita tags, script/style y colapsa espacios", () => {
    const html =
      "<html><head><style>.a{}</style><script>1</script></head><body><h1>Hola</h1>  <p>mundo</p></body></html>"
    expect(htmlToText(html)).toBe("Hola mundo")
  })

  it("decodifica entidades básicas", () => {
    expect(htmlToText("<p>Tom &amp; Jerry &lt;3 &quot;x&quot;</p>")).toBe(
      'Tom & Jerry <3 "x"'
    )
  })
})

describe("chunkText", () => {
  it("devuelve un solo chunk si el texto cabe en size", () => {
    expect(chunkText("corto", 900)).toEqual(["corto"])
  })

  it("devuelve vacío para texto vacío", () => {
    expect(chunkText("   ", 900)).toEqual([])
  })

  it("trocea texto largo con solape y sin chunks vacíos", () => {
    const text = "palabra ".repeat(500).trim() // ~4000 chars
    const chunks = chunkText(text, 900, 150)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(c.length).toBeGreaterThan(0)
      expect(c.length).toBeLessThanOrEqual(900)
    }
  })

  it("el solape hace que se cubra todo el contenido", () => {
    const text = Array.from({ length: 300 }, (_, i) => `w${i}`).join(" ")
    const chunks = chunkText(text, 200, 40)
    expect(chunks.join(" ")).toContain("w0")
    expect(chunks.join(" ")).toContain("w299")
  })
})
