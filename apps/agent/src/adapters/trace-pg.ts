// Sink de Postgres: persiste cada TraceEvent (append-only) en `trace_events`. Best-effort y fire-and-forget
// — un fallo de insert NUNCA rompe el turno (invariante "siempre responde"); se loguea a debug. Asigna un
// `seq` monótono POR TURNO (síncrono en emit) para preservar el orden aunque los inserts async se reordenen.

import { isUuid } from "../core/util.js"
import type { Logger } from "../ports/logger.js"
import type { TraceEvent, TraceSink } from "../ports/trace.js"
import type { Database } from "./db/client.js"
import { traceEvents } from "./db/schema.js"

export function createPgTraceSink(db: Database, logger: Logger): TraceSink {
  const seqByTurn = new Map<string, number>()
  return {
    emit(event: TraceEvent) {
      const seq = seqByTurn.get(event.turnId) ?? 0
      seqByTurn.set(event.turnId, seq + 1)
      // Liberar el contador al cerrar el turno (evita leak); el insert ya tomó su seq.
      if (event.type === "turn.finish" || event.type === "turn.error") {
        queueMicrotask(() => seqByTurn.delete(event.turnId))
      }
      void db
        .insert(traceEvents)
        .values({
          requestId: event.requestId,
          // conversationId solo si es un uuid válido (los turnos stateless no lo traen).
          conversationId:
            event.conversationId && isUuid(event.conversationId)
              ? event.conversationId
              : null,
          turnId: event.turnId,
          seq,
          type: event.type,
          payload: event,
        })
        .then(() => undefined)
        .catch((err) => {
          logger.debug(
            { err: err instanceof Error ? err.message : String(err) },
            "trace persist falló"
          )
        })
    },
  }
}
