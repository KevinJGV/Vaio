import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { config } from "dotenv"
import { defineConfig } from "drizzle-kit"

// drizzle-kit corre desde apps/agent (cwd) → carga el .env de la RAÍZ del monorepo (../../.env),
// resuelto relativo a este archivo para no depender del cwd. `push` necesita la URL; `generate`
// es offline y la ignora. Sin DATABASE_URL, `push`/`pull` fallan con un error claro de drizzle-kit.
const here = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(here, "../../.env"), quiet: true })

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/adapters/db/schema.ts",
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
})
