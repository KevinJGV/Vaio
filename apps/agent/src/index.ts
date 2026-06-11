// Bootstrap / wiring: valida env → arma adapters → inyecta puertos en el core → sirve Hono.
// Degradación: si falta OpenRouter, el agente es null y /chat responde cortesía (200);
// si falta DB/embeddings, el agente responde sin RAG. /health siempre vivo.

import { serve } from "@hono/node-server"
import { createDb } from "./adapters/db/client.js"
import { EMBEDDING_DIM } from "./adapters/db/schema.js"
import { createEmbedder } from "./adapters/embeddings.js"
import { buildApp } from "./adapters/http/routes.js"
import { createMemoryStore } from "./adapters/neon-memory.js"
import { createModel } from "./adapters/openrouter.js"
import { loadConfig, modelChain } from "./config.js"
import { type Agent, createAgent } from "./core/agent.js"
import type { MemoryStore } from "./ports/memory.js"

const env = loadConfig()
const models = modelChain(env)

let agent: Agent | null = null
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
  } else {
    console.warn("[boot] Sin DATABASE_URL/embeddings key → agente sin RAG.")
  }
  const model = createModel(env.OPENROUTER_API_KEY, models)
  agent = createAgent({ model, memory })
} else {
  console.error(
    "[boot] Sin OPENROUTER_API_KEY/OPENROUTER_MODELS → /chat degradado a cortesía."
  )
}

const app = buildApp({ agentApiKey: env.AGENT_API_KEY, agent })

serve({ fetch: app.fetch, port: env.PORT })
console.log(`Vaio escuchando en :${env.PORT}`)
