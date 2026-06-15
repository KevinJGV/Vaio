// Bootstrap / wiring: valida env → arma logger + sink + adapters → inyecta puertos en el core →
// sirve Hono. Degradación: si falta OpenRouter, el agente es null y /chat responde cortesía (200);
// si falta DB/embeddings, el agente responde sin RAG. /health siempre vivo. El boot loguea qué
// quedó on/off (sin secrets) para tener visibilidad del estado real del servicio.

import { serve } from "@hono/node-server"
import { createCompressor } from "./adapters/compress.js"
import { buildConnectors } from "./adapters/connectors/index.js"
import { createDb } from "./adapters/db/client.js"
import { EMBEDDING_DIM } from "./adapters/db/schema.js"
import { createEmbedder } from "./adapters/embeddings.js"
import { buildApp } from "./adapters/http/routes.js"
import { createLogger } from "./adapters/logger.js"
import {
  createMediaUnderstanding,
  createTranscriber,
} from "./adapters/media-openrouter.js"
import { createConversationStore } from "./adapters/neon-conversation.js"
import { createFactStore } from "./adapters/neon-facts.js"
import { createMemoryStore } from "./adapters/neon-memory.js"
import { createRepoTracker } from "./adapters/neon-tracker.js"
import { createModel } from "./adapters/openrouter.js"
import { createReranker } from "./adapters/rerank-openrouter.js"
import { createRepoSync } from "./adapters/sources/repo-sync.js"
import { createSpeechSynthesizer } from "./adapters/speech-openrouter.js"
import { createSummarizer } from "./adapters/summarizer.js"
import { createTelegramClient } from "./adapters/telegram/client.js"
import { createTelegramMedia } from "./adapters/telegram/media.js"
import type { TelegramDeps } from "./adapters/telegram/routes.js"
import { createCompositeTraceSink } from "./adapters/trace-composite.js"
import { createLoggerTraceSink } from "./adapters/trace-logger.js"
import { createPgTraceSink } from "./adapters/trace-pg.js"
import {
  attribution as buildAttribution,
  loadConfig,
  modelChain,
  rerankChain,
  speechChain,
  summaryChain,
  telegramAllowedIds,
  telegramEnabled,
  transcribeChain,
  visionChain,
} from "./config.js"
import { type Agent, createAgent } from "./core/agent.js"
import { DEFAULT_REPO_POLICY } from "./core/repo-ingest.js"
import type { Connector } from "./ports/connector.js"
import type { ConversationStore } from "./ports/conversation.js"
import type { FactStore } from "./ports/facts.js"
import type { MediaUnderstanding, Transcriber } from "./ports/media.js"
import type { MemoryStore } from "./ports/memory.js"
import type { RepoSyncPort } from "./ports/repo-sync.js"
import type { Reranker } from "./ports/rerank.js"
import type { SpeechSynthesizer } from "./ports/speech.js"
import type { Summarizer } from "./ports/summary.js"

const env = loadConfig()
const logger = createLogger({
  level: env.LOG_LEVEL,
  format: env.LOG_FORMAT,
  nodeEnv: env.NODE_ENV,
})
// DB (Pool) único: lo comparten conversaciones, RAG y la persistencia de traces. null = sin DB.
const dbHandle = env.DATABASE_URL ? createDb(env.DATABASE_URL) : null
// Traza: siempre a stdout (pino); + Postgres si hay DB y TRACE_PERSIST (mismos eventos, contenido completo).
const loggerSink = createLoggerTraceSink(logger, {
  logPrompts: env.LOG_PROMPTS,
})
const sink =
  dbHandle && env.TRACE_PERSIST
    ? createCompositeTraceSink(
        [loggerSink, createPgTraceSink(dbHandle.db, logger)],
        logger
      )
    : loggerSink
// App attribution para OpenRouter (dashboard): se pasa al provider y a las llamadas REST.
const attribution = buildAttribution(env)
const models = modelChain(env)
// Compresor de contexto (Tier 1, determinístico). Independiente de OpenRouter/DB.
const compressor = env.COMPRESS_ENABLED ? createCompressor() : null

