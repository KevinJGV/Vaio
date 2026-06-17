# Learnings — Vaio

Aprendizajes de **desarrollo** (decisiones no obvias, gotchas, cosas que rompimos-y-arreglamos)
para no repetirlas en próximas sesiones. Una línea por aprendizaje, concreta.

> Esto es la memoria del **dev**. La memoria del **producto** (lo que el agente sabe de Kevin)
> vive en Neon/pgvector — ver `docs/SPEC.md`.

- **✅ RESUELTO en Inc 1 del cluster (2026-06-17, rama `feat/fact-lifecycle-judge`) — cercanía vectorial ≠
  contradicción.** El fix = **opción B**: un puerto `ConflictJudge` (LLM, `generateObject`, modelo de chat) que,
  dados el statement nuevo + los candidatos cercanos, decide por cada uno `contradicts`/`duplicate`/`coexists`/
  `unsure` (emite ORDINALES, el sistema mapea a uuids — Inv #8). Compartido por AMBOS caminos (curate determinístico
  + rememberFact conversacional → un solo criterio). En `curate`: coexiste→commit (NADA pending, **fix pasta/fútbol**),
  contradice→commit con supersedes (invalida el viejo, **visible**), duplicado→reject. + **middleware-siempre**
  (aunque el tipo no aprenda, si la respuesta contradice un vigente → `invalidate`). + **atomicidad** (`FactDecomposer`
  reemplaza al `FactDrafter`: descompone en facts mono-idea ANTES de juzgar — un statement compuesto se embebía en un
  vector difuso y el juicio por-idea era imposible; **lección durable**). + **desaprender** (`FactStore.invalidate`
  bi-temporal + tool `unlearnFact`). + **juicio sin cabos sueltos** (se traen TODOS los del umbral hasta
  `FACT_CONFLICT_MAX`, cap logueado; el viejo `LIMIT` pasó a presentación "+N más"). Specs
  `2026-06-17-fact-lifecycle-{design,plan}.md`. Conservador (ante duda → coexiste, NUNCA invalida por error). El
  texto crudo va al juez (no perder el "ya no…" que la redacción borra). **Diferido a Inc 2:** hilo-puntero.
  **Dos lecciones de los e2e de Kevin (2026-06-17):** (1) **tests fake-based de facts = query-bugs e2e-only:** un
  `ne(facts.id, "")` (excludeId vacío) casteaba "" a uuid y Postgres lanzaba; los unit tests (fake con substring JS,
  sin tipo uuid) no lo cazaron → fix `excludeId` opcional. La cobertura por fake no ve errores de SQL/tipo; ojo con
  eso al tocar queries. (2) **el `kind` de la escalada gateaba mal la curación:** describe la pregunta del VISITANTE,
  pero la respuesta del OWNER es info suya, confiable → gatear por `kind` (claim/contact no aprenden) descartaba
  hechos durables de Kevin (la "tarta" se perdía, solo se invalidaba la pasta). Fix: curación **unificada** — aprende
  siempre, gateada solo por el decomposer (filtra no-factual/sensible) + veto; el `kind` solo para el framing.
  *(Diagnóstico original, conservado:)*

- **Curación auto de escaladas — cercanía vectorial ≠ contradicción** (gotcha jun-2026, caso e2e pasta/fútbol;
  DIFERIDO al cluster "ciclo de vida del fact" por decisión de Kevin — apuntado, NO parcheado, para hacerlo bien
  con bases). La curación automática (`adapters/telegram/escalation-inbound.ts` → `curate`) trataba
  `factStore.propose().conflicts.length > 0` como **contradicción real** → dejaba el fact en `pending` + le avisaba
  a Kevin "Eso choca con algo que ya sabía". PERO `neon-facts.ts` `findNearConfirmed` devuelve **candidatos CERCANOS
  por coseno** (umbral `conflictDistance`, "generoso a propósito" — comentario en el código), cuyo juicio de
  contradicción el diseño **delega al MODELO** (flujo conversacional `resolveFact`/`rememberFact`), no son
  contradicciones. **Caso real:** «A Kevin le gusta la pasta» se marcó en conflicto con «…el fútbol» (vecino
  vectorial por el patrón "le gusta X", sin relación temática) → 2 corridas del e2e dejaron **2 facts de pasta
  colgados en `pending`**; al consultarlos, el flujo conversacional ofreció "¿reemplazo el fútbol, coexisten, o
  descarto?" (ruido por el falso candidato). **Diagnóstico:** la curación auto hace una versión ROTA del
  "middleware de conflicto" que Kevin pidió. **Fix correcto (al retomar el cluster):** (A) commitear siempre
  (coexisten — correcto para gustos/datos ADITIVOS; difiere el juicio y acepta una fuga acotada), o (B —
  recomendado, el núcleo del middleware) un **juicio LLM** que, dados los candidatos cercanos, decida cuáles
  REALMENTE contradice → `commit` con `supersede(contradichos)`, coexisten los demás; + **dedup de duplicados
  exactos** (dist≈0, evita 2 «pasta» idénticos). El caso común es aditivo → coexistir es lo correcto; la
  contradicción real (cambió de trabajo, "ya no le gusta X") es menos frecuente y se resuelve con el juicio + el
  hilo-puntero + desaprender. Hasta el cluster, el bug persiste (decisión consciente de Kevin). Ver el cluster en
  `NEXT-STEPS.md`. Aparte: limpiar los 2 `pending` de pasta del e2e (data sucia: `reject` conversacional o DELETE manual).
