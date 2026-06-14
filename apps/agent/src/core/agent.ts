// Núcleo del agente (STATEFUL): recibe un TurnRequest normalizado de un canal, carga el historial
// server-side (ConversationStore), arma el system prompt (arnés) + las tools gated por capacidad, y
// corre el loop de streamText INSTRUMENTANDO cada fase como eventos de traza (turn.start → tool.call
// → tool.result → reasoning → llm.step → turn.finish | turn.error) vía TraceSink. Devuelve { stream,
// text }: `stream` para canales streaming (HTTP passthrough), `text` para no-streaming (Telegram).
// Tras cerrar el stream, persiste el turno y actualiza el resumen rodante EN BACKGROUND (no bloquea
// ni rompe la respuesta). Depende de PUERTOS, nunca de adapters; el wiring (index.ts) inyecta todo.

import { randomUUID } from "node:crypto"
import type { Locale, TraceEvent, TurnRequest, Usage } from "@vaio/contracts"
import {
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  stepCountIs,
  streamText,
} from "ai"
import type { Compressor, Intensity } from "../ports/compress.js"
import type {
  ConversationContext,
  ConversationStore,
  StoredAttachment,
} from "../ports/conversation.js"
import type { Logger } from "../ports/logger.js"
import type {
  MediaUnderstanding,
  ResolvedMedia,
  Transcriber,
} from "../ports/media.js"
import type { MemoryStore } from "../ports/memory.js"
import type { Summarizer } from "../ports/summary.js"
import type { TraceSink } from "../ports/trace.js"
import { buildTools } from "./actions/registry.js"
import type { TraceIds } from "./actions/types.js"
import {
  type CapabilityResolver,
  createCapabilityResolver,
  type Principal,
} from "./capabilities.js"
import { buildUserContent } from "./modality.js"
import { type Audience, buildSystemPrompt } from "./prompt.js"
import { buildSummaryPrompt, shouldSummarize } from "./summary.js"
import { compressOrRaw, errMsg, preview } from "./util.js"

export interface AgentDeps {
  model: LanguageModel
  /** null cuando no hay DB/embeddings → el agente responde sin RAG. */
  memory: MemoryStore | null
  /** null cuando no hay DB → modo stateless single-turn (sin historial ni persistencia). */
  conversations: ConversationStore | null
  /** null cuando no hay OpenRouter → nunca resume (mantiene la ventana cruda). */
  summarizer: Summarizer | null
  /** Resuelve el perfil de capacidades por canal/principal (puro). */
  capabilities?: CapabilityResolver
  /** Compresor determinístico (Tier 1) del contexto que se manda al modelo. null = sin comprimir. */
  compressor?: Compressor | null
  /** Intensidad de compresión del CONTEXTO conversacional (resumen + turnos históricos). */
  convIntensity?: Intensity
  /** Intensidad de compresión de los chunks de RAG (searchMemory). */
  ragIntensity?: Intensity
  /** Nº de mensajes acumulados que dispara el resumen rodante. */
  summaryThreshold?: number
  /** Cuántos mensajes recientes se pasan verbatim al modelo. */
  recentLimit?: number
  /** Comprensión de media (entrada multimodal). null = sin transcripción/visión → se degrada. */
  transcriber?: Transcriber | null
  mediaUnderstanding?: MediaUnderstanding | null
  /** true → imágenes se pasan NATIVAS al modelo de chat (la cadena debe ser vision-capaz). */
  nativeImages?: boolean
}

/** Contexto de observabilidad de un turno (lo arma el adapter de canal por request). */
export interface TurnContext {
  logger: Logger
  sink: TraceSink
  requestId: string
}

/** Resultado de un turno: `stream` (passthrough HTTP) + `text` (drenaje no-streaming, p.ej. Telegram).
 *  `text` NUNCA rechaza: resuelve la cortesía si el modelo falló o no emitió nada. */
export interface RespondResult {
  stream: ReadableStream<Uint8Array>
  text: Promise<string>
}

export type Agent = ReturnType<typeof createAgent>

const DEFAULT_SUMMARY_THRESHOLD = 12
const DEFAULT_RECENT_LIMIT = 10

const EMPTY_CTX: ConversationContext = {
  conversationId: "",
  summary: "",
  recent: [],
  messageCount: 0,
}