let agent: Agent | null = null
let ragEnabled = false
let conversations: ConversationStore | null = null
let factStore: FactStore | null = null
let summarizer: Summarizer | null = null
let transcriber: Transcriber | null = null
let mediaUnderstanding: MediaUnderstanding | null = null
let speech: SpeechSynthesizer | null = null
let reranker: Reranker | null = null
let repoSync: RepoSyncPort | null = null
let connectors: Connector[] = []
if (env.OPENROUTER_API_KEY && models.length > 0) {
  let memory: MemoryStore | null = null
  // La memoria conversacional (conversations/messages) solo necesita DB; el RAG necesita además
  // la key de embeddings (comparte provider con el chat → si no hay propia, usa la de OpenRouter).
  const embeddingsKey = env.EMBEDDINGS_API_KEY || env.OPENROUTER_API_KEY
  if (dbHandle) {
    const { db } = dbHandle
    conversations = createConversationStore(db)
    if (embeddingsKey) {
      const embedder = createEmbedder({
        apiKey: embeddingsKey,
        model: env.EMBEDDINGS_MODEL,
        baseUrl: env.EMBEDDINGS_BASE_URL,
        dimensions: EMBEDDING_DIM,
      })
      memory = createMemoryStore(db, embedder, logger)
      factStore = createFactStore(db, embedder, {
        conflictDistance: env.FACT_CONFLICT_DISTANCE,
        conflictCandidates: env.FACT_CONFLICT_CANDIDATES,
      })
      // Sync incremental de repos (frescura + re-embeber solo lo cambiado). Reusa la policy de ingesta.
      repoSync = createRepoSync({
        memory,
        tracker: createRepoTracker(db),
        token: env.GITHUB_TOKEN,
        policy: {
          ...DEFAULT_REPO_POLICY,
          maxFileBytes: env.RAW_FILE_MAX_BYTES,
          maxChunksPerRepo: env.RAW_REPO_MAX_CHUNKS,
        },
        logger,
        freshnessTtlMs: env.FRESHNESS_TTL_MINUTES * 60 * 1000,
        inlineMaxFiles: env.SYNC_INLINE_MAX_FILES,
      })
      ragEnabled = true
    } else {
      logger.warn(
        "Sin embeddings key → memoria conversacional ON pero sin RAG."
      )
    }
  } else {
    logger.warn("Sin DATABASE_URL → sin memoria conversacional ni RAG.")
  }
  const model = createModel(env.OPENROUTER_API_KEY, models, logger, attribution)
  // Resumidor: cadena de SUMMARY_MODELS (fallback server-side); vacía → cola de la cadena de chat (respaldo barato).
  const summaryModels = summaryChain(env)
  const summaryFallback = models[models.length - 1] ?? models[0]
  const summaryModelsResolved =
    summaryModels.length > 0
      ? summaryModels
      : summaryFallback
        ? [summaryFallback]
        : []
  if (summaryModelsResolved.length > 0) {
    summarizer = createSummarizer(
      createModel(
        env.OPENROUTER_API_KEY,
        summaryModelsResolved,
        logger,
        attribution
      )
    )
  }
  // Comprensión de media POR MODALIDAD (cada una su modelo/endpoint; no la cadena de chat):
  //  - STT: REST /audio/transcriptions con la cadena TRANSCRIBE_MODELS (fallback client-side).
  //  - Visión: chat+file-part con la cadena VISION_MODELS.
  const sttChain = transcribeChain(env)
  if (sttChain.length > 0) {
    transcriber = createTranscriber(
      env.OPENROUTER_API_KEY,
      env.OPENROUTER_BASE_URL,
      sttChain,
      logger,
      attribution
    )
  } else {
    logger.warn("Sin TRANSCRIBE_MODELS → STT OFF.")
  }
  const visChain = visionChain(env)
  if (visChain.length > 0) {
    mediaUnderstanding = createMediaUnderstanding(
      createModel(env.OPENROUTER_API_KEY, visChain, logger, attribution),
      logger
    )
  } else {
    logger.warn("Sin VISION_MODELS → visión OFF.")
  }
  // Rerank (2ª etapa del RAG): cadena REST client-side. Vacía → searchMemory cae a vector top-K.
  const rrChain = rerankChain(env)
  if (rrChain.length > 0) {
    reranker = createReranker({
      apiKey: env.OPENROUTER_API_KEY,
      baseURL: env.OPENROUTER_BASE_URL,
      chain: rrChain,
      logger,
      attribution,
    })
  } else {
    logger.warn("Sin RERANK_MODELS → rerank OFF (vector top-K).")
  }
  // Conectores de actividad/estado en vivo (Last.fm now-playing, GitHub actividad) — gated por keys.
  connectors = buildConnectors(env)
  agent = createAgent({
    model,
    memory,
    factStore,
    conversations,
    summarizer,
    compressor,
    convIntensity: env.COMPRESS_INTENSITY_CONV,
    ragIntensity: env.COMPRESS_INTENSITY_RAG,
    summaryThreshold: env.SUMMARY_THRESHOLD,
    recentLimit: env.CONVERSATION_RECENT_LIMIT,
    transcriber,
    mediaUnderstanding,
    nativeImages: env.MULTIMODAL_NATIVE_IMAGES,
    reranker,
    rerankCandidates: env.RERANK_CANDIDATES,
    factRetrieveMax: env.FACT_RETRIEVE_MAX,
    factRetrieveDistance: env.FACT_RETRIEVE_DISTANCE,
    repoSync,
    syncInlineMaxFiles: env.SYNC_INLINE_MAX_FILES,
    connectors,
    ownerTimezone: env.OWNER_TIMEZONE,
  })
  // Salida de voz (TTS) — cadena de fallback (model|voice|format). Vacía → Vaio solo habla por texto.
  const ttsChain = speechChain(env)
  if (ttsChain.length > 0) {
    speech = createSpeechSynthesizer({
      apiKey: env.OPENROUTER_API_KEY,
      baseURL: env.OPENROUTER_BASE_URL,
      chain: ttsChain,
      logger,
      attribution,
    })
  }
} else {
  logger.error(
    "Sin OPENROUTER_API_KEY/OPENROUTER_MODELS → /chat degradado a cortesía."
  )
}

