// Entrypoint de SYNC incremental de repos (offline): asegura el schema → por cada repo de RAW_SOURCE_REPOS,
// corre `syncRepo` (frescura → diff por blob-SHA → re-embebe solo lo cambiado). Hace el PRIMER sync full
// (reconcilia el legacy) y los incrementales siguientes. Best-effort por repo. Correr a mano / cron.
//   pnpm --filter @vaio/agent sync   (o node dist/sync.js en deploy)

import { createDb } from "./adapters/db/client.js"
import { runMigrations } from "./adapters/db/migrate.js"
import { EMBEDDING_DIM } from "./adapters/db/schema.js"
import { createEmbedder } from "./adapters/embeddings.js"
import { createLogger } from "./adapters/logger.js"
import { createMemoryStore } from "./adapters/neon-memory.js"
import { createRepoTracker } from "./adapters/neon-tracker.js"
import { syncRepo } from "./adapters/sources/repo-sync.js"
import { loadConfig, rawSourceRepos } from "./config.js"
import { DEFAULT_REPO_POLICY } from "./core/repo-ingest.js"

async function main(): Promise<void> {
  const env = loadConfig()
  const logger = createLogger({
    level: env.LOG_LEVEL,
    format: env.LOG_FORMAT,
    nodeEnv: env.NODE_ENV,
  })
  const embeddingsKey = env.EMBEDDINGS_API_KEY || env.OPENROUTER_API_KEY
  if (!env.DATABASE_URL || !embeddingsKey) {
    throw new Error(
      "El sync requiere DATABASE_URL + (EMBEDDINGS_API_KEY u OPENROUTER_API_KEY)."
    )
  }
  const repos = rawSourceRepos(env)
  if (repos.length === 0) {
    logger.info("sync: sin RAW_SOURCE_REPOS, nada que sincronizar.")
    return
  }

  await runMigrations(env.DATABASE_URL)
  const { db, close } = createDb(env.DATABASE_URL)
  const embedder = createEmbedder({
    apiKey: embeddingsKey,
    model: env.EMBEDDINGS_MODEL,
    baseUrl: env.EMBEDDINGS_BASE_URL,
    dimensions: EMBEDDING_DIM,
  })
  const memory = createMemoryStore(db, embedder, logger)
  const tracker = createRepoTracker(db)
  const policy = {
    ...DEFAULT_REPO_POLICY,
    maxFileBytes: env.RAW_FILE_MAX_BYTES,
    maxChunksPerRepo: env.RAW_REPO_MAX_CHUNKS,
  }

  for (const spec of repos) {
    const report = await syncRepo(spec, {
      memory,
      tracker,
      token: env.GITHUB_TOKEN,
      policy,
      logger,
    })
    logger.info({ ...report }, "sync repo listo")
  }

  await close()
  logger.info("sync listo")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
