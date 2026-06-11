// Puerto de trazas de conversación: el destino ("sink") de los eventos de observabilidad del
// turno del agente. Hoy hay una sola implementación (adapters/trace-logger.ts → stdout vía el
// Logger). A futuro, un adapter de Postgres (drizzleTraceSink) implementa esta MISMA interfaz
// para persistir y habilitar el debug/historial de conversaciones, sin tocar el core.

import type { TraceEvent } from "@vaio/contracts"

export type { TraceEvent }

/** Recibe eventos de traza de un turno. La implementación decide el formato/destino. */
export interface TraceSink {
  emit(event: TraceEvent): void
}
