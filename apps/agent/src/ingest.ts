// Entrypoint de ingesta de fuentes EXTERNAS no-repo: GitHub (catálogo de repos) + Last.fm (música).
// Reemplaza idempotentemente por `source`. Cada collector degrada por separado.
//   - cv/me/contact: DEPRECADOS → su contenido vive en el repo del portafolio (KevinJGV/KevinJGV: i18n + cv.ts),
//     que se ingiere/mantiene fresco vía `sync.ts` (sync incremental). Acá se LIMPIAN los sources viejos.
//   - repos (repo:*): los maneja `sync.ts` (sync incremental con frescura), NO este entrypoint (evita clobbear
//     el manifest path/blob_sha del sync).
// Correr con `pnpm --filter @vaio/agent ingest` (a mano / cron). Para repos: `pnpm --filter @vaio/agent sync`.

import { createDb } from "./adapters/db/client.js"
import { runMigrations } from "./adapters/db/migrate.js"
import { EMBEDDING_DIM } from "./adapters/db/schema.js"
import { createEmbedder } from "./adapters/embeddings.js"
import { createLogger } from "./adapters/logger.js"
import { createMemoryStore } from "./adapters/neon-memory.js"
import { collectGithub } from "./adapters/sources/github.js"
import { collectLastfm } from "./adapters/sources/lastfm.js"
import { loadConfig } from "./config.js"
import type { DocChunk } from "./ports/memory.js"

// Fuentes scrapeadas deprecadas (su contenido es duplicado del repo del portafolio, que sí tiene frescura).
// Se limpian de `documents` para no dejar copias rancias huérfanas.
const DEPRECATED_SOURCES = ["cv", "cv-en", "me", "contact"]

async function main(): Promise<void> {
  const env = loadConfig()
  const logger = createLogger({
    level: env.LOG_LEVEL,
    format: env.LOG_FORMAT,
    nodeEnv: env.NODE_ENV,
  })
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

  // Limpieza one-shot de las fuentes scrapeadas deprecadas (idempotente: no-op si ya no existen).
  for (const source of DEPRECATED_SOURCES) {
    await memory.clearSource(source)
  }

  const collectors: { name: string; run: () => Promise<DocChunk[]> }[] = [
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
    logger.info("lastfm: sin LASTFM_API_KEY/USER, salto.")
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
        logger.info({ source, chunks: group.length }, "ingest source")
      }
    } catch (err) {
      logger.error(
        {
          collector: col.name,
          err: err instanceof Error ? err.message : String(err),
        },
        "collector falló"
      )
    }
  }

  await close()
  logger.info("ingest listo (repos → usar `pnpm sync`)")
}

main().catch((e) => {
  // Último recurso: el logger puede no existir si falló loadConfig → console crudo.
  console.error(e)
  process.exit(1)
})
