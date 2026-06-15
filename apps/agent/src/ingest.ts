// Entrypoint de ingesta de fuentes EXTERNAS no-repo: GitHub (catálogo de repos) + Last.fm (música).
// Reemplaza idempotentemente por `source`. Cada collector degrada por separado.
//   - cv/me/contact: DEPRECADOS → su contenido vive en el repo del portafolio (KevinJGV/KevinJGV: i18n + cv.ts),
//     que se ingiere/mantiene fresco vía `sync.ts` (sync incremental). Acá se LIMPIAN los sources viejos.
//   - repos (repo:*): los maneja `sync.ts` (sync incremental con frescura), NO este entrypoint (evita clobbear
//     el manifest path/blob_sha del sync).
// Correr con `pnpm --filter @vaio/agent ingest` (a mano / cron). Para repos: `pnpm --filter @vaio/agent sync`.

import { buildConnectors } from "./adapters/connectors/index.js"
import { createDb } from "./adapters/db/client.js"
import { runMigrations } from "./adapters/db/migrate.js"
import { EMBEDDING_DIM } from "./adapters/db/schema.js"
import { createEmbedder } from "./adapters/embeddings.js"
import { createLogger } from "./adapters/logger.js"
import { createMemoryStore } from "./adapters/neon-memory.js"
import { createSnapshotStore } from "./adapters/neon-snapshots.js"
import { createModel } from "./adapters/openrouter.js"
import { createTrendSummarizer } from "./adapters/trend-summarizer.js"
import { attribution, loadConfig, modelChain, trendChain } from "./config.js"
import { runConnectorTrend, type TrendDeps } from "./core/trend-ingest.js"
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

  // Tendencias ("trends"): acumular snapshots + derivar el patrón. OFF por defecto. El modelo cae a
  // TREND_MODELS → SUMMARY_MODELS → cola del chat; si no hay ninguno, se saltea (degrada a determinístico).
  let trendDeps: TrendDeps | undefined
  if (env.TRENDS_ENABLED) {
    const trendModels = trendChain(env)
    const models = trendModels.length > 0 ? trendModels : modelChain(env)
    if (models.length > 0) {
      trendDeps = {
        snapshots: createSnapshotStore(db),
        summarizer: createTrendSummarizer(
          createModel(
            env.OPENROUTER_API_KEY ?? "",
            models,
            logger,
            attribution(env)
          )
        ),
        memory,
        retention: env.TREND_RETENTION,
        locale: "es", // owner (Kevin); el ingest es batch, no per-usuario
        now: new Date(),
      }
    } else {
      logger.info("trends: ON pero sin modelos configurados → se saltea")
    }
  }

  // Limpieza one-shot de las fuentes scrapeadas deprecadas (idempotente: no-op si ya no existen).
  for (const source of DEPRECATED_SOURCES) {
    await memory.clearSource(source)
  }

  // Fuentes = conectores con faceta persist (collect). Mismo `buildConnectors` que la tool recentActivity (live):
  // una sola definición por fuente. Sumar fuente persistible = un conector con collect() + su key.
  const collectors = buildConnectors(env).filter((c) => c.collect)
  if (collectors.length === 0)
    logger.info("ingest: sin conectores con collect().")

  for (const col of collectors) {
    try {
      const rows = (await col.collect?.()) ?? []
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
        // Tendencia: el snapshot vigente quedó en `documents`; acumular la serie y derivar el patrón.
        if (trendDeps) {
          const content = group.map((c) => c.chunk).join("\n")
          const status = await runConnectorTrend(source, content, trendDeps)
          logger.info({ source, status }, "ingest trend")
        }
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
