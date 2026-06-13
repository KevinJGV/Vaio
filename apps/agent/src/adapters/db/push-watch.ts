// Dev-only: hot-sync del esquema tipo "Convex feel". Observa schema.ts y re-corre `drizzle-kit push`
// (codebase-first: difea el código vs la DB y aplica los ALTER directo, SIN migraciones versionadas).
// Sin dependencias extra (node:fs.watch sobre el directorio → sobrevive a los saves atómicos de los
// editores, que reemplazan el archivo y romperían un watch sobre el fichero suelto).
//
// ⚠️ NUNCA en prod: `push` es destructivo-ciego (un rename = drop+create → pérdida de datos; pregunta
// ante ops destructivas). Apuntá a un branch de Neon de dev, no a la DB de prod. Para prod: generate+migrate.

import { spawn } from "node:child_process"
import { watch } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const SCHEMA_FILE = "schema.ts" // en este mismo directorio (src/adapters/db)
const DEBOUNCE_MS = 300

let timer: NodeJS.Timeout | undefined
let running = false

function push(): void {
  if (running) return // un push a la vez; ignorar saves mientras corre
  running = true
  // `pnpm exec` resuelve el binario local de drizzle-kit; cwd = apps/agent (donde está drizzle.config).
  const child = spawn("pnpm", ["exec", "drizzle-kit", "push"], {
    stdio: "inherit", // los prompts de push (ops destructivas) quedan interactivos
  })
  child.on("exit", () => {
    running = false
  })
}

console.log(`[db:push:watch] observando ${SCHEMA_FILE} — Ctrl+C para salir`)
push() // sync inicial al arrancar
watch(here, (_event, filename) => {
  if (filename !== SCHEMA_FILE) return
  clearTimeout(timer)
  timer = setTimeout(push, DEBOUNCE_MS)
})
