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
- **Sync de esquema (DX tipo Convex)**: híbrido `push` (dev) + `generate`/`migrate` (prod). `db:push`
  (codebase-first: difea schema.ts vs la DB y aplica ALTER directo, SIN migraciones) para iterar en
  caliente; `db:push:watch` lo re-corre al guardar (watcher zero-dep `node:fs.watch` sobre el **dir**
  `adapters/db`, no el archivo → sobrevive a saves atómicos de editores). **`push` solo en dev** y
  contra un **branch de Neon** (es destructivo-ciego: rename = drop+create). `push` necesita
  `dbCredentials.url` en `drizzle.config.ts` (`generate` no) → ahí cargamos el `.env` de la raíz vía
  `dotenv` resuelto por `import.meta.url` (no por cwd).
- **Release step de migraciones en Railway (Docker)**: `railway.json deploy.preDeployCommand`
  (array) corre EN la imagen construida antes de arrancar; si sale ≠0 falla el deploy. La imagen de
  runtime está **podada** (`pnpm deploy --prod`: sin `tsx`/`drizzle-kit` ni `src/`) → el migrate de
  deploy es `node dist/adapters/db/migrate.js` (usa el migrator de `drizzle-orm`, dep de PROD, no
  drizzle-kit). `runMigrations` busca `./migrations` relativo al cwd (`/app`) → el Dockerfile copia
  `migrations/` explícitamente a la imagen (`COPY --from=workspace …/migrations ./migrations`).
- **Telegram: topics en chats privados de bots** — `message_thread_id` aplica "for supergroups and
  private chats of bots with forum topic mode enabled" (verificado context7/doc). Lo leemos en
  `normalize` y la `conversationKey` pasa a `chatId:threadId` → **1 topic = 1 conversación = su propia
  ventana de contexto** (gratis: la unique `(channel, threadKey)` ya lo separa). Hay que pasar
  `message_thread_id` también al **responder** (`sendMessage`/`sendChatAction`) o el bot contesta fuera
  del hilo. Backward-compat: sin topic → clave = `chatId`.
- **Telegram formato HTML > MarkdownV2** — para texto generado por LLM, `parse_mode=HTML` es mucho más
  robusto (solo escapar `< > &`; MarkdownV2 exige ~18 caracteres y se rompe seguido). Aun así el modelo
  puede emitir HTML inválido → el cliente **reintenta sin `parse_mode`** (texto plano) ante no-2xx. Nunca
  rompe. (El corte a 4096 puede partir un tag → mismo fallback.)
- **"Sos Vaio" se leía como apellido** — el voseo "Sos" pegado al nombre confundía al modelo. Fix:
  separar nombre del verbo ("Tu nombre es Vaio. Sos…"). El voseo de Vaio es **valluno (caleño/palmireño)**,
  auténtico, no rioplatense.
- **Owner gating en el adapter, no en el core** — `OWNER_TELEGRAM_ID` se compara en `routes.ts`
  (`isOwnerId`) para setear `trusted`; el core sólo interpreta `trusted`/`channel` → deriva `audience`
  (owner/visitor/public) para el system prompt. Mantiene el core puro (sin env). El perfil **visitante**
  de Telegram NO es mudo: presenta a Kevin con memoria pública (searchMemory + `PUBLIC_SOURCES`).
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

### Primer arranque end-to-end (jun-2026) — gotchas reales
- **`.env` en la raíz no cargaba desde `apps/agent`**: el agente corre con cwd=`apps/agent` (pnpm
  --filter) y `dotenv` busca `cwd/.env`. Solución: `src/load-env.ts` que resuelve `<root>/.env` por
  ruta absoluta vía `import.meta.url` (importado por `config.ts` y `migrate.ts`).
- **Var de entorno vacía (`EMBEDDINGS_API_KEY=`) ≠ ausente**: `??` solo cae en null/undefined, NO en
  `""`. Para el fallback a `OPENROUTER_API_KEY` hay que usar `||`.
- **Embeddings de a UNO, no en batch**: con `input` array, OpenRouter→Google tira **429 "monthly
  spending cap"** (abre el batch en N llamadas y pega contra el cap/rate de su cuenta upstream); el
  input único pasa. El adapter embebe de a uno (más requests, confiable para ingesta puntual).