// Canal Telegram: con token + secret (allowlist opcional → vacía = abierto). El agente puede ser null
// (degrada a cortesía). Los `&&` extra son para el narrowing de TS de las env opcionales.
let telegram: TelegramDeps | undefined
if (
  telegramEnabled(env) &&
  env.TELEGRAM_BOT_TOKEN &&
  env.TELEGRAM_WEBHOOK_SECRET
) {
  if (env.OWNER_TELEGRAM_ID === undefined) {
    logger.warn(
      "Sin OWNER_TELEGRAM_ID → nadie es owner en Telegram (todos = visitante capado)."
    )
  }
  telegram = {
    agent,
    client: createTelegramClient(env.TELEGRAM_BOT_TOKEN, logger),
    allowedIds: telegramAllowedIds(env),
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
    ownerId: env.OWNER_TELEGRAM_ID,
    sink,
    // Descarga de media de Telegram (audio/voz + imágenes). El core decide transcribir/describir.
    media: createTelegramMedia(
      env.TELEGRAM_BOT_TOKEN,
      logger,
      env.MEDIA_MAX_BYTES
    ),
    // Salida de voz (null = Vaio responde solo por texto en Telegram).
    ...(speech ? { speech } : {}),
  }
}

const app = buildApp({
  agentApiKey: env.AGENT_API_KEY,
  agent,
  logger,
  sink,
  telegram,
  mediaMaxBytes: env.MEDIA_MAX_BYTES,
})

serve({ fetch: app.fetch, port: env.PORT })
logger.info(
  {
    port: env.PORT,
    chat: agent !== null,
    rag: ragEnabled,
    facts: factStore != null,
    conversations: conversations !== null,
    summarizer: summarizer !== null,
    compress: compressor !== null,
    tracePersist: dbHandle !== null && env.TRACE_PERSIST,
    transcribe: transcriber !== null,
    vision: mediaUnderstanding !== null,
    speech: speech !== null,
    rerank: reranker !== null,
    repoSync: repoSync !== null,
    connectors: connectors.length,
    nativeImages: env.MULTIMODAL_NATIVE_IMAGES,
    telegram: telegram !== undefined,
    models,
    logLevel: env.LOG_LEVEL,
    logFormat: env.LOG_FORMAT,
    logPrompts: env.LOG_PROMPTS,
    nodeEnv: env.NODE_ENV,
  },
  "boot — Vaio escuchando"
)
