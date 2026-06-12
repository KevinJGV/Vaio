import { describe, expect, it } from "vitest"
import { compress } from "../src/index.js"

describe("compresión en español (extensión @vaio)", () => {
  it("quita fillers/artículos ES (full) y reduce tokens", () => {
    const src =
      "Bueno, o sea, el diseño de la aplicación es importante para el proyecto"
    const out = compress(src, { intensity: "full" })
    expect(out.length).toBeLessThan(src.length)
    expect(out).not.toMatch(/\bo sea\b/i)
    expect(out).toContain("diseño") // fuera del léxico → se conserva con ñ
  })

  it("preserva técnicos byte-a-byte en contexto ES", () => {
    const src =
      "revisá el archivo /etc/hosts y la url https://vindevsito.dev/api"
    const out = compress(src, { intensity: "full" })
    expect(out).toContain("/etc/hosts")
    expect(out).toContain("https://vindevsito.dev/api")
  })

  it("abrevia términos ES (también→tmb, configuración→config)", () => {
    const out = compress("también revisá la configuración del repo", {
      intensity: "full",
    })
    expect(out).toContain("tmb")
    expect(out).toContain("config")
  })

  it("no rompe acentos/ñ de palabras fuera del léxico", () => {
    const out = compress("el diseño y la programación en español", {
      intensity: "full",
    })
    expect(out).toContain("diseño")
    expect(out).toContain("programación")
    expect(out).toContain("español")
  })
})
