// Sentido del AHORA: formatea la fecha/hora actual en la zona horaria de Kevin, localizada. PURO (date+tz+locale
// → string), testeable con valores fijos. El llamador (agent.ts) provee `new Date()` por turno.

import type { Locale } from "@vaio/contracts"

/** Fecha/hora legible en la TZ dada, localizada (ES/EN). TZ inválida → fallback ISO (no rompe el turno). */
export function formatNow(date: Date, tz: string, locale: Locale): string {
  try {
    return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-CO", {
      timeZone: tz,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date)
  } catch {
    return date.toISOString()
  }
}
