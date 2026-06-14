import { describe, expect, it } from "vitest"
import { chunkCode, withProvenanceHeader } from "../src/core/code-chunking.js"

describe("chunkCode", () => {
  it("devuelve vacío para texto vacío", () => {
    expect(chunkCode("")).toEqual([])
  })

  it("devuelve un solo chunk para una sola línea", () => {
    expect(chunkCode("const x = 1")).toEqual(["const x = 1"])
  })

  it("nunca parte una línea a la mitad (cada chunk son líneas completas del original)", () => {
    const lines = Array.from(
      { length: 200 },
      (_, i) => `const linea_${i} = ${i}`
    )
    const original = lines.join("\n")
    const chunks = chunkCode(original, { maxChars: 200, overlapLines: 4 })
    const originalSet = new Set(lines)
    for (const c of chunks) {
      for (const l of c.split("\n")) {
        expect(originalSet.has(l)).toBe(true)
      }
    }
  })

  it("respeta maxChars salvo cuando una sola línea ya lo excede", () => {
    const lines = Array.from(
      { length: 100 },
      (_, i) => `linea corta numero ${i}`
    )
    const original = lines.join("\n")
    const maxChars = 150
    const chunks = chunkCode(original, { maxChars, overlapLines: 3 })
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      // ningún chunk excede maxChars (todas las líneas son cortas)
      expect(c.length).toBeLessThanOrEqual(maxChars)
    }
  })

  it("una línea más larga que maxChars va sola en su propio chunk", () => {
    const lineaGigante = "x".repeat(500)
    const original = ["antes", lineaGigante, "despues"].join("\n")
    const chunks = chunkCode(original, { maxChars: 100, overlapLines: 2 })
    expect(chunks).toContain(lineaGigante)
    // y ese chunk es exactamente la línea sola
    const soloGigante = chunks.find((c) => c.includes(lineaGigante))
    expect(soloGigante).toBe(lineaGigante)
  })

  it("hay overlap visible entre chunks consecutivos (una línea del borde se repite)", () => {
    const lines = Array.from(
      { length: 100 },
      (_, i) => `fila_${i} = valor_${i}`
    )
    const original = lines.join("\n")
    const chunks = chunkCode(original, { maxChars: 120, overlapLines: 3 })
    expect(chunks.length).toBeGreaterThan(1)
    for (let i = 0; i < chunks.length - 1; i++) {
      const curr = new Set((chunks[i] as string).split("\n"))
      const next = (chunks[i + 1] as string).split("\n")
      const compartidas = next.filter((l) => curr.has(l))
      expect(compartidas.length).toBeGreaterThan(0)
    }
  })

  it("no entra en loop infinito si overlapLines es enorme", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `l${i}`)
    const original = lines.join("\n")
    const chunks = chunkCode(original, { maxChars: 20, overlapLines: 999 })
    // siempre progresa → cantidad finita y razonable
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.length).toBeLessThan(1000)
  })
})

describe("withProvenanceHeader", () => {
  const ctx = {
    repo: "vaio",
    path: "apps/agent/src/core/agent.ts",
    lang: "typescript",
  }

  it("código → header con // que contiene repo, path y lang; cuerpo intacto debajo", () => {
    const chunk = "const x = 1\nconst y = 2"
    const [out] = withProvenanceHeader([chunk], ctx)
    const [header, ...body] = (out as string).split("\n")
    expect(header).toMatch(/^\/\//)
    expect(header).toContain("vaio")
    expect(header).toContain("apps/agent/src/core/agent.ts")
    expect(header).toContain("typescript")
    expect(body.join("\n")).toBe(chunk)
  })

  it("markdown → header HTML <!-- --> que contiene repo, path y lang", () => {
    const mdCtx = { repo: "vaio", path: "docs/SPEC.md", lang: "markdown" }
    const chunk = "# Título\ntexto"
    const [out] = withProvenanceHeader([chunk], mdCtx)
    const [header, ...body] = (out as string).split("\n")
    expect(header.startsWith("<!--")).toBe(true)
    expect(header.endsWith("-->")).toBe(true)
    expect(header).toContain("vaio")
    expect(header).toContain("docs/SPEC.md")
    expect(header).toContain("markdown")
    expect(body.join("\n")).toBe(chunk)
  })

  it("antepone header a cada chunk de la lista", () => {
    const out = withProvenanceHeader(["a", "b"], ctx)
    expect(out).toHaveLength(2)
    for (const o of out) {
      expect(o.split("\n").length).toBeGreaterThanOrEqual(2)
    }
  })
})