- **`openrouter/free` NO sirve para VISIÓN** (gotcha real jun-2026): el "free router" rota entre TODOS los
  modelos gratis que aceptan la modalidad, y el pool de imagen incluye modelos que **aceptan imágenes pero no
  describen** — p.ej. `nvidia/nemotron-3.5-content-safety:free` (moderación): devolvió `User Safety: unsafe /
  PII/Privacy` como "descripción" → el chat se negó a analizar la foto. La vez anterior el router cayó en
  `gemma-4` (bien); el resultado es **no determinista**. Fix = **fijar VLMs concretos** en `VISION_MODELS`, no
  el router: gratis confiables = `google/gemma-4-26b-a4b-it:free` / `gemma-4-31b-it:free` /
  `nvidia/nemotron-nano-12b-v2-vl:free`; o `google/gemini-2.5-flash-lite` (barato) + free de respaldo. El log
  `media.vision` (con `response.modelId`) fue lo que permitió diagnosticarlo en una línea.
- **OpenRouter — API surface real + cómo encontrarla** (verificado jun-2026, openapi.json): la **fuente
  autoritativa es `https://openrouter.ai/openapi.json`** (parsear con node; WebFetch lo trunca). La doc web es
  JS-rendered (404 al fetchear). ⚠️ `GET /api/v1/models` por default lista **solo texto** (337) → NO inferir
  cobertura de modalidades de ahí (me hizo afirmar MAL que "OpenRouter no tiene rerank/speech"). El README del
  `@openrouter/ai-sdk-provider` solo refleja lo que el *package* envuelve (chat/embeddings/image/video), NO la
  plataforma. **OpenRouter SÍ expone por REST OpenAI-compatible:** `POST /audio/transcriptions` (STT),
  `POST /audio/speech` (TTS, mp3|pcm), `POST /rerank`, `/embeddings`, `/videos`. El provider del AI SDK no los
  envuelve → **llamarlos con `fetch`** a `https://openrouter.ai/api/v1` + `Bearer key` → Vaio single-provider.
  Slugs/precios: galería openrouter.ai/models (tabs por modalidad; cambian mensual). Memoria: `openrouter-api-surface`.
- **Multimodal fase 2 — endpoints REST de OpenRouter validados e2e** (jun-2026): STT `POST /audio/transcriptions`
  (`{model, input_audio:{data:base64, format}, language}→{text}`) y TTS `POST /audio/speech`
  (`{model, input, voice, response_format:mp3|pcm}→bytes`) funcionan con `fetch` directo (el provider del AI SDK
  no los envuelve). Round-trip real OK: `hexgrad/kokoro-82m` (voz `af_bella`/`af_heart`/`am_adam` — **NO "alloy"**,
  la voz es por-modelo) → mp3 → `whisper-large-v3` (el STT más barato; también whisper-1, gpt-4o(-mini)-transcribe).
  Gotcha: los modelos de la tab "Speech"/"Transcription" NO salen en `GET /models` ni en `?output_modalities=audio`
  (eso da chat-con-audio gpt-audio + música lyria) → elegir en la galería. TTS=mp3 → Telegram `sendAudio` (no
  `sendVoice`, que exige OGG/Opus). Decisión de hablar = policy pura `shouldSpeak` (espejo voz-in OR pedido explícito).
