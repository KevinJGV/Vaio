// Aplica las migraciones de drizzle-kit (carpeta ./migrations) contra la DB.
// Se puede correr como script (`pnpm --filter @vaio/agent db:migrate`) o importar
// desde la ingesta para asegurar el schema antes de poblar.

import "../../load-env.js"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { Pool } from "pg"
import { createLogger } from "../logger.js"

export async function runMigrations(
  connectionString: string,
  migrationsFolder = "migrations"
): Promise<void> {
  const pool = new Pool({ connectionString })
  try {
    const db = drizzle(pool)
    await migrate(db, { migrationsFolder })
  } finally {
    await pool.end()
  }
}

// Permitir ejecución directa: `tsx src/adapters/db/migrate.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  const logger = createLogger({
    level: process.env.LOG_LEVEL,
    format: process.env.LOG_FORMAT,
    nodeEnv: process.env.NODE_ENV,
  })
  const url = process.env.DATABASE_URL
  if (!url) {
    logger.error("DATABASE_URL no configurada.")
    process.exit(1)
  }
  runMigrations(url)
    .then(() => {
      logger.info("migrate listo")
      process.exit(0)
    })
    .catch((e) => {
      logger.error(
        { err: e instanceof Error ? e.message : String(e) },
        "migrate falló"
      )
      process.exit(1)
    })
}
