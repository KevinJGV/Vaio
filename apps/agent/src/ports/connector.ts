// Puerto de CONECTOR: una fuente consultable de actividad/estado de Kevin (Last.fm, GitHub, y a futuro WakaTime,
// Steam, stats…). Infra extensible: sumar una fuente = implementar esta interfaz + registrarla en
// adapters/connectors/index.ts. Dos facetas: `live` (snapshot on-demand → "sentido del ahora") y `collect`
// (FUTURO: persistible a memoria → "se nutre solo"). El core depende de esta interfaz, nunca de los adapters.

import type { DocChunk } from "./memory.js"

export interface Connector {
  name: string
  /** Snapshot EN VIVO ("qué pasa ahora": now-playing, actividad de código, stats). null = sin datos.
   *  Best-effort: NUNCA tira (el llamador hace .catch igual, pero el adapter debería resolver null ante fallo). */
  live(): Promise<string | null>
  /** FUTURO — faceta persist ("se nutre solo"): chunks para alimentar la memoria. Opcional; no se usa todavía. */
  collect?(): Promise<DocChunk[]>
}
