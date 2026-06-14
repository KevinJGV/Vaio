// Lógica PURA de logging (sin I/O, testeable): resolución de formato y política de redacción.
// Separar esto del backend (pino) permite testear la "máxima visibilidad vs. redacción" sin
// montar el logger, y deja el mapeo TraceEvent→registro reutilizable por cualquier sink futuro.

import type { TraceEvent } from "@vaio/contracts"
import type { LogFields } from "../ports/logger.js"

export type LogFormat = "pretty" | "json"
export type LogLevel = "info" | "error"

/** pretty/json explícitos mandan; "auto" (o indefinido) = json en prod, pretty fuera. */
export function resolveLogFormat(
  format: string | undefined,
  nodeEnv: string | undefined
): LogFormat {
  if (format === "pretty" || format === "json") return format
  return nodeEnv === "production" ? "json" : "pretty"
}

export interface RedactOptions {
  /** Si es true, se loguea contenido crudo (prompts, args/output de tools, reasoning completo). */
  logPrompts: boolean
}

/** Tope de caracteres del "pensamiento" en logs sin LOG_PROMPTS (evita floodear stdout). */
export const REASONING_CAP = 2000

function truncate(text: string, cap: number): string {
  if (text.length <= cap) return text
  return `${text.slice(0, cap)}… (+${text.length - cap} chars)`
}

export interface LogRecord {
  level: LogLevel
  msg: string
  fields: LogFields
}

/**
 * Mapea un TraceEvent al registro a loggear, aplicando la política de redacción:
 * - SIEMPRE: ids, tipo de evento, nombres de tools, métricas (hits/latencia/usage/finishReason).
 * - REASONING: siempre, truncado a REASONING_CAP salvo logPrompts (completo).
 * - SOLO con logPrompts: texto crudo de prompts, args y output de tools.
 */
export function toLogRecord(event: TraceEvent, opts: RedactOptions): LogRecord {
  const fields: LogFields = {
    evt: event.type,
    requestId: event.requestId,
    turnId: event.turnId,
  }
  if (event.conversationId) fields.conversationId = event.conversationId

  switch (event.type) {
    case "turn.start": {
      fields.locale = event.locale
      fields.messageCount = event.messageCount
      if (opts.logPrompts && event.lastUserPreview !== undefined) {
        fields.lastUserPreview = event.lastUserPreview
      }
      return { level: "info", msg: "turn.start", fields }
    }
    case "reasoning": {
      if (event.stepNumber !== undefined) fields.stepNumber = event.stepNumber
      fields.text = opts.logPrompts
        ? event.text
        : truncate(event.text, REASONING_CAP)
      return { level: "info", msg: "reasoning", fields }
    }
    case "tool.call": {
      fields.toolCallId = event.toolCallId
      fields.toolName = event.toolName
      if (opts.logPrompts && event.args !== undefined) fields.args = event.args
      return { level: "info", msg: "tool.call", fields }
    }
    case "tool.result": {
      fields.toolCallId = event.toolCallId
      fields.toolName = event.toolName
      if (event.hits !== undefined) fields.hits = event.hits
      if (event.latencyMs !== undefined) fields.latencyMs = event.latencyMs
      if (event.ok !== undefined) fields.ok = event.ok
      if (opts.logPrompts && event.output !== undefined) {
        fields.output = event.output
      }
      return { level: "info", msg: "tool.result", fields }
    }
    case "llm.step": {
      fields.stepNumber = event.stepNumber
      if (event.modelId !== undefined) fields.modelId = event.modelId
      fields.finishReason = event.finishReason
      if (event.usage) fields.usage = event.usage
      return { level: "info", msg: "llm.step", fields }
    }
    case "turn.finish": {
      fields.steps = event.steps
      fields.durationMs = event.durationMs
      if (event.usage) fields.usage = event.usage
      return { level: "info", msg: "turn.finish", fields }
    }
    case "turn.error": {
      fields.message = event.message
      fields.where = event.where
      return { level: "error", msg: "turn.error", fields }
    }
    case "degraded": {
      // Degradación no-fatal: el turno siguió, pero un componente accesorio falló. component/reason
      // SIEMPRE visibles (causa para depurar); `detail` (status/excepción) solo con logPrompts.
      fields.component = event.component
      fields.reason = event.reason
      if (opts.logPrompts && event.detail !== undefined) fields.detail = event.detail
      return { level: "error", msg: "degraded", fields }
    }
  }
}