- **OpenRouter: el array `models` (fallback) admite máx 3**. Más → 400. El adapter capea a 3 y avisa.
- **Cortesía en error de stream**: el error del modelo (400/429) NO se lanza en `result.textStream`
  (termina vacío); llega por el callback `onError`. Para "siempre responde", el core arma el
  `ReadableStream`, setea un flag en `onError`, y si erroró sin emitir nada inyecta la cortesía.
- **OpenRouter sí devuelve HTTP 200 con body `{error:{code,message}}`** (no solo status != 2xx) →
  el adapter de embeddings detecta `!data` + reintenta 429/5xx con backoff.
- **Streaming en Hono**: `streamText(...).toTextStreamResponse()` devuelve un `Response` web
  estándar → se retorna tal cual desde el handler de Hono (passthrough hasta el proxy).
- **Degradación verificada**: sin `OPENROUTER_API_KEY`/`OPENROUTER_MODELS`, `/chat` (con key)
  responde cortesía 200, nunca 500. `/health` 200, `/chat` sin `x-agent-key` 401.

### Observabilidad (jun-2026)
- **pino**: json en prod / pretty en dev (transport `pino-pretty`, devDep); `redact` como red de
  seguridad de secrets; `child({ requestId })` para correlación. La lógica PURA (formato + política
  de redacción) vive en `core/logging.ts`, separada del backend → testeable sin montar pino.
- **Trazas del agente con callbacks de streamText v6**: `onChunk` (chunk `tool-call`), `onStepFinish`
  (`reasoningText`, `toolCalls[].input`, `toolResults[].output`, `model.modelId`, `usage` PLANO),
  `onFinish` (`steps`/`totalUsage`), `onError`. NO acumular `reasoning-delta`: `onStepFinish.reasoningText`
  ya trae el texto completo del "pensamiento". (verificado contra los `.d.ts` instalados, no memoria.)
- **`ai` resuelto = 6.0.200** para `apps/agent` aunque el pnpm store tenga un **leftover `ai@5.0.197`**:
  verificar lo que la APP resuelve (`require.resolve` desde `apps/agent`), no el primer path del store.
- **dotenv v17 imprime un banner a stdout** → `config({ quiet: true })` en `load-env.ts` para no
  romper el stream JSON que lee Railway.
- **`LOG_PROMPTS` boolean gotcha**: `z.coerce.boolean()` convierte `"false"`→`true` (`Boolean("false")`
  es truthy). Usar transform explícito `v === "true" || v === "1"`.

### Proceso: planes durables (plan mode ↔ spec-driven) (jun-2026)
- **Gotcha**: al construir la observabilidad entré en **plan mode**, cuyo workflow propio **reemplaza
  los pasos finales del `brainstorming`** (escribir el plan a `docs/` + `writing-plans`). El diseño
  quedó en el **plan file efímero** (`~/.claude/plans/…`). Hubo que backfillear al proyecto.
- **Regla (OBLIGATORIA, no opcional)**: un plan aprobado **DEBE** quedar escrito en el proyecto.
  Destino = **`docs/superpowers/specs/YYYY-MM-DD-<tema>.md`** (un archivo por feature; ahí se promueve
  el plan de plan mode **o** de `writing-plans` — NO ambos, para no duplicar).
- **Responsabilidades de `docs/` (no solapar):** `SPEC.md` = norte + diseño **fundacional** (fases,
  arquitectura macro, stack); `superpowers/specs/` = **plan completo por feature**; `NEXT-STEPS.md` =
  estado + siguiente paso (+ índice a specs); `LEARNINGS.md` = aprendizajes de dev. (Reemplaza la nota
  previa "SPEC.md único destino" — quedó obsoleta al diferenciar responsabilidades.)
- **Refuerzo**: hook `PostToolUse(ExitPlanMode)` (`.claude/hooks/spec-after-plan.sh`) inyecta el
  recordatorio **obligatorio** vía `additionalContext`. Hace determinístico el *disparo/timing*, NO la
  *acción* (escribir el archivo sigue siendo del modelo) → es recordatorio fuerte, no un gate que
  bloquea (evaluado; frágil). CLAUDE.md/memoria solos son probabilísticos.
- **Confirmado (jun-2026)**: `additionalContext` SÍ se honra en `PostToolUse(ExitPlanMode)` con
  matcher `"ExitPlanMode"` (es una tool real, no un permission dialog) — el recordatorio apareció al
  salir de plan mode. (El claude-code-guide se equivocó diciendo que era `PermissionRequest`.)

