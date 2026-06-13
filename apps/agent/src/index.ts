// Bootstrap / wiring: valida env → arma logger + sink + adapters → inyecta puertos en el core →
// sirve Hono. Degradación: si falta OpenRouter, el agente es null y /chat responde cortesía (200);
// si falta DB/embeddings, el agente responde sin RAG. /health siempre vivo. El boot loguea qué
// quedó on/off (sin secrets) para tener visibilidad del estado real del servicio.

import { serve } from "@hono/node-server"
import { createCompressor } from "./adapters/compress.js"
import { createDb } from "./adapters/db/client.js"
import { EMBEDDING_DIM } from "./adapters/db/schema.js"
import { createEmbedder } from "./adapters/embeddings.js"
import { buildApp } from "./adapters/http/routes.js"
import { createLogger } from "./adapters/logger.js"
import { createConversationStore } from "./adapters/neon-conversation.js"
import { createMemoryStore } from "./adapters/neon-memory.js"
import { createModel } from "./adapters/openrouter.js"
import { createSummarizer } from "./adapters/summarizer.js"
import { createTelegramClient } from "./adapters/telegram/client.js"
import type { TelegramDeps } from "./adapters/telegram/routes.js"
import { createLoggerTraceSink } from "./adapters/trace-logger.js"
import {
  loadConfig,
  modelChain,
  telegramAllowedIds,
  telegramEnabled,
} from "./config.js"
import { type Agent, createAgent } from "./core/agent.js"
import type { ConversationStore } from "./ports/conversation.js"
import type { MemoryStore } from "./ports/memory.js"
import type { Summarizer } from "./ports/summary.js"

const env = loadConfig()
const logger = createLogger({
  level: env.LOG_LEVEL,
  format: env.LOG_FORMAT,
  nodeEnv: env.NODE_ENV,
})
const sink = createLoggerTraceSink(logger, { logPrompts: env.LOG_PROMPTS })
const models = modelChain(env)
// Compresor de contexto (Tier 1, determinístico). Independiente de OpenRouter/DB.
const compressor = env.COMPRESS_ENABLED ? createCompressor() : null

let agent: Agent | null = null
let ragEnabled = false
let conversations: ConversationStore | null = null
let summarizer: Summarizer | null = null
if (env.OPENROUTER_API_KEY && models.length > 0) {
  let memory: MemoryStore | null = null
  // La memoria conversacional (conversations/messages) solo necesita DB; el RAG necesita además
  // la key de embeddings (comparte provider con el chat → si no hay propia, usa la de OpenRouter).
  const embeddingsKey = env.EMBEDDINGS_API_KEY || env.OPENROUTER_API_KEY
  if (env.DATABASE_URL) {
    const { db } = createDb(env.DATABASE_URL)
    conversations = createConversationStore(db)
    if (embeddingsKey) {
      const embedder = createEmbedder({
        apiKey: embeddingsKey,
        model: env.EMBEDDINGS_MODEL,
        baseUrl: env.EMBEDDINGS_BASE_URL,
        dimensions: EMBEDDING_DIM,
      })
      memory = createMemoryStore(db, embedder)
      ragEnabled = true
    } else {
      logger.warn(
        "Sin embeddings key → memoria conversacional ON pero sin RAG."
      )
    }
  } else {
    logger.warn("Sin DATABASE_URL → sin memoria conversacional ni RAG.")
  }
  const model = createModel(env.OPENROUTER_API_KEY, models, logger)
  // Resumidor: modelo barato. SUMMARY_MODEL o la cola de la cadena (el más barato/de respaldo).
  const summaryModel =
    env.SUMMARY_MODEL ?? models[models.length - 1] ?? models[0]
  if (summaryModel) {
    summarizer = createSummarizer(
      createModel(env.OPENROUTER_API_KEY, [summaryModel], logger)
    )
  }
  agent = createAgent({
    model,
    memory,
    conversations,
    summarizer,
    compressor,
    convIntensity: env.COMPRESS_INTENSITY_CONV,
    ragIntensity: env.COMPRESS_INTENSITY_RAG,
    summaryThreshold: env.SUMMARY_THRESHOLD,
    recentLimit: env.CONVERSATION_RECENT_LIMIT,
  })
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
  telegram = {
    agent,
    client: createTelegramClient(env.TELEGRAM_BOT_TOKEN, logger),
    allowedIds: telegramAllowedIds(env),
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
    sink,
  }
}

const app = buildApp({
  agentApiKey: env.AGENT_API_KEY,
  agent,
  logger,
  sink,
  telegram,
})

serve({ fetch: app.fetch, port: env.PORT })
logger.info(
  {
    port: env.PORT,
    chat: agent !== null,
    rag: ragEnabled,
    conversations: conversations !== null,
    summarizer: summarizer !== null,
    compress: compressor !== null,
    telegram: telegram !== undefined,
    models,
    logLevel: env.LOG_LEVEL,
    logFormat: env.LOG_FORMAT,
    logPrompts: env.LOG_PROMPTS,
    nodeEnv: env.NODE_ENV,
  },
  "boot — Vaio escuchando"
)
