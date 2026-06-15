import { describe, expect, it } from "vitest"
import {
  aggregateLanguages,
  currentStreak,
  longestStreak,
  topByPercent,
  topByPlaytime,
} from "../src/core/connector-stats.js"

describe("currentStreak", () => {
  it("cuenta días consecutivos con contribuciones hasta hoy", () => {
    const days = [
      { contributionCount: 1, date: "2026-06-12" },
      { contributionCount: 2, date: "2026-06-13" },
      { contributionCount: 1, date: "2026-06-14" },
    ]
    expect(currentStreak(days, "2026-06-14")).toBe(3)
  })
  it("hoy en 0 pero ayer >0 → la racha sigue viva (no rompe por el día en curso)", () => {
    const days = [
      { contributionCount: 1, date: "2026-06-12" },
      { contributionCount: 2, date: "2026-06-13" },
      { contributionCount: 0, date: "2026-06-14" },
    ]
    expect(currentStreak(days, "2026-06-14")).toBe(2)
  })
  it("ayer en 0 → sin racha", () => {
    const days = [
      { contributionCount: 5, date: "2026-06-12" },
      { contributionCount: 0, date: "2026-06-13" },
      { contributionCount: 0, date: "2026-06-14" },
    ]
    expect(currentStreak(days, "2026-06-14")).toBe(0)
  })
})

describe("longestStreak", () => {
  it("máxima corrida de días con contribuciones", () => {
    const days = [
      { contributionCount: 1, date: "2026-06-10" },
      { contributionCount: 1, date: "2026-06-11" },
      { contributionCount: 0, date: "2026-06-12" },
      { contributionCount: 1, date: "2026-06-13" },
      { contributionCount: 1, date: "2026-06-14" },
    ]
    expect(longestStreak(days)).toBe(2)
  })
})

describe("aggregateLanguages", () => {
  it("suma bytes por lenguaje, ordena desc, calcula % y recorta a top-5", () => {
    const nodes = [
      { languages: { edges: [{ size: 100, node: { name: "TypeScript" } }] } },
      {
        languages: {
          edges: [
            { size: 100, node: { name: "TypeScript" } },
            { size: 50, node: { name: "Java" } },
          ],
        },
      },
    ]
    const out = aggregateLanguages(nodes)
    expect(out[0]).toEqual({ name: "TypeScript", percent: 80 })
    expect(out[1]).toEqual({ name: "Java", percent: 20 })
  })
  it("sin bytes → []", () => {
    expect(aggregateLanguages([{ languages: { edges: [] } }])).toEqual([])
  })
})

describe("topByPercent", () => {
  it("top-n por percent, formato 'Nombre (X%)'", () => {
    const items = [
      { name: "TypeScript", percent: 52.4 },
      { name: "Python", percent: 19.1 },
      { name: "Go", percent: 5 },
    ]
    expect(topByPercent(items, 2)).toBe("TypeScript (52%), Python (19%)")
  })
})

describe("topByPlaytime", () => {
  it("top-n por minutos jugados, formato 'Nombre (Xh)'", () => {
    const games = [
      { name: "Dota 2", playtime_forever: 12000 },
      { name: "CS2", playtime_forever: 6000 },
    ]
    expect(topByPlaytime(games, 2)).toBe("Dota 2 (200h), CS2 (100h)")
  })
})