- **TTS — fallback es CLIENT-SIDE y por-modelo** (jun-2026): `/audio/speech` NO acepta el array `models` de
  fallback server-side (eso es solo de `/chat/completions`). Y **voz + response_format son por-modelo, no
  portables**: `hexgrad/kokoro-82m`→`af_bella`/mp3; `google/gemini-3.1-flash-tts-preview`→`Zephyr`/**pcm-only**
  (rechaza mp3). ⇒ cadena `SPEECH_MODELS=model|voice|format,…` probada client-side (1ª con audio gana → si no,
  texto). **pcm hay que envolverlo en WAV** (Telegram no reproduce pcm crudo): header de 44 bytes,
  **24000 Hz mono 16-bit** (verificado e2e: 192000 bytes=96000 samples=4.0s @24kHz, coincide con la duración;
  a 16kHz daría 6s). Round-trip gemini-pcm→WAV@24k→whisper transcribe bien → rate correcto.
- **Multimodal (AI SDK v6) — decisión nativo-vs-normalizar por CONFIG, no por sniffing**: el core recibe un
  `LanguageModel` opaco y OpenRouter capa la cadena a 3 modelos server-side (`extraBody.models`) → el core NO
  sabe cuál respondió ni si soporta visión. Por eso la decisión se lee de config (`MULTIMODAL_NATIVE_IMAGES`)
  y cada modalidad tiene su modelo EXPLÍCITO (`VISION_MODELS`/`TRANSCRIBE_MODELS`; sin cadena compartida ni
  fallback al chat) — así la cadena de chat (barata/free) no tiene que ser vision-capaz y el invariante
  "siempre responde" no depende de visión.
  Parts en v6: `UserContent = string | Array<TextPart|ImagePart|FilePart>`; `FilePart {type:"file", data:
  Uint8Array, mediaType}` sirve para audio Y imagen (un solo modelo cubre ambos vía `generateText`). Si el
  content termina todo en texto, devolver **string** (no array) preserva el camino actual + prompt-caching.
- **Multimodal — gotcha de persona/prompt (followup)**: con la visión funcionando, Vaio igual respondía "yo
  solo proceso texto / no tengo visión" (el system prompt en `prompt.ts` asume text-only). La capacidad está;
  el copy no la refleja → desacoplar al hacer los followups de grounding. El mecanismo (imagen→descripción→
  respuesta grounded) funciona; es solo el framing de la persona.
- **Compresión cavemem — ahorro REAL marginal en este corpus** (medido e2e jun-2026): RAG (`full`)
  ~3.5%, conversación (`lite`) ~0.6%. El benchmark del paquete (≥30%) es sobre prosa inglesa con filler;
  el corpus real (CV/portfolio/GitHub) es **denso/factual** → casi todo se preserva byte-a-byte (listas de
  tech, fechas, IDs, headings, URLs). La compresión **funciona y no degrada** persona/calidad (es ahorro
  "gratis", sin LLM), pero el gran ahorro vendría de comprimir **en ingesta** o cuando las charlas crucen
  `SUMMARY_THRESHOLD` (12). Gotcha de observabilidad: el ahorro de RAG era **invisible** (solo `agent.ts`
  logueaba conv); se agregó el log `"rag compressed"` en `tools.ts` para poder confirmarlo.
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
- **System prompt: VOZ ≠ HECHOS (bug de inercia, jun-2026)**. Vaio afirmó que Kevin es "caleño/sigue
  fútbol" SIN consultar `searchMemory`. Causa: `prompt.ts` hardcodeaba el origen + un causal "Sos caleño
  **por eso** hablás voseo" → proyectó la persona de Vaio como HECHO sobre Kevin, y la instrucción de
  consultar era demasiado blanda para sobreescribir esa "verdad de fondo". Regla (verificada con fuentes,
  29/31 claims): el prompt lleva SOLO rol/voz/política/grounding; los **hechos de dominio** de Kevin van a
  la memoria y entran por la tool. Matiz honesto: NO es "ningún dato en el prompt" (Anthropic critica
  hardcodear *lógica*, no *datos*; los rasgos de voz/identidad son señal cultural legítima) — la regla es
  "sin **hechos de dominio consultables**". Followups completos → `NEXT-STEPS.md`.
- **Grounding: constraint de FUENTE > exhortación** (OpenAI prompt-guidance): "respondé sólo con lo que
  devuelva searchMemory" funciona; "no inventes" solo es débil. Pero **no sobre-imperar** ("DEBES SIEMPRE"
  en mayúsculas) → los modelos modernos sobre-disparan tools (costo). Frasear condicional + excluir saludos.
- **Retrieval NO es bala de plata (claim refutado en el research)**: la evidencia reciente muestra que los
  modelos de alta capacidad **resisten** lo recuperado y que el retrieval introduce sus propios conflictos
  — no asumir que "agregar RAG" hace que el modelo prefiera el hecho fresco sobre uno rancio del prompt.
  Corolario: no meter hechos rancios/falsos en el prompt, y **adjudicar validez al INGERIR** (write-side,
  bi-temporal estilo Graphiti/Zep), no esperar a desempatar en query-time (paper STALE).
- **Prompt caching: hoy NO está activo** aunque `SPEC.md` lo asumía. `openrouter.ts` no setea `cache_control`
  y el resumen rodante va dentro del string `system` (lo invalida; orden de cache = tools→system→messages,
  un cambio invalida todo lo posterior). La persona es corta (< ~1024 tok mínimo) → cachearla sola no rinde;
  el quick-win es cachear **tool defs + bloque estable** (se reusan en los ~5 steps/turno) y partir el system
  en {estable, volátil}. Vía OpenRouter: `providerOptions.openrouter.cacheControl`. v6 idiomático = `instructions`
  top-level; meter `system` como messages exige `allowSystemInMessages` (+ ojo inyección, /chat es público).
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
- **Regla (OBLIGATORIA, no opcional)**: un plan aprobado **DEBE** quedar escrito en el proyecto como
  **DOS artefactos** por feature (misma `YYYY-MM-DD-<tema>`): `…-design.md` (técnico, bajo nivel:
  arquitectura/firmas/DDL/edge-cases) + `…-plan.md` (alto nivel: fases/secuencia + sección "Estrategia
  de ejecución"). Distinta altitud, **sin duplicar** contenido. (Refinó la nota previa "un solo archivo /
  NO ambos", ya obsoleta — design y plan son complementarios, **los dos van**.)
- **Responsabilidades de `docs/` (no solapar):** `SPEC.md` = norte + diseño **fundacional**;
  `superpowers/specs/<tema>-design.md` = diseño técnico por feature; `superpowers/specs/<tema>-plan.md` =
  plan alto nivel + estrategia de ejecución; `NEXT-STEPS.md` = estado + siguiente paso; `LEARNINGS.md` =
  aprendizajes de dev.
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
- **⚠️ NO comprimir el RAG — el compresor es para PROSA, mutila código y degrada grounding** (2026-06-15,
  causa raíz del followup "corrupción de texto en searchMemory"): `searchMemory` comprimía cada chunk
  recuperado (`compressOrRaw(compressor, chunk, "full")`) antes de inyectarlo al modelo. cavemem está
  diseñado para **prosa** y hace dos cosas que **destruyen el contexto RAG**: (1) borra **artículos ES *y EN***
  (`el/la/los` + `a/the`) → `(a) => a.name` quedaba `() =>.name` y `le gusta el fútbol` quedaba `le gusta
  fútbol`; (2) borra **espacios antes de puntuación** (`collapseWhitespace`) → `artist ?? []` quedaba
  `artist?? []`. Los chunks `repo:*` son **código crudo sin fences** → el tokenizer (solo protege ```` ``` ````
  e `` `inline` ``) los trata como prosa → mutila operadores/nombres. **Era corrupción REAL de la data que ve
  el modelo** (verificado en `trace_events`, no artefacto de log), envenenando el grounding de facts y del
  propio código. **Diagnóstico:** el reranker quedó exonerado (solo devuelve `index`/`score`, jamás texto); el
  diferenciador con `recentActivity` (que no corrompe) era **que searchMemory comprimía y recentActivity no**.
  **Fix:** el contexto recuperado va al modelo **VERBATIM** (se quitó la compresión de RAG + su plumbing:
  `ragIntensity`, `COMPRESS_INTENSITY_RAG`, `ActionContext.compressor`). Costo: +~3.5% tokens — **despreciable**
  y ya sabido que no es la palanca de costo (memoria `compression-savings-marginal`). **Regla:** comprimir RAG
  es un trade negativo (fidelidad de grounding ≫ 3.5%); la compresión queda **solo** para el contexto
  conversacional (resumen + turnos), que es prosa real.

### Integridad documental — workflow anti-drift (jun-2026)
- **Por qué los docs se pudren**: mezclar historia+estado+futuro en un mismo lugar (las frases "a futuro"
  caducan), duplicar el mismo hecho en varios docs, hardcodear lo derivable (conteos de tests), y depender
  de que el agente "se acuerde" de reconciliar. Pasó de verdad (CLAUDE.md decía "Fase 1 en scaffold" y
  NEXT-STEPS marcaba "← SIGUIENTE = Portafolio", ambos falsos).
- **Cura estructural (el 80%)**: **una sola fuente de verdad del estado = `NEXT-STEPS.md`** (bloque
  "ESTADO ACTUAL (fecha)" + lista WIP "🚧 En proceso/verificación" con estados `[ ]/[~]/[?]/[x]` +
  "Historial" inmutable). `SPEC`/`CLAUDE.md` no llevan estado volátil → apuntan a NEXT-STEPS. **Gate al
  cambiar de foco**: reconciliar el WIP ANTES de arrancar lo nuevo (que nada quede suelto).
- **Red automática (subconjunto verificable)**: `scripts/check-docs.sh` (en CI) caza links de specs rotos
  + contradicción "Fase 1 scaffold con core existente" (FALLA) y avisa staleness de la fecha + WIP abierto.
- **Hooks = timing, no contenido**: `SessionStart` (ritual de reconciliación) + `UserPromptSubmit`
  (`wip-reconcile.sh`: avisa SOLO si hay WIP abierto → no ruidoso). Gotcha bash: `grep -c` imprime `0` y
  sale 1 → NO uses `|| echo 0` (duplica); capturá `open=$(grep -c …)` y `open=${open:-0}`.
- **Límite honesto**: ninguna automatización valida si "el próximo paso es correcto" o si la prosa refleja
  la intención. Eso es criterio + minimizar la superficie que puede pudrirse. Hooks/CI = red fina, no la cura.

### Harness de tools — registry de acciones + seam HITL (jun-2026)
- **HITL nativo del AI SDK v6** (verificado con context7, `ai@6.0.0-beta.128`): una tool **sin** `execute`
  (con `outputSchema`) hace que el SDK NO la ejecute y requiera confirmación humana. Es el **camino de upgrade**
  para el seam HITL **async** (confirmación/notificación/reanudación) cuando llegue la 1ª write-action. Hoy el
  seam es **delgado** (deny path con traza, sin async): el descriptor declara `sideEffecting`/`clearance` y esos
  serán los disparadores del flujo nativo a futuro.
- **Gating de 2 capas** (`core/actions/registry.ts`): (1) **canal OCULTA** vía `caps.allowedTools` — si el canal
  no la tiene, la tool ni entra al `ToolSet` (el modelo no la ve); (2) **principal DENIEGA** — si no cumple el
  `clearance` del descriptor, la tool SÍ se expone pero su `execute` deniega limpio y emite
  `tool.result {ok:false, denied:true}`. Distinguir en la traza: `denied:true` = denegación de permiso;
  `ok:false` sin `denied` = fallo de ejecución.
- **Descriptor con `build(ctx): Tool`** (no `inputSchema`/`execute` planos): el helper `tool()` liga el
  `inputSchema` (zod) al tipo del input de `execute` por inferencia; un descriptor genérico con schema `unknown`
  perdería ese typing. Encapsular la construcción en `build` mantiene el typing **por-tool** y deja el registry
  agnóstico (solo `name` + metadata de gating + `build`).
- **`buildTools(ctx, actions = ACTIONS)`**: el 2º parámetro (registry inyectable) permite **testear el deny path**
  con un descriptor owner-only de prueba, sin tener que enviar una write-action real. En prod siempre usa `ACTIONS`.

### saveFact (curación) + HITL persistido + facts bi-temporal (jun-2026)
- **HITL estructural con 2 tools (`proposeFact`→`commitFact`)**: la confirmación humana no es solo convención
  del prompt — `commitFact(id)` exige el id de una propuesta **pending real** (`neon-facts` valida
  `status='pending'` antes de actuar). Un fact **no se fabrica inline**: hay que proponerlo (persiste fila
  pending) y recién confirmarlo. La propuesta persistida es lo que sobrevive al corte de charla (Nivel B): se
  retoma cargándola al system prompt el próximo turno del owner.
- **Tabla `facts` bi-temporal, motor mínimo**: una sola tabla con `status` (pending/confirmed/rejected) +
  valid time (`valid_at`/`invalid_at`) + transaction time (`created_at`/`expired_at`). El motor de hoy solo
  ejerce `pending→confirmed` + `valid_at=now`; **invalidar = marcar `invalid_at`, NUNCA borrar** (paper STALE /
  Graphiti-Zep). El esquema completo desde día 1 evita retro-ajustar; dedup/adjudicación de conflictos = futuro.
- **`searchMemory` mergea `documents`+`facts` con `unionAll`** ordenado por `cosineDistance` (el modelo ve UNA
  memoria; un fact entra como `{source:"fact"}`). Gotcha Drizzle: ordenar por la columna `dist` de una subquery
  `unionAll` no tipa → usar `orderBy(asc(sql\`dist\`))`. El `order by ... limit k` va sobre el UNION (ranking
  global), no por rama.
  - **Nota de performance (futuro):** el patrón actual calcula la distancia sobre TODA la tabla antes del
    `limit` externo → no aprovecha el índice HNSW para top-k. Trivial con el corpus actual (~decenas de filas);
    si `documents`/`facts` crecen a miles, migrar a `ORDER BY ... LIMIT k` por rama antes de unir.
- **⚠️ Orden migración↔código (deploy)**: `searchMemory` ahora referencia la tabla `facts`. Si el código nuevo
  corre contra una DB SIN la migración `0004` aplicada, cada `searchMemory` tira (`relation "facts" does not
  exist`) → degrada limpio (la tool tiene try/catch → cortesía, la invariante "siempre responde" se mantiene)
  **pero el RAG entero queda ciego** (no solo facts, también documents). El `railway.json preDeployCommand`
  (`db:migrate:prod`) garantiza el orden en deploy normal; el riesgo real es un **rollback del código sin
  rollback de la migración** o un dev contra DB sin migrar. Migrar SIEMPRE antes de desplegar el código nuevo.

### Observabilidad de fallos silenciosos (jun-2026)
- **Patrón `degraded`**: TraceEvent nuevo `{component, reason, detail?}` para fallos **NO-fatales** (el turno sigue,
  pero un componente accesorio falló) — distinto de `turn.error` (turno roto) y `tool.result`. `reportDegraded`
  (core/observability.ts) lo **emite**; el sink (toLogRecord) lo loguea (nivel error, para que resalte) y lo
  persiste en `trace_events`. **Clave de diseño:** NO duplicar log + emit — `emit` YA loguea vía el sink stdout
  (toLogRecord). `reportDegraded` solo emite; el log sale del sink. (El plan original tenía un `logger.warn`
  redundante; se quitó al ver que el sink ya loguea todo TraceEvent.)
- **Núcleo puro reporta vía callback:** `core/modality.ts` (sin logger/emit por diseño) recibe un `onDegrade(d)`
  que `agent.ts` cablea con `reportDegraded({emit, ids})`. El core queda agnóstico. **Distinción honesta:** puerto
  `null` (off por config) NO es degradación → no se reporta; solo un `throw` real (fallo) dispara `onDegrade`.
- **`detail` redactado** según `LOG_PROMPTS` (puede traer body de error); `component`/`reason` siempre visibles.
- **Doble registro deliberado:** el adapter (media-openrouter) loguea el detalle técnico (status+body) en el punto
  del fetch; el core emite el `degraded` semántico. Dos niveles de la misma causa, no ruido.
- **🔎 La observabilidad DIAGNOSTICÓ un bug real al instante (2026-06-14):** un audio por Telegram fallaba la
  transcripción sin rastro. Con el fix, el log reveló `transcribe failed status:400 "Model
  openai/whisper-large-v3-turbo,google/chirp-3,... does not exist"`. **Causa:** `TRANSCRIBE_MODELS` se configuró
  como **lista CSV** de modelos, pero el endpoint `/audio/transcriptions` espera **UN solo modelo** (a diferencia
  de `VISION_MODELS`/`SPEECH_MODELS`, que SÍ son cadenas con fallback) → OpenRouter rechaza la cadena entera.
  **Follow-up pendiente:** o el transcriber soporta cadena de fallback (como vision/speech), o se valida/documenta
  que `TRANSCRIBE_MODELS` es un único modelo. (Bug aparte del de observabilidad; ver NEXT-STEPS.)

### Fallback uniforme en los env de modelos (jun-2026)
- **Dos tipos de fallback según el endpoint:** el **chat** (`OPENROUTER_MODELS`, `VISION_MODELS`, `SUMMARY_MODELS`)
  usa el fallback **server-side** de OpenRouter (se le pasa la cadena `models[]` y él rutea). Los endpoints REST
  **single-model** (`/audio/transcriptions` = `TRANSCRIBE_MODELS`, `/audio/speech` = `SPEECH_MODELS`) NO tienen
  ese fallback → el adapter hace **fallback CLIENT-SIDE** (prueba cada modelo en orden hasta que uno responde).
- **El bug que lo destapó:** `TRANSCRIBE_MODEL` (singular, viejo) hacía `.trim()` y mandaba la cadena CSV ENTERA
  como un solo `model` → OpenRouter `400 "Model a,b,c does not exist"` → TODO audio fallaba. Lo expuso la
  observabilidad (`degraded`/`transcribe failed` con el status). Fix: `transcribeChain` = csv + loop en el adapter.
- **`EMBEDDINGS_MODEL` NO lleva fallback (a propósito):** la query debe embeberse con el MISMO modelo que indexó
  los documentos; mezclar modelos da vectores incompatibles (distancia coseno sin sentido). Cambiarlo exige
  reingestar. Es la excepción correcta, no un olvido.
- **Convención:** env que aceptan cadena = **plural** (`*_MODELS`); el único modelo = **singular** (`EMBEDDINGS_MODEL`).

### Ingesta de fuentes CRUDAS de repos — "Vaio se nutre solo" pasos 1+2 (jun-2026)
- **`z.coerce.number().default()` NO protege contra string vacío en `.env`.** `Number("")` es `0`, y `.default()`
  solo aplica a `undefined` → una var **presente pero vacía** (`RAW_FILE_MAX_BYTES=`) coerce a `0` → falla
  `.positive()` → `loadConfig` tira y la ingesta NO arranca. **Lo destapó el e2e** (no los unit tests, que pasaban
  `Env` parcial sin pisar el schema real). **Fix:** helper `positiveIntWithDefault(def)` con `z.preprocess(v => v
  === "" ? undefined : v, …)` → vacío cae al default. ⚠️ Mismo patrón latente en otros caps (`MEDIA_MAX_BYTES`,
  `SUMMARY_THRESHOLD`…): si alguna vez se ponen vacías en `.env`, romperían igual. Test de regresión en `config.test.ts`.
- **`source = "repo:<owner>/<repo>"`** (un source por repo) → `clearSource` idempotente POR repo (reingesta uno
  sin tocar los demás); el prefijo `repo:` evita colisión con el collector `github` (que guarda solo descripciones).
  `url` = blob URL del archivo → procedencia clickeable. Entra al RAG por el `unionAll` de `searchMemory` sin tocar el core.
- **Seguridad en 2 capas (Invariante #5):** (1) filtro por PATH (`.env*`/`*.pem`/`*.key`/lockfiles, salvo
  `.env.example` whitelisted) descarta los contenedores obvios ANTES de bajarlos; (2) `scanSecrets` sobre el
  CONTENIDO bajado (alto-recall) → **SKIP del archivo entero (no redact)**: redactar deja el riesgo de un patrón no
  cubierto. Falsos-positivos cubiertos: `.env.example` real, `process.env.X`, placeholders.
- **Chunking por tipo:** prosa (`.md/.txt`) reusa `chunkText` (corte por palabra); código usa `chunkCode` (corte por
  LÍNEA + overlap de líneas, anti-loop con `start = max(end - overlap, start+1)`). Cada chunk lleva header de
  procedencia (`// repo · path · lang`) — load-bearing para el recall (inyecta path/lang al espacio de embeddings).
- **GitHub API (verificado context7):** Trees recursive (`?recursive=1`, acepta branch como `tree_sha`, `truncated`
  a 100k entries/7MB) + Contents raw (`Accept: application/vnd.github.raw+json`, sirve hasta 100MB, sin base64).
  Best-effort por repo Y por archivo (404/privado/binario no rompen el resto). Cap `maxChunksPerRepo` con log de descartes.
- **Paso 3 (acceso on-demand como read-action del harness) quedó fuera** — su propio incremento; reusa toda esta
  maquinaria (collector/filtros/secret-scan/chunker/githubRaw). Ver `NEXT-STEPS.md` §"Vaio se nutre solo".
- **⚠️ NUNCA sincronizar en el HOT PATH del turno — el freshness gate va SIEMPRE en background** (2026-06-15, causa
  raíz del Followup ② "latencia 183s"). El gate de `searchMemory` (`ensureFresh`) corría un sync **inline** si el
  repo estaba stale; re-embeber es **secuencial** (de a uno, por el cap de 429 upstream → ver §Embeddings) → hasta
  20 archivos × varios chunks × ~1-3s **bloqueó la respuesta 183s** (un solo outlier; el baseline de `searchMemory`
  es ~7-10s = embed query + pgvector + rerank). Diagnóstico **por eliminación**: el exceso de 176s solo podía venir
  del gate (todo lo demás está acotado en los otros turnos). **Fix:** `ensureFresh` **siempre** dispara el sync en
  background (`void guardedSync`) y responde con el índice actual; la frescura llega al próximo turno. **Principio
  (nota de Kevin):** trabajo largo NO es malo si (a) NO bloquea al usuario y (b) hay mecanismo de notificación/retoma
  (turnos proactivos / Nivel C, estilo Claude Code); lo inaceptable es bloquear sin feedback o el descuido técnico.
- **✅ Embed FUERA de la transacción en `replaceFile`** (2026-06-15, HECHO). Antes el `embedder.embed()` corría
  **DENTRO** de la `db.transaction` → retenía una conexión del pool (`new Pool` sin `max` = **10** default) durante
  toda la red del embedding (lenta, secuencial) → contención con el RAG del turno y otros syncs. Ahora: **embebés
  ANTES** (si falla, lanzás sin tocar la DB → nada a medias) y la **tx queda CORTA**: solo `delete`+`insert`
  atómicos. Misma semántica (atomicidad + safety ante fallo de embed), sin retener el pool durante la red. Test
  unitario con `db`/`embedder` fakes (afirma embed-antes-de-tx + embed-falla→no-toca-DB); e2e: re-embed forzado de
  1 archivo vía el bg sync → blob_sha/chunks/contenido intactos. El pool sigue sin `max` explícito (default 10); no
  hizo falta tocarlo tras sacar el embed de la tx.
- **✅ Embeddings con CONCURRENCIA ACOTADA (no 1-por-1)** (2026-06-15). El bg sync era lento (~12s/archivo → 15
  archivos = ~3min) porque `embed(texts)` los pedía **secuencialmente**. Distinción clave (verificada con context7):
  el 429 que obligaba a NO batchear es del **batch `input` array** del modelo gemini (OpenRouter→Google) — NO un
  límite de requests concurrentes. Fix: `embed()` corre `concurrency` workers (default **4**, env `EMBED_CONCURRENCY`)
  sobre un cursor compartido, input ÚNICO por request, **orden preservado** (`out[i]`); el backoff de `postWithRetry`
  cubre 429 transitorios. e2e: 12 archivos en **~12s** (vs ~140s secuencial, ~10×), **0 errores 429**. Mejora futura
  (no hecha): honrar el header `Retry-After` del 429 (hoy backoff exponencial fijo).
- **Frescura de repos = maintenance SILENCIOSA (no la narra el modelo)** (2026-06-15). Vaio metía "el repo se está
  poniendo al día" en respuestas no relacionadas + chequeaba `checkRepoFreshness` en cada turno. Insight: el **gate
  determinístico** de `searchMemory` YA dispara el bg sync solo → el modelo NO necesita chequear para mantener
  frescura; `checkRepoFreshness` es solo para RESPONDER "¿estás al día?". Prompt (ES+EN) + descripción de la tool:
  usar `checkRepoFreshness` **solo si preguntan explícitamente** por frescura; nunca narrar el sync en respuestas
  normales. e2e: "qué stack usás" → solo searchMemory, sin narrar; "estás al día?" → checkRepoFreshness. Encaja con
  el Invariante #9 (no marear al modelo con orquestación que el sistema ya maneja).
- **⚠️ Followup de la silenciosa: el SISTEMA debe INFORMAR la staleness, no solo gestionarla en silencio**
  (2026-06-15, lo cazó Kevin: "el agente no se fijó si sus conocimientos estaban frescos"). La silenciosa
  **sobrecorrigió**: como el gate es **background**, el turno actual responde del índice **pre-sync**; y al quitarle
  al modelo el chequeo proactivo, **nada le avisaba que estaba atrás** → Vaio respondía confiado con info un toque
  vieja, sin flaggear. Diagnóstico por timing: turno 16:38 → el bg sync del gate completó 16:40 (después). Fix: el
  gate (`ensureFresh`) devuelve **`behind`** (algún repo recuperado estaba stale / sync en vuelo); `searchMemory`
  antepone una **`[nota del sistema: … está un poco atrás …]`** al output; el prompt le dice al modelo que sea
  HONESTO si ve esa nota (avisar al pasar que puede faltar lo MUY reciente, sin drama). Sistema **detecta + informa**;
  el modelo no orquesta (#9), no bloquea (#1). e2e: índice forzado stale → Vaio flaggea "se estaba actualizando…
  puede que algún cambio muy reciente aún no lo tenga" + self-heal. **Lección:** "silencioso" ≠ "opaco" — gestionar
  algo en background NO exime de informarle al usuario su estado (mismo espíritu que `long-tasks-ok-if-notify-not-blocking`).
- **Capa de detectores de conocimiento disponible — generaliza el `behindNote`** (2026-06-15, 1er incremento de la
  visión "IA omnisciente"; lo destapó el caso ACME: Vaio se conformó con la descripción del conector github sin
  avisar que existía el repo `KevinJGV/ACME` sin indexar). **Insight:** 2 tipos de conocimiento — CONTENIDO (lo que
  searchMemory trae) y SEÑALES de disponibilidad (lo que existe pero no está cargado/está atrás/es metadata). Puerto
  `KnowledgeDetector` + `DetectorRegistry`: searchMemory **delega** (su único fin = contenido) y antepone las notas;
  el freshness gate se **extrajo** a un `FreshnessDetector` → searchMemory quedó **más limpio**. `UnindexedRepoDetector`
  (caso ACME): query matchea un repo del owner no indexado → nota "learnRepo X". **Separación, no amalgama**: sumar
  una fuente = sumar un detector (unidad chica), sin tocar searchMemory/learnRepo. **Gotcha de match (deferido):** el
  match es **exacto de token normalizado** (conservador, no falsos positivos) → catchea repos de UN nombre ("ACME")
  pero NO multi-palabra ("Tastrack_Challenge" no matchea "Tastrack"); afinar el heurístico es un incremento futuro.
  Specs `2026-06-15-knowledge-detectors-{design,plan}.md` + memoria `knowledge-detectors-vision`.
- **⚠️ El sync NO debe ser una WRITE-ACTION del modelo — la frescura la gestiona el SISTEMA (Invariante #8)**
  (2026-06-15, hermano del fix del gate; lo destaparon logs de Kevin: un turno de **211s**). Arreglar el gate no
  alcanzó: existía un **tool `syncRepo`** que el modelo invocaba explícitamente al ver "stale", y sincronizaba
  **inline** si el diff ≤ 20 archivos → 16 archivos = **191s** colgando el turno. Además **redundante** (el gate ya
  sincroniza en background) y **confuso** (`checkRepoFreshness` decía "desactualizado" → el modelo corría `syncRepo`
  → "ya estaba al día", deduplicado por el guard de in-flight → razonamiento contradictorio). **El sync es gestión
  de ESTADO/DATOS, no intención** → no debe ser una tool del modelo (Invariante #8). **Fix (decisión de Kevin):**
  **eliminado el tool `syncRepo`**; `checkRepoFreshness` (read) ahora, si detecta stale, **dispara el sync en
  background** (`void repoSync.sync`) y reporta "ya lo pongo al día solo en segundo plano". El modelo solo CONSULTA
  y reporta; nunca sincroniza ni bloquea. Quitado el plumbing `syncInlineMaxFiles`/`SYNC_INLINE_MAX_FILES`. (La
  función orquestadora `syncRepo` se queda: la usa `pnpm sync` offline.) e2e con repo **forzado stale**: `/chat` en
  **12s** (no 191s) + bg sync auto-sanante (restaura `tracked_repos` al HEAD real). **Este caso fundó el Invariante
  #9** (`CLAUDE.md` + memoria `tools-self-contained-minimize-chaining`): minimizar el encadenamiento de acciones del
  modelo; tools versátiles/auto-contenidas que engloben la tarea (acción automática del sistema + feedback), no
  atómicas que el modelo deba orquestar — sobre todo si exponen estados async no sincronizados.
- **⚠️ El cap `maxChunksPerRepo` es POR-CORRIDA, no por-repo-total → incompleto se appendea con `ignoreFresh`,
  NUNCA con `forceFull`** (2026-06-15, lo destapó el e2e por Telegram del detector `repo-awareness`). En `syncRepo`
  el `chunkCount` que corta el cap **resetea cada sync** → un repo más grande que el cap **converge en varias
  pasadas** (cada incremental appendea hasta `maxChunksPerRepo` chunks nuevos). Consecuencia: un repo **incompleto**
  (le faltan archivos por el cap) es **SHA-fresh** (`lastCommitSha == HEAD`). Dos trampas al querer completarlo:
  (1) **`forceFull`** hace `clearSource` + re-index por orden de prioridad → re-haría el **MISMO prefijo** de
  archivos y **nunca progresa** (y borra todo un instante); (2) un **incremental común** ve el SHA fresh → el gate
  de frescura de `syncRepo` hace `skipped-fresh` → **0 embeddings**. **Fix:** opt **`ignoreFresh`** en
  `syncRepo`/`guardedSync` que saltea el gate de frescura pero corre el diff **incremental** (isFull=false) →
  appendea **solo los faltantes** sin borrar → progresa. `coverageGap` (puro) mide los faltantes exactos
  (`kept − indexados − tombstones`). Lo usa la rama `incomplete` de `ensureRepoReady` (detector `repo-awareness`).
  **Regla:** completar un índice parcial = **append (`ignoreFresh`)**, no rebuild (`forceFull`); `forceFull` es solo
  para policy-bump/corrupción. Specs `2026-06-15-repo-awareness-states-design.md`.
