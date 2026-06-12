import { describe, expect, it } from "vitest"
import { createCompressor } from "../src/adapters/compress.js"
import { compressOrRaw } from "../src/core/util.js"

const c = createCompressor()

describe("createCompressor (adapter @vaio/compress)", () => {
  it("comprime prosa (determinístico) reduciendo tokens", () => {
    const src =
      "The authentication middleware is basically really important and it should be noted that we probably want to add a refresh path."
    const out = c.compress(src, "full")
    expect(out.length).toBeLessThan(src.length)
    expect(c.compress(src, "full")).toBe(out) // determinístico
  })

  it("preserva tokens técnicos byte-a-byte (paths/urls/identificadores)", () => {
    const src = "see /etc/hosts and https://x.dev/api and call doSomethingNow()"
    const out = c.compress(src, "ultra")
    expect(out).toContain("/etc/hosts")
    expect(out).toContain("https://x.dev/api")
    expect(out).toContain("doSomethingNow")
  })

  it("countTokens devuelve un estimado estable y >0", () => {
    expect(c.countTokens("hola mundo")).toBeGreaterThan(0)
    expect(c.countTokens("")).toBe(0)
  })
})

describe("compressOrRaw (degradación)", () => {
  it("sin compresor → texto crudo", () => {
    expect(compressOrRaw(null, "hola the world", "full")).toBe("hola the world")
  })
  it("texto vacío → vacío (no llama al compresor)", () => {
    expect(compressOrRaw(c, "", "full")).toBe("")
  })
  it("con compresor → comprime", () => {
    const src = "this is basically a really long sentence with the filler words"
    expect(compressOrRaw(c, src, "full").length).toBeLessThan(src.length)
  })
})
