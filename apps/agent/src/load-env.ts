// Carga el .env de la RAÍZ del monorepo sin importar el cwd. El agente corre desde
// apps/agent (pnpm --filter), así que el dotenv por defecto (cwd/.env) no encontraría
// el .env de la raíz. Resolvemos la ruta relativa a este archivo (src o dist, ambos a
// 3 niveles de la raíz) → siempre apunta a <root>/.env.
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { config } from "dotenv"

const here = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(here, "../../../.env") })
