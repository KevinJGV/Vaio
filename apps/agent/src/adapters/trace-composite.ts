// Sink compuesto: reenvía cada TraceEvent a varios sinks (p.ej. stdout + Postgres). Cada sink decide
// formato/destino; el composite solo hace fan-out. Si un sink lanza, no debe tumbar a los demás.

import type { Logger } from "../ports/logger.js"
import type { TraceSink } from "../ports/trace.js"

export function createCompositeTraceSink(
  sinks: TraceSink[],
  logger?: Logger
): TraceSink {
  return {
    emit(event) {
      for (const s of sinks) {
        try {
          s.emit(event)
        } catch (err) {
          // Un sink roto no debe impedir que los otros reciban el evento (ni romper el turno). Pero
          // antes el fallo era invisible → dejamos rastro (debug; típicamente el sink pg, el stdout sobrevive).
          logger?.debug({ err: String(err) }, "trace sink falló (best-effort)")
        }
      }
    },
  }
}