/** Respuesta de cortesía cuando no podemos llamar al modelo (config faltante o error). */
export function courtesy(locale: Locale): string {
  return locale === "en"
    ? "I'm having a hiccup reaching my brain right now — try again in a moment. 🙏"
    : "Estoy teniendo un problemita para pensar ahora mismo — probá de nuevo en un momento. 🙏"
}

/** Extrae los campos de uso definidos (el provider puede omitir cualquiera). */
function pickUsage(u: LanguageModelUsage | undefined): Usage | undefined {
  if (!u) return undefined
  const out: Usage = {}
  if (typeof u.inputTokens === "number") out.inputTokens = u.inputTokens
  if (typeof u.outputTokens === "number") out.outputTokens = u.outputTokens
  if (typeof u.totalTokens === "number") out.totalTokens = u.totalTokens
  return out
}

export function createAgent(deps: AgentDeps) {
  const {
    model,
    memory,
    conversations,
    summarizer,
    capabilities = createCapabilityResolver(),
    compressor = null,
    convIntensity = "lite",
    ragIntensity = "full",
    summaryThreshold = DEFAULT_SUMMARY_THRESHOLD,
    recentLimit = DEFAULT_RECENT_LIMIT,
    transcriber = null,
    mediaUnderstanding = null,
    nativeImages = false,
  } = deps

  return {
    /**
     * Procesa un turno: carga historial → arma prompt/tools → streamea → persiste en background.
     * El error del modelo llega por `onError` (no lanza en textStream) → si erroró sin emitir nada,
     * inyectamos la cortesía. Nunca devuelve vacío ni 500 al usuario.
     */
    async respond(
      req: TurnRequest,
      ctx: TurnContext,
      media: ResolvedMedia[] = []
    ): Promise<RespondResult> {
      const locale: Locale = req.locale ?? "es"
      const turnId = randomUUID()
      const startedAt = Date.now()
      const principal: Principal = {
        channel: req.channel,
        id: req.principalId,
        trusted: req.trusted,
      }
      const caps = capabilities.resolve(req.channel, principal)
      // Con quién habla Vaio: en Telegram, trusted = el owner (Kevin); si no, visitante. Web = público.
      const audience: Audience =
        req.channel === "telegram"
          ? principal.trusted
            ? "owner"
            : "visitor"
          : "public"

      // Historial server-side (el canal NO manda todo el historial). Sin DB → stateless single-turn.
      let conversationId: string | undefined
      let convCtx = EMPTY_CTX
      if (conversations) {
        conversationId = await conversations.ensure(
          req.channel,
          req.conversationKey,
          locale
        )
        convCtx = await conversations.loadContext(conversationId, recentLimit)
      }

      const ids: TraceIds = conversationId
        ? { requestId: ctx.requestId, conversationId, turnId }
        : { requestId: ctx.requestId, turnId }
      const emit = (e: TraceEvent): void => ctx.sink.emit(e)

      let errored = false
      let lastUsage: Usage | undefined

      // Entrada multimodal: resuelve los adjuntos (audio→texto / imagen→texto o part nativa). El I/O de
      // descarga lo hizo el adapter de canal (pasó `media` con bytes); acá solo se decide y se arma el
      // content. `derivedText` (texto plano con marcadores) es lo que se previsualiza y se persiste.
      const { content: userContent, derivedText } = await buildUserContent({
        userText: req.userText,
        media,
        transcriber,
        understanding: mediaUnderstanding,
        nativeImages,
        locale,
      })

      emit({
        ...ids,
        type: "turn.start",
        locale,
        messageCount: convCtx.recent.length + 1,
        lastUserPreview: preview(derivedText),
      })

      // Tier 1: comprimir el contexto de MEMORIA (resumen + turnos históricos) que va al modelo.
      // NO se comprime el mensaje VIVO del usuario ni la persona/policy (voz de Vaio + prompt-caching).
      const compressedSummary = compressOrRaw(
        compressor,
        convCtx.summary,
        convIntensity
      )
      const recent = convCtx.recent.map((m) => ({
        role: m.role,
        content: compressOrRaw(compressor, m.content, convIntensity),
      }))
      const messages: ModelMessage[] = [
        ...recent.map(
          (m) => ({ role: m.role, content: m.content }) as ModelMessage
        ),
        { role: "user", content: userContent },
      ]
      if (compressor) {
        const before =
          compressor.countTokens(convCtx.summary) +
          convCtx.recent.reduce(
            (n, m) => n + compressor.countTokens(m.content),
            0
          )
        const after =
          compressor.countTokens(compressedSummary) +
          recent.reduce((n, m) => n + compressor.countTokens(m.content), 0)
        if (before > 0) {
          ctx.logger.debug(
            { before, after, saved: before - after },
            "context compressed"
          )
        }
      }

      const result = streamText({
        model,
        system: buildSystemPrompt({
          locale,
          audience,
          policyText: caps.policyText,
          summary: compressedSummary,
        }),
        messages,
        stopWhen: stepCountIs(10),
        tools: buildTools({
          caps,
          principal,
          memory,
          emit,
          ids,
          logger: ctx.logger,
          compressor,
          ragIntensity,
        }),
        onChunk({ chunk }) {
          if (chunk.type === "tool-call") {
            emit({
              ...ids,
              type: "tool.call",
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              args: chunk.input,
            })
          }
        },
        onStepFinish(step) {
          if (step.reasoningText) {
            emit({
              ...ids,
              type: "reasoning",
              stepNumber: step.stepNumber,
              text: step.reasoningText,
            })
          }
          emit({
            ...ids,
            type: "llm.step",
            stepNumber: step.stepNumber,
            modelId: step.model.modelId,
            finishReason: step.finishReason,
            ...(pickUsage(step.usage) ? { usage: pickUsage(step.usage) } : {}),
          })
        },
        onFinish(event) {
          lastUsage = pickUsage(event.totalUsage)
          emit({
            ...ids,
            type: "turn.finish",
            steps: event.steps.length,
            durationMs: Date.now() - startedAt,
            ...(lastUsage ? { usage: lastUsage } : {}),
          })
        },
        onError({ error }) {
          errored = true
          emit({
            ...ids,
            type: "turn.error",
            message: errMsg(error),
            where: "streamText",
          })
          ctx.logger.error({ err: errMsg(error) }, "streamText error")
        },
      })

      // Persistencia + resumen rodante: corre DESPUÉS de cerrar el stream, sin bloquear al consumidor.
      // Todo envuelto: un fallo acá nunca afecta la respuesta ya entregada.
      const persist = async (assistant: string): Promise<void> => {
        if (!conversations || !conversationId) return
        try {
          const userAttachments: StoredAttachment[] = (
            req.attachments ?? []
          ).map((a) => ({
            kind: a.kind,
            mediaType: a.mediaType,
            ref: a.ref,
            ...(a.caption ? { caption: a.caption } : {}),
          }))
          await conversations.appendTurn(conversationId, turnId, {
            user: derivedText,
            assistant,
            ...(lastUsage ? { usage: lastUsage } : {}),
            ...(userAttachments.length > 0 ? { userAttachments } : {}),
          })
          if (
            summarizer &&
            shouldSummarize({
              messageCount: convCtx.messageCount + 2,
              threshold: summaryThreshold,
            })
          ) {
            const { messages: older, upToMessageId } =
              await conversations.pendingSummary(conversationId, recentLimit)
            if (older.length > 0) {
              const { system, prompt } = buildSummaryPrompt({
                priorSummary: convCtx.summary,
                olderMessages: older,
                locale,
              })
              const next = await summarizer.summarize({ system, prompt })
              await conversations.updateSummary(
                conversationId,
                next,
                upToMessageId
              )
            }
          }
        } catch (err) {
          ctx.logger.error({ err: errMsg(err) }, "persist/summary falló")
          emit({
            ...ids,
            type: "turn.error",
            message: errMsg(err),
            where: "persist",
          })
        }
      }

      const encoder = new TextEncoder()
      let resolveText!: (s: string) => void
      const text = new Promise<string>((res) => {
        resolveText = res
      })
      let finalText = ""

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          let emitted = false
          try {
            for await (const chunk of result.textStream) {
              emitted = true
              finalText += chunk
              controller.enqueue(encoder.encode(chunk))
            }
          } catch (err) {
            if (!errored) {
              emit({
                ...ids,
                type: "turn.error",
                message: errMsg(err),
                where: "textStream",
              })
            }
            errored = true
            ctx.logger.error({ err: errMsg(err) }, "textStream error")
          }
          if (errored && !emitted) {
            finalText = courtesy(locale)
            controller.enqueue(encoder.encode(finalText))
          }
          controller.close()
          resolveText(finalText)
          // Persistir lo efectivamente respondido (background, no se espera en la ruta del consumidor).
          void persist(finalText)
        },
      })

      return { stream, text }
    },
  }
}
