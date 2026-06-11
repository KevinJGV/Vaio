// Taxonomy de eventos de traza de un TURNO del agente (una llamada a /chat). Compartido
// web↔agent y diseñado para PERSISTIR a futuro: hoy estos eventos se emiten a stdout vía el
// TraceSink del logger; mañana un sink de Postgres escribe ESTOS MISMOS eventos para habilitar
// debug de conversaciones / historial de chats sin tocar el core (ver docs del plan de logging).
//
// Los campos de contenido sensible (args/output de tools, texto de mensajes) viven en el schema
// con su forma completa —"máxima visibilidad"— pero la REDACCIÓN se aplica recién al emitir
// (core/logging.ts), según la política y el flag LOG_PROMPTS.

import { z } from "zod"

/** Uso de tokens (forma laxa: el provider puede omitir cualquier campo). */
export const usageSchema = z
  .object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    totalTokens: z.number(),
    reasoningTokens: z.number(),
    cachedInputTokens: z.number(),
  })
  .partial()
export type Usage = z.infer<typeof usageSchema>

/** Campos comunes a todo evento de traza (correlación por requestId/turnId). */
const base = {
  requestId: z.string(),
  conversationId: z.string().optional(),
  turnId: z.string(),
}

/** Evento de traza: unión discriminada por `type`. */
export const traceEventSchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("turn.start"),
    locale: z.enum(["es", "en"]),
    messageCount: z.number().int(),
    /** Preview del último mensaje del usuario (solo se loguea con LOG_PROMPTS). */
    lastUserPreview: z.string().optional(),
  }),
  z.object({
    ...base,
    type: z.literal("reasoning"),
    stepNumber: z.number().int().optional(),
    /** "Pensamiento" del modelo. Se loguea siempre, truncado salvo LOG_PROMPTS. */
    text: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal("tool.call"),
    toolCallId: z.string(),
    toolName: z.string(),
    /** Args de entrada (solo se loguean con LOG_PROMPTS). */
    args: z.unknown().optional(),
  }),
  z.object({
    ...base,
    type: z.literal("tool.result"),
    toolCallId: z.string(),
    toolName: z.string(),
    /** Salida cruda (solo se loguea con LOG_PROMPTS). */
    output: z.unknown().optional(),
    /** Metadata siempre visible: #resultados, latencia, éxito. */
    hits: z.number().int().optional(),
    latencyMs: z.number().optional(),
    ok: z.boolean().optional(),
  }),
  z.object({
    ...base,
    type: z.literal("llm.step"),
    stepNumber: z.number().int(),
    /** Modelo que efectivamente respondió este step (útil con la cadena de fallback). */
    modelId: z.string().optional(),
    finishReason: z.string(),
    usage: usageSchema.optional(),
  }),
  z.object({
    ...base,
    type: z.literal("turn.finish"),
    steps: z.number().int(),
    usage: usageSchema.optional(),
    durationMs: z.number(),
  }),
  z.object({
    ...base,
    type: z.literal("turn.error"),
    message: z.string(),
    where: z.string(),
  }),
])

export type TraceEvent = z.infer<typeof traceEventSchema>
export type TraceEventType = TraceEvent["type"]
