// Reporte UNIFORME de degradaciones: fallo NO-fatal (el turno sigue, pero un componente accesorio falló).
// Emite un TraceEvent `degraded` → el sink lo loguea a stdout (vía toLogRecord, nivel error para que resalte)
// Y lo persiste en trace_events (donde el sink pg esté activo). Un solo punto = un solo emit; no duplica el log.

import type { TraceEvent } from "@vaio/contracts"
import type { TraceIds } from "./actions/types.js"

export interface DegradeReport {
  /** Qué se degradó: "transcribe" | "vision" | "embeddings" | "tts" | "source" | … */
  component: string
  /** Causa corta, legible (siempre visible en el log). */
  reason: string
  /** Detalle técnico (status/excepción); se redacta según LOG_PROMPTS al loguear. */
  detail?: string
}

/** Reporta una degradación emitiendo el TraceEvent `degraded` (el sink se encarga de log + persistencia). */
export function reportDegraded(
  deps: { emit: (e: TraceEvent) => void; ids: TraceIds },
  d: DegradeReport
): void {
  deps.emit({
    ...deps.ids,
    type: "degraded",
    component: d.component,
    reason: d.reason,
    detail: d.detail,
  })
}
