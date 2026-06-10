// Bootstrap / wiring: valida env → arma adapters → inyecta puertos en el core → sirve Hono.
// Degradación: si falta OpenRouter, el agente es null y /chat responde cortesía (200);
// si falta DB/embeddings, el agente responde sin RAG. /health siempre vivo.

import { serve } from "@hono/node-server"
import { createDb } from "./adapters/db/client.js"
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
  if (env.DATABASE_URL && env.EMBEDDINGS_API_KEY) {
    const { db } = createDb(env.DATABASE_URL)
    const embedder = createEmbedder({
      apiKey: env.EMBEDDINGS_API_KEY,
      model: env.EMBEDDINGS_MODEL,
      baseUrl: env.EMBEDDINGS_BASE_URL,
    })
    memory = createMemoryStore(db, embedder)
  } else {
    console.warn("[boot] Sin DATABASE_URL/EMBEDDINGS_API_KEY → agente sin RAG.")
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
