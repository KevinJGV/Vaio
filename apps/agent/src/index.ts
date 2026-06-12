// Bootstrap / wiring: valida env → arma logger + sink + adapters → inyecta puertos en el core →
// sirve Hono. Degradación: si falta OpenRouter, el agente es null y /chat responde cortesía (200);
// si falta DB/embeddings, el agente responde sin RAG. /health siempre vivo. El boot loguea qué
// quedó on/off (sin secrets) para tener visibilidad del estado real del servicio.

import { serve } from "@hono/node-server"
import { createDb } from "./adapters/db/client.js"
import { EMBEDDING_DIM } from "./adapters/db/schema.js"
import { createEmbedder } from "./adapters/embeddings.js"
import { buildApp } from "./adapters/http/routes.js"
import { createLogger } from "./adapters/logger.js"
import { createMemoryStore } from "./adapters/neon-memory.js"
import { createModel } from "./adapters/openrouter.js"
import { createLoggerTraceSink } from "./adapters/trace-logger.js"
import { loadConfig, modelChain } from "./config.js"
import { type Agent, createAgent } from "./core/agent.js"
import type { MemoryStore } from "./ports/memory.js"

const env = loadConfig()
const logger = createLogger({
  level: env.LOG_LEVEL,
  format: env.LOG_FORMAT,
  nodeEnv: env.NODE_ENV,
})
const sink = createLoggerTraceSink(logger, { logPrompts: env.LOG_PROMPTS })
const models = modelChain(env)

let agent: Agent | null = null
let ragEnabled = false
if (env.OPENROUTER_API_KEY && models.length > 0) {
  let memory: MemoryStore | null = null
  // Embeddings comparten provider con el chat → si no hay key propia, usar la de OpenRouter.
  const embeddingsKey = env.EMBEDDINGS_API_KEY || env.OPENROUTER_API_KEY
  if (env.DATABASE_URL && embeddingsKey) {
    const { db } = createDb(env.DATABASE_URL)
    const embedder = createEmbedder({
      apiKey: embeddingsKey,
      model: env.EMBEDDINGS_MODEL,
      baseUrl: env.EMBEDDINGS_BASE_URL,
      dimensions: EMBEDDING_DIM,
    })
    memory = createMemoryStore(db, embedder)
    ragEnabled = true
  } else {
    logger.warn("Sin DATABASE_URL/embeddings key → agente sin RAG.")
  }
  const model = createModel(env.OPENROUTER_API_KEY, models, logger)
  // conversations/summarizer se cablean en el wiring de memoria conversacional (Fase 7).
  agent = createAgent({ model, memory, conversations: null, summarizer: null })
} else {
  logger.error(
    "Sin OPENROUTER_API_KEY/OPENROUTER_MODELS → /chat degradado a cortesía."
  )
}

const app = buildApp({ agentApiKey: env.AGENT_API_KEY, agent, logger, sink })

serve({ fetch: app.fetch, port: env.PORT })
logger.info(
  {
    port: env.PORT,
    chat: agent !== null,
    rag: ragEnabled,
    models,
    logLevel: env.LOG_LEVEL,
    logFormat: env.LOG_FORMAT,
    logPrompts: env.LOG_PROMPTS,
    nodeEnv: env.NODE_ENV,
  },
  "boot — Vaio escuchando"
)
