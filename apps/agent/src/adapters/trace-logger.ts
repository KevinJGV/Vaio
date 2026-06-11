// Adapter de TraceSink: emite los eventos de traza por el Logger (stdout), aplicando la política
// de redacción (core/logging.ts → toLogRecord). Es la ÚNICA implementación hoy; a futuro un
// drizzleTraceSink implementará el mismo puerto para persistir y habilitar el debug de chats.

import { toLogRecord } from "../core/logging.js"
import type { Logger } from "../ports/logger.js"
import type { TraceEvent, TraceSink } from "../ports/trace.js"

export interface TraceLoggerOptions {
  /** Propaga LOG_PROMPTS: si true, loguea contenido crudo (ver toLogRecord). */
  logPrompts: boolean
}

export function createLoggerTraceSink(
  logger: Logger,
  opts: TraceLoggerOptions
): TraceSink {
  return {
    emit(event: TraceEvent): void {
      const { level, msg, fields } = toLogRecord(event, opts)
      if (level === "error") logger.error(fields, msg)
      else logger.info(fields, msg)
    },
  }
}
