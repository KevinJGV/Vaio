// Aplica las migraciones de drizzle-kit (carpeta ./migrations) contra la DB.
// Se puede correr como script (`pnpm --filter @vaio/agent db:migrate`) o importar
// desde la ingesta para asegurar el schema antes de poblar.

import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { Pool } from "pg"

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
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error("[migrate] DATABASE_URL no configurada.")
    process.exit(1)
  }
  runMigrations(url)
    .then(() => {
      console.log("[migrate] listo.")
      process.exit(0)
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
