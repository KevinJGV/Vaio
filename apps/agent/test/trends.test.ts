import { describe, expect, it } from "vitest"
import {
  buildTrendPrompt,
  deterministicTrend,
  hashContent,
  normalizeForHash,
} from "../src/core/trends.js"
import type { ConnectorSnapshot } from "../src/ports/snapshot-store.js"

const snap = (
  content: string,
  capturedAt: Date,
  source = "steam"
): ConnectorSnapshot => ({ source, content, capturedAt })

describe("normalizeForHash + hashContent", () => {
  it("diff cosmético (espacios/saltos) → mismo hash", () => {
    expect(normalizeForHash("  a   b\n c ")).toBe("a b c")
    expect(hashContent("a b c")).toBe(hashContent("  a   b\n c "))
  })
  it("cambio real → hash distinto", () => {
    expect(hashContent("a b c")).not.toBe(hashContent("a b d"))
  })
})

describe("deterministicTrend", () => {
  const now = new Date("2026-06-15T00:00:00Z")
  it("detecta ítems que aparecen y desaparecen + el lapso en días", () => {
    const recent = [
      snap(
        "Juegos: Terraria (247h), Hades II (20h)",
        new Date("2026-06-14T00:00:00Z")
      ),
      snap(
        "Juegos: Terraria (247h), CS2 (60h)",
        new Date("2026-06-04T00:00:00Z")
      ),
    ]
    const out = deterministicTrend(recent, now)
    expect(out).toMatch(/Hades II/) // apareció
    expect(out).toMatch(/CS2/) // ya no figura
    expect(out).toMatch(/10 días/) // lapso vs la captura previa
  })
  it("capturas iguales → 'se mantiene estable'", () => {
    const recent = [
      snap("Juegos: Terraria (247h)", new Date("2026-06-14T00:00:00Z")),
      snap("Juegos: Terraria (247h)", new Date("2026-06-10T00:00:00Z")),
    ]
    expect(deterministicTrend(recent, now)).toMatch(/estable/i)
  })
  it("<2 snapshots → '' (sin con qué comparar)", () => {
    expect(deterministicTrend([snap("x", now)], now)).toBe("")
    expect(deterministicTrend([], now)).toBe("")
  })
})

describe("buildTrendPrompt", () => {
  const snapshots = [
    snap("Juegos: Terraria, Hades II", new Date("2026-06-14T00:00:00Z")),
    snap("Juegos: Terraria, CS2", new Date("2026-06-04T00:00:00Z")),
  ]
  const now = new Date("2026-06-15T00:00:00Z")
  it("ES: system con grounding duro + prompt con fechas y orden reciente→antiguo", () => {
    const { system, prompt } = buildTrendPrompt({
      source: "steam",
      snapshots,
      locale: "es",
      now,
    })
    expect(system).toMatch(/SOLO/)
    expect(system).toMatch(/NUNCA inventes/i)
    expect(prompt).toMatch(/2026-06-14/) // fecha de la captura
    expect(prompt).toMatch(/Hades II/)
    // orden: la más reciente (Hades II) antes que la vieja (CS2)
    expect(prompt.indexOf("Hades II")).toBeLessThan(prompt.indexOf("CS2"))
  })
  it("EN: produce inglés", () => {
    const { system } = buildTrendPrompt({
      source: "steam",
      snapshots,
      locale: "en",
      now,
    })
    expect(system).toMatch(/ONLY/)
    expect(system).toMatch(/NEVER/i)
  })
})
