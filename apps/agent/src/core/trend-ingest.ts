// Orquestación de la derivación de TENDENCIAS para UN source (depende solo de PUERTOS → testeable con fakes).
// Flujo: append snapshot (dedup) → prune → listRecent → derivar (LLM, con fallback determinístico) → upsert el
// chunk `trend:<source>` (reemplaza el anterior; los snapshots acumulan). Best-effort: el llamador (ingest)
// envuelve por conector en try/catch. Nunca rompe el ingest (Invariante #1).

import type { Locale } from "@vaio/contracts"
import type { MemoryStore } from "../ports/memory.js"
import type { SnapshotStore } from "../ports/snapshot-store.js"
import type { TrendSummarizer } from "../ports/trend.js"
import { buildTrendPrompt, deterministicTrend, trendSource } from "./trends.js"

export interface TrendDeps {
  snapshots: SnapshotStore
  summarizer: TrendSummarizer
  memory: MemoryStore
  retention: number
  locale: Locale
  now: Date
}

export type TrendStatus = "dedup" | "first" | "derived" | "empty"

/** Procesa la tendencia de un source a partir de su snapshot vigente (`content`). Devuelve el estado (para logs). */
export async function runConnectorTrend(
  source: string,
  content: string,
  deps: TrendDeps
): Promise<TrendStatus> {
  const inserted = await deps.snapshots.append({ source, content })
  if (!inserted) return "dedup" // nada cambió desde la última captura → no derivar
  await deps.snapshots.prune(source, deps.retention)
  const recent = await deps.snapshots.listRecent(source, deps.retention)
  if (recent.length < 2) return "first" // sin con qué comparar todavía

  const { system, prompt } = buildTrendPrompt({
    source,
    snapshots: recent,
    locale: deps.locale,
    now: deps.now,
  })
  let text: string
  try {
    text = await deps.summarizer.summarize({ system, prompt })
  } catch {
    text = deterministicTrend(recent, deps.now) // fallback grounded (Invariante #1)
  }
  if (!text.trim()) return "empty"

  const ts = trendSource(source)
  await deps.memory.clearSource(ts) // el trend es el ÚLTIMO derivado (reemplaza)
  await deps.memory.upsertDocuments([{ source: ts, url: "", chunk: text }])
  return "derived"
}