### Deploy a Railway (jun-2026) — gotchas
- **Monorepo pnpm: el agente NO bootea sin `@vaio/contracts` compilado**. `routes.js` importa
  `chatBodySchema` (objeto **zod**, valor en runtime, no solo tipo) → necesita
  `packages/contracts/dist/index.js`. El autodetect de Railway (Railpack/Nixpacks) compila solo
  `apps/agent` (`tsc`) y NO corre `pnpm -r build` → `ERR_MODULE_NOT_FOUND` en loop.
- **Solución actual = `Dockerfile` versionado** (Nixpacks quedó deprecado; el autodetect no alcanza).
  Multi-stage: `base` (node:24-slim + `corepack enable`) → `workspace` (`pnpm install --frozen-lockfile`
  + `pnpm -r build`, manifests copiados primero para cachear) → `pruned` (`pnpm --filter @vaio/agent
  --prod --legacy deploy /prod/agent`) → `runtime` (copia solo `/prod/agent`, `CMD node dist/index.js`).
  `railway.json` = `build.builder: "DOCKERFILE"` (sin buildCommand/startCommand: los maneja el Dockerfile).
  Imagen ~259 MB, prod-only. (Antes: `railway.json` con `buildCommand: pnpm -r build` sobre nixpacks —
  funcionaba pero nixpacks está deprecado.)
- **`pnpm deploy` en pnpm 10 exige `--legacy`** (o `inject-workspace-packages=true`): por defecto tira
  `ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE`. Usamos `--legacy` (contenido al paso de deploy) en vez de
  cambiar el linker del workspace, que alteraría el dev local (deps inyectadas = copia dura, no symlink).
  `--prod deploy` copia `@vaio/contracts` con su `dist/` ya compilado como **dir real** (no symlink) →
  el bundle corre sin el resto del monorepo, y excluye devDeps (`pino-pretty`, `tsx`, `vitest`…).
- **`.dockerignore` OBLIGATORIO**: sin él, `COPY . .` mete el `.env` real (secreto) y el `node_modules`
  local en la imagen. Ignora `node_modules`, `dist`, `.env*` (menos `.env.example`), `.git`, `docs`.
- **El "Custom Start Command" del dashboard sobreescribe el `CMD` del Dockerfile → crash en runtime**.
  Quedó un leftover de nixpacks (`pnpm --filter @vaio/agent start`). Correr **cualquier `pnpm`** dentro
  del bundle prod crashea: el bundle (`/app`) NO tiene el campo `packageManager` (solo lo tiene el root)
  → corepack baja **pnpm 11 (latest)**, y el `runDepsStatusCheck` intenta **purgar `node_modules`** y
  aborta sin TTY → `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` en loop. **Fix**: `railway.json`
  `deploy.startCommand: "node dist/index.js"` — config-as-code **siempre gana** sobre el dashboard
  ("Configuration defined in code will always override values from the dashboard"), así que el start
  vuelve a ser node directo (sin pnpm/corepack) sin tocar la UI. Regla general: **el runtime del bundle
  prod NO debe invocar pnpm** (no lo necesita; `node dist/index.js` y listo).
- **`LOG_FORMAT=json` (o `NODE_ENV=production`) en prod**: `pino-pretty` es **devDependency** y el bundle
  prod-only NO lo incluye; el formato `pretty` (default cuando `NODE_ENV !== production`) intentaría
  cargar ese transport → crash. El Dockerfile fija `NODE_ENV=production` + `LOG_FORMAT=json` (doble red;
  `json` no usa transport y lo captura Railway por stdout). Verificado: boot en JSON, `/health` 200,
  `/chat` sin key 401, 0 `ERR_MODULE_NOT_FOUND` (build+run local con Docker antes de pushear).

### Núcleo conversacional + canales + Telegram (iteración 2, jun-2026)
- **`ReadableStream.start()` corre EAGER (al construir, no al primer read)** → podemos derivar `{ stream,
  text }` de UNA sola llamada `streamText`: el `start` consume `result.textStream` una vez, encola al
  `controller` (para HTTP) **y** acumula `finalText` (resuelve la promesa `text` aunque nadie lea `stream`).
  Así Telegram (no-streaming) hace `await text` sin un segundo request al modelo. La persistencia corre en
  el finalizer del `start` como `void persist()` (no bloquea al consumidor; `try/catch` → nunca rompe el turno).
