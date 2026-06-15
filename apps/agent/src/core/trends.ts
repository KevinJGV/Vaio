// Lógica PURA de las "trends" de conectores (sin I/O): hash/normalización para el dedup de snapshots, build del
// prompt de derivación de tendencias (grounded), y un delta DETERMINÍSTICO de fallback (cuando el LLM falla; nunca
// inventa). El `now` se inyecta para determinismo en tests (como `currentStreak`).

import { createHash } from "node:crypto"
import type { Locale } from "@vaio/contracts"
import type { ConnectorSnapshot } from "../ports/snapshot-store.js"

/** Normaliza para el hash de dedup: trim + colapsa whitespace (tolera diffs cosméticos). */
export function normalizeForHash(s: string): string {
  return s.trim().replace(/\s+/g, " ")
}

/** sha256 del contenido normalizado → dedup de snapshots consecutivos idénticos. */
export function hashContent(s: string): string {
  return createHash("sha256").update(normalizeForHash(s)).digest("hex")
}

const DAY_MS = 86_400_000

/** Ítems heurísticos de un snapshot: la lista tras ":" separada por comas, sin "(…)"/"N%"/puntuación. Grounded:
 *  solo extrae lo que ESTÁ en el texto (no inventa). */
function extractItems(content: string): Set<string> {
  const i = content.indexOf(":")
  const list = i === -1 ? content : content.slice(i + 1)
  return new Set(
    list
      .split(/[,;]/)
      .map((s) =>
        s
          .replace(/\(.*?\)/g, "")
          .replace(/\d+%/g, "")
          .replace(/[.]/g, "")
          .trim()
      )
      .filter((s) => s.length > 1 && s.length < 60)
  )
}

/** Delta determinístico de FALLBACK (cuando el LLM falla): set-diff de ítems entre la captura más nueva y la
 *  anterior + el lapso en días. Nunca inventa (solo reporta lo presente/ausente). "" si <2 snapshots.
 *  `recent` viene MÁS RECIENTE primero. */
export function deterministicTrend(
  recent: ConnectorSnapshot[],
  now: Date
): string {
  const newest = recent[0]
  const prev = recent[1]
  if (!newest || !prev) return ""
  const cur = extractItems(newest.content)
  const old = extractItems(prev.content)
  const appeared = [...cur].filter((x) => !old.has(x))
  const gone = [...old].filter((x) => !cur.has(x))
  // Lapso = entre las dos capturas comparadas (el span en que se observó el cambio). En el ingest real
  // `newest.capturedAt` ≈ now; `now` se acepta por consistencia de firma (lo usa buildTrendPrompt).
  void now
  const days = Math.max(
    0,
    Math.round(
      (newest.capturedAt.getTime() - prev.capturedAt.getTime()) / DAY_MS
    )
  )
  const lapso =
    days <= 0 ? "desde la última captura" : `en los últimos ${days} días`
  const parts: string[] = []
  if (appeared.length > 0)
    parts.push(`aparecen: ${appeared.slice(0, 8).join(", ")}`)
  if (gone.length > 0)
    parts.push(`ya no figuran: ${gone.slice(0, 8).join(", ")}`)
  if (parts.length === 0) {
    return `La actividad de Kevin en ${newest.source} se mantiene estable ${lapso}.`
  }
  return `Cambios en la actividad de Kevin (${newest.source}, ${lapso}): ${parts.join("; ")}.`
}

const SYSTEM_ES = [
  "Sos un analista de tendencias. A partir de una serie de capturas FECHADAS de UNA fuente de actividad de Kevin",
  "(música, juegos, código…), describís cómo evolucionó EN EL TIEMPO.",
  "Reglas de grounding (estrictas): usá SOLO lo que está en las capturas; NUNCA inventes artistas, juegos,",
  "lenguajes, géneros, números ni fechas que no aparezcan. Si clasificás (género musical, tipo de juego, área de",
  "programación), hacelo solo si es EVIDENTE por los nombres presentes; ante la duda, no clasifiques.",
  "Hablá de CAMBIOS: qué apareció, qué creció o bajó, en qué se enganchó últimamente. Expresá el lapso en lenguaje",
  "natural a partir de las fechas ('en los últimos N días/semanas'). Redacción corta, 3ª persona sobre Kevin,",
  "densa, sin saludos ni relleno. Si las capturas son casi idénticas, decí que se mantiene estable.",
].join(" ")

const SYSTEM_EN = [
  "You are a trends analyst. From a series of DATED snapshots of ONE source of Kevin's activity (music, games,",
  "code…), describe how it evolved OVER TIME.",
  "Grounding rules (strict): use ONLY what's in the snapshots; NEVER invent artists, games, languages, genres,",
  "numbers or dates that don't appear. If you classify (music genre, game type, programming area), do so only when",
  "it's EVIDENT from the present names; when in doubt, don't classify.",
  "Talk about CHANGES: what appeared, rose or fell, what he got hooked on lately. Express the timespan in natural",
  "language from the dates ('in the last N days/weeks'). Short, third person about Kevin, dense, no greetings or",
  "filler. If the snapshots are nearly identical, say it's holding steady.",
].join(" ")

/** Arma {system, prompt} para el TrendSummarizer. `snapshots` viene más reciente primero. `now` inyectable. */
export function buildTrendPrompt(args: {
  source: string
  snapshots: ConnectorSnapshot[]
  locale: Locale
  now: Date
}): { system: string; prompt: string } {
  const en = args.locale === "en"
  const day = (d: Date) => d.toISOString().slice(0, 10)
  const lines = args.snapshots
    .map((s) => `[${day(s.capturedAt)}] ${s.content}`)
    .join("\n\n")
  const prompt = en
    ? `Source: ${args.source}\nToday: ${day(args.now)}\nSnapshots (newest first):\n\n${lines}\n\nReturn ONLY the trend paragraph (no headings).`
    : `Fuente: ${args.source}\nFecha de hoy: ${day(args.now)}\nCapturas (de más reciente a más antigua):\n\n${lines}\n\nDevolvé SOLO el párrafo de tendencia (sin encabezados).`
  return { system: en ? SYSTEM_EN : SYSTEM_ES, prompt }
}
