# Learnings — Vaio

Aprendizajes de **desarrollo** (decisiones no obvias, gotchas, cosas que rompimos-y-arreglamos)
para no repetirlas en próximas sesiones. Una línea por aprendizaje, concreta.

> Esto es la memoria del **dev**. La memoria del **producto** (lo que el agente sabe de Kevin)
> vive en Neon/pgvector — ver `docs/SPEC.md`.

- **AI SDK**: el scaffold pineaba `ai@^4` (chocaba con el provider de OpenRouter, peer `ai@^5`).
  Se subió a `^5`, y luego **Dependabot lo llevó a `ai@6` (6.0.x)** — la API de `streamText`/`tool`/
  `stepCountIs`/`ModelMessage`/`toTextStreamResponse` que usamos sigue compatible en v6 (typecheckea).
- **Tools del AI SDK v5**: `tool({ description, inputSchema: z.object(...), execute })` →
  requiere `zod` como dep. La API renombró `CoreMessage`→`ModelMessage` (se importa de `ai`).
- **OpenRouter fallback**: la cadena se pasa como `extraBody: { models: [...] }` al
  `openrouter.chat(primary, ...)` — OpenRouter recorre la lista server-side. El `model` es el
  primario; `models` la secuencia de candidatos. (verificado con context7, jun-2026)
- **Drizzle + pgvector**: columna `vector("embedding",{dimensions:1536})` + índice
  `index().using("hnsw", t.embedding.op("vector_cosine_ops"))`; búsqueda con `cosineDistance(col, emb)`
  (= operador `<=>`) en `orderBy` ascendente (menor distancia = más similar). Driver
  `drizzle-orm/node-postgres` (Pool) porque Railway es always-on, NO el serverless de Neon.
- **Migración pgvector**: `drizzle-kit generate` crea el DDL pero el tipo `vector` exige la
  extensión ANTES → se antepone `CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint`
  como primer statement de la migración inicial (`0000_*.sql`). `generate` corre offline (sin DB).
- **Monorepo pnpm**: `@vaio/contracts` expone `"types": "./src/index.ts"` y `"default": "./dist/index.js"`
  → tsc/typecheck resuelven tipos del SOURCE (no necesitan build), runtime usa dist (build topológico
  de `pnpm -r build`: contracts antes que agent). `dev` del agent buildea contracts primero.
- **pnpm 10 bloquea build scripts**: `esbuild` (que usan tsx/vitest) no corre su postinstall hasta
  listarlo en `pnpm.onlyBuiltDependencies` del package.json raíz.
- **Biome v2**: `assist.actions.source.organizeImports` (no el viejo `organizeImports` top-level);
  alinear el `$schema` URL con la versión instalada o tira un info de "biome migrate". Además
  **`biome.json` es JSON estricto (NO admite comentarios `//`)**: un comentario rompe el parseo y
  Biome cae a defaults (¡indentación con tabs!) reformateando todo mal. Si querés comentarios → `biome.jsonc`.

### Reconciliación de major bumps de Dependabot (jun 2026)
Dependabot mergeó a `main` saltos mayores: `ai` 5→6, `@openrouter/ai-sdk-provider` 1→2, `zod` 3→4,
`@hono/node-server` 1→2, `drizzle-orm`→0.45, `typescript`→6, `vitest` 2→4, `dotenv`→17, `@types/node`→25.
El código typecheckeó sin cambios de API salvo **dos rupturas reales**:
- **`TS4058`** (ai v6 expone un tipo interno `Output` innombrable al emitir `.d.ts`) → `apps/agent`
  es una **app, no librería** → `declaration: false` (+ `declarationMap: false`) en su tsconfig.
  `packages/contracts` SÍ mantiene `declaration: true` (es consumido como librería).
- **vitest 4 ↔ vite 5**: vitest 4 exige `vite ^6||^7||^8` (usa `vite/module-runner`), pero el bump
  2→4 dejó `vite@5` resuelto → agregar `vite` explícito como devDep de `apps/agent` (`^8`).
- **Node 20 llegó a EOL (30-abr-2026)** → migrado a **Node 24** (Active LTS, hasta 2028) en
  `.nvmrc`, CI (`node-version: 24`) y `engines: >=22`. Lección: revisar EOL al fijar la baseline.
- **Lección de proceso**: tras un merge de Dependabot, correr `pnpm install` + typecheck/build/test
  ANTES de confiar — un major bump puede pasar el merge y romper igual (CI no siempre cubre todo).

### Embeddings (decisión jun-2026)
- **Modelo único multimodal**: `gemini-embedding-2` vía OpenRouter (una sola key; `EMBEDDINGS_API_KEY`
  cae a `OPENROUTER_API_KEY`). Un solo espacio → cross-modal gratis, sin fan-out.
- **NO cadena de embebedores**: distintos modelos = espacios incomparables (misma dim ≠ mismo espacio).
  La query se embebe con el MISMO modelo que los docs. Fallback de embeddings = reintento mismo modelo
  + degradar, nunca cross-model (cambiar modelo = re-indexar).
- **pgvector: índice HNSW limitado a 2000 dims** para el tipo `vector`. Gemini da 3072 → truncamos a
  **1536 vía Matryoshka** (sin pérdida, mitad de storage); el adapter pide `dimensions: 1536`. Para 3072
  completos habría que usar `halfvec` (indexable hasta 4000).
- Ingestar todo el portafolio (~80k palabras) ≈ **3–5 centavos**. El costo real está en el chat, no acá.
- **Streaming en Hono**: `streamText(...).toTextStreamResponse()` devuelve un `Response` web
  estándar → se retorna tal cual desde el handler de Hono (passthrough hasta el proxy).
- **Degradación verificada**: sin `OPENROUTER_API_KEY`/`OPENROUTER_MODELS`, `/chat` (con key)
  responde cortesía 200, nunca 500. `/health` 200, `/chat` sin `x-agent-key` 401.