- **`Number("") === 0`** → parsear el CSV de la allowlist de Telegram con `.filter(Boolean)` ANTES de
  `Number`, si no un valor vacío mete un id espurio `0` (lo cazó un test TDD).
- **Mock de streaming del AI SDK v6**: partes `{type:'text-start',id}` → `{type:'text-delta',id,delta}` →
  `{type:'text-end',id}` → `{type:'finish',finishReason,usage}`, vía `convertArrayToReadableStream` de
  `ai/test`. Verificado contra el `.d.ts` de `@ai-sdk/provider@2`, no memoria.
- **Webhook de Telegram**: ACKear **200 rápido** + trabajar en background (Telegram **reintenta** ante
  respuestas lentas o no-2xx → ack inmediato + dedupe por `update_id` + idempotencia en `appendTurn`).
  Doble gate de auth: header `X-Telegram-Bot-Api-Secret-Token` (mismatch → 401) **y** allowlist de user id
  (fuera → 200 sin llamar al modelo). Cliente Bot API = fetch fino (sin dep); sus errores se **loguean, no se
  lanzan** (si no, Telegram reintentaría). El canal `/tg` NO va detrás de `agentAuth` (boundary distinto).
- **Migración conversacional `0001`** (conversations/messages, sin pgvector): `db:generate` la appendea y
  no toca `0000`. Idempotencia del append = unique `(conversation_id, turn_id, role)` + `onConflictDoNothing`.
- **Arnés = módulos puros en `core/`** (`prompt`/`capabilities`/`tools`/`summary`): el cap por canal vive en
  `policyText` + `memoryScope.maxK` (mismo tool set hoy; `sources` queda como seam para capar info privada).
  El registry de tools incluye solo `caps.allowedTools` → sumar una acción futura = nuevo builder + listarla
  en el perfil, sin tocar el core. `Principal` es el seam para permisos por-usuario (hoy solo trusted/no).

### Compresión de contexto (cavemem · iteración 2.1, jun-2026)
- **Adoptar > reinventar (cuando la pieza es chica y MIT):** `@cavemem/compress` (`JuliusBrussee/cavemem`)
  es MIT · TS · **cero deps** y un paquete **aislado** del SQLite/MCP/CLI → se **vendoriza** como
  `packages/compress` (`@vaio/compress`) preservando `LICENSE`+`NOTICE`. La "memoria" sigue siendo la nuestra
  (Neon); solo se adopta el **compresor**.
- **Gotcha de vendoring con tsc (no tsup):** su `lexicon.ts` hacía `import lex from './lexicon.json' with
  { type:'json' }` (import attributes) → con `tsc` plano hay que copiar el JSON a `dist` o, mejor, **convertir
  el JSON a un módulo TS** (`lexicon.data.ts`). Elegimos lo segundo (más limpio para el fork + para extender).
- **Léxico ES y el `\b` ASCII:** las regex de compresión usan `\b` (ASCII). Una entrada que **empieza o
  termina en letra acentuada NO matchea** ("quizá" no; "quizás" sí; "perdón" sí). Acentos **en medio** sí
  (configuración→config matchea: bordes c…n). El ES vive en `lexicon.es.ts` (aislado) y se mergea por
  intensidad con el EN upstream en `lexicon.ts` → el upstream queda prístino.
- **Dos tiers:** Tier 1 = `@vaio/compress` **determinístico, costo cero** sobre lo que va al modelo
  (resumen + turnos históricos + chunks de RAG); Tier 2 = resumen LLM (lossy) solo para **acotar** hilos
  largos. **Comprimir al ENVIAR, no al guardar** (turnos crudos en DB). **NO** comprimir la **query viva**
  (intención) ni la **persona/policy** (voz de Vaio + prompt-caching). Degradación: `Compressor|null`
  (`compressOrRaw`) → texto crudo; `COMPRESS_ENABLED=false` lo apaga.
- **Resolución del paquete:** `@vaio/compress` expone `types`→src (typecheck sin build) y `default`→dist
  (runtime/tests) → su `dist` debe existir para correr/test del agente (lo cubre `pnpm -r build`). 0
  `ERR_MODULE_NOT_FOUND` verificado en boot.
