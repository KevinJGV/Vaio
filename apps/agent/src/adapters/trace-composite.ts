// Sink compuesto: reenvía cada TraceEvent a varios sinks (p.ej. stdout + Postgres). Cada sink decide
// formato/destino; el composite solo hace fan-out. Si un sink lanza, no debe tumbar a los demás.

import type { TraceSink } from "../ports/trace.js"

export function createCompositeTraceSink(sinks: TraceSink[]): TraceSink {
  return {
    emit(event) {
      for (const s of sinks) {
        try {
          s.emit(event)
        } catch {
          // Un sink roto no debe impedir que los otros reciban el evento (ni romper el turno).
        }
      }
    },
  }
}
