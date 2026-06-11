// Entrypoint de ingesta: asegura el schema (migraciones) → recolecta fuentes → reemplaza
// idempotentemente por `source`. Cada collector degrada por separado (si una fuente falla,
// se loguea y se sigue). Correr con `pnpm --filter @vaio/agent ingest` (a mano / cron Railway).

import { createDb } from "./adapters/db/client.js"
import { runMigrations } from "./adapters/db/migrate.js"
import { EMBEDDING_DIM } from "./adapters/db/schema.js"
import { createEmbedder } from "./adapters/embeddings.js"
import { createMemoryStore } from "./adapters/neon-memory.js"
import { collectCV } from "./adapters/sources/cv.js"
import { collectGithub } from "./adapters/sources/github.js"
import { collectLastfm } from "./adapters/sources/lastfm.js"
import { collectPortfolio } from "./adapters/sources/portfolio.js"
import { loadConfig } from "./config.js"
import type { DocChunk } from "./ports/memory.js"

async function main(): Promise<void> {
  const env = loadConfig()
  // Embeddings comparten provider con el chat → si no hay key propia, usar la de OpenRouter.
  const embeddingsKey = env.EMBEDDINGS_API_KEY || env.OPENROUTER_API_KEY
  if (!env.DATABASE_URL || !embeddingsKey) {
    throw new Error(
      "La ingesta requiere DATABASE_URL + (EMBEDDINGS_API_KEY u OPENROUTER_API_KEY)."
    )
  }

  await runMigrations(env.DATABASE_URL)

  const { db, close } = createDb(env.DATABASE_URL)
  const embedder = createEmbedder({
    apiKey: embeddingsKey,
    model: env.EMBEDDINGS_MODEL,
    baseUrl: env.EMBEDDINGS_BASE_URL,
    dimensions: EMBEDDING_DIM,
  })
  const memory = createMemoryStore(db, embedder)

  const collectors: { name: string; run: () => Promise<DocChunk[]> }[] = [
    { name: "cv", run: collectCV },
    { name: "portfolio", run: collectPortfolio },
    {
      name: "github",
      run: () =>
        collectGithub({ user: env.GITHUB_USER, token: env.GITHUB_TOKEN }),
    },
  ]
  if (env.LASTFM_API_KEY && env.LASTFM_USER) {
    const apiKey = env.LASTFM_API_KEY
    const user = env.LASTFM_USER
    collectors.push({
      name: "lastfm",
      run: () => collectLastfm({ apiKey, user }),
    })
  } else {
    console.log("[ingest] lastfm: sin LASTFM_API_KEY/USER, salto.")
  }

  for (const col of collectors) {
    try {
      const rows = await col.run()
      const bySource = new Map<string, DocChunk[]>()
      for (const r of rows) {
        const arr = bySource.get(r.source) ?? []
        arr.push(r)
        bySource.set(r.source, arr)
      }
      for (const [source, group] of bySource) {
        await memory.clearSource(source)
        await memory.upsertDocuments(group)
        console.log(`[ingest] ${source}: ${group.length} chunks`)
      }
    } catch (err) {
      console.error(`[ingest] collector "${col.name}" falló:`, err)
    }
  }

  await close()
  console.log("[ingest] listo.")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
