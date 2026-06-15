import { describe, expect, it } from "vitest"
import { formatNow } from "../src/core/time.js"

const d = new Date("2026-06-14T20:00:00Z") // 15:00 en America/Bogota (UTC-5)

describe("formatNow", () => {
  it("formatea en español con la TZ de Kevin (Bogota)", () => {
    const s = formatNow(d, "America/Bogota", "es")
    expect(s).toMatch(/2026/)
    expect(s.toLowerCase()).toContain("junio")
    expect(s).toMatch(/14/)
  })

  it("formatea en inglés", () => {
    const s = formatNow(d, "America/Bogota", "en")
    expect(s.toLowerCase()).toContain("june")
    expect(s).toMatch(/2026/)
  })

  it("la TZ cambia la hora (Bogota vs Tokyo dan strings distintos)", () => {
    expect(formatNow(d, "America/Bogota", "es")).not.toBe(
      formatNow(d, "Asia/Tokyo", "es")
    )
  })

  it("TZ inválida → fallback ISO, no tira", () => {
    expect(formatNow(d, "Not/AZone", "es")).toBe(d.toISOString())
  })
})
