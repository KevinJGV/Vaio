# Learnings — Vaio

Aprendizajes de **desarrollo** (decisiones no obvias, gotchas, cosas que rompimos-y-arreglamos)
para no repetirlas en próximas sesiones. Una línea por aprendizaje, concreta.

> Esto es la memoria del **dev**. La memoria del **producto** (lo que el agente sabe de Kevin)
> vive en Neon/pgvector — ver `docs/SPEC.md`.

- **AI SDK v6 es beta**: la estable es `ai@5`. El scaffold pineaba `ai@^4`, que choca con
  `@openrouter/ai-sdk-provider@1` (peer `ai@^5`). Fijado `ai@^5` (instaló 5.0.197). Para un
  servicio always-on vamos con la estable, no la beta.
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
  alinear el `$schema` URL con la versión instalada o tira un info de "biome migrate".
- **Streaming en Hono**: `streamText(...).toTextStreamResponse()` devuelve un `Response` web
  estándar → se retorna tal cual desde el handler de Hono (passthrough hasta el proxy).
- **Degradación verificada**: sin `OPENROUTER_API_KEY`/`OPENROUTER_MODELS`, `/chat` (con key)
  responde cortesía 200, nunca 500. `/health` 200, `/chat` sin `x-agent-key` 401.
