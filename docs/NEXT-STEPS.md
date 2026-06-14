# Pendientes — Vaio (para retomar)

> **ESTADO ACTUAL (2026-06-13) — fuente de verdad viva.**
> **Fase 1: completa y DESPLEGADA** (Railway/Docker; RAG real Neon+pgvector; observabilidad pino) — en `main`.
> **Iteración 2 — MERGEADA en `main`:** núcleo *stateful* + capacidades por canal + Telegram `/tg`,
> **compresión cavemem** (`@vaio/compress`), **refinamiento Telegram** (hilos/topics, HTML, identidad/owner),
> **hot-sync de esquema** (`db:push` + release step) y la **corrección mínima de grounding** (voz≠hechos).
> **Tests: 75 agente + 20 compress; typecheck/biome/build limpios** (snapshot del merge). **e2e real ✅:** con
> `OWNER_TELEGRAM_ID` puesto (local+Railway), el bot respondió por Telegram → owner-vs-visitante y 2 topics con
> contexto aislado verificados.
> **Multimodal (fases 1+2) — MERGEADO en `main`** (2026-06-13): entrada de audio/voz + imágenes (híbrido,
> texto-derivado), STT/visión/TTS por modalidad vía OpenRouter REST (single-provider), salida de voz en
> Telegram (espejo / a pedido), observabilidad de media. e2e confirmado por Kevin. 142 tests + extras de Kevin
> (`stepCountIs 10`, voces TTS). Detalle → Historial.
> **Observabilidad — MERGEADA + EN PRODUCCIÓN** (2026-06-13): App Attribution (dashboard ya no "unknown") +
> persistencia de traza por turno (`trace_events`). Migraciones `0002`+`0003` aplicadas en Neon (verificado:
> `trace_events` con filas, `messages.attachments` existe). Detalle → Historial.
> **Grounding (voz≠hechos) — MERGEADO en `main`** (2026-06-13): system prompt endurecido (voz=estilo sin
> biografía, grounding duro+stop-rule, fallback por audiencia, no over-trigger) + `searchMemory` con categorías.
> e2e: "¿de dónde es Kevin?"→Bucaramanga (no caleño), saludo no dispara la tool. Detalle → Historial.
> **Ritual refinado** (`CLAUDE.md`): skills + subagentes = disciplina visible (considerar siempre, decir si se
> salta + por qué; default a desplegar agentes en lo grande, incl. diseño). **Sin WIP abierto.**
> **Harness de tools (eje 2) — MERGEADO en `main`** (2026-06-13): registry de acciones (`core/actions/`) + gating
> de 2 capas (canal oculta / principal deniega) + seam HITL delgado; `searchMemory` migrado; `denied?` en
> `tool.result`. Detalle → Historial. **Sin WIP abierto.**
> **saveFact (curación) + HITL persistido — MERGEADO en `main`** (2026-06-14): 1ª write-action sobre el harness
> (`proposeFact`/`commitFact`, owner-only); tabla `facts` bi-temporal; `searchMemory` mergea documents+facts.
> Verificado por Kevin (flujo owner e2e). Detalle → Historial.
> **Foco actual:** **observabilidad de fallos silenciosos del backend** (barrido amplio — arranca con
> `brainstorming`). Disparador: una transcripción de audio que falló sin dejar log de la causa (ver WIP abajo).
> **Después / diferido:** Nivel C (scheduler + push proactivo) y/o `escalate` (Fase 2); el portafolio va DESPUÉS.

## 🚧 En proceso / verificación (lista viva — cerrar y mover al Historial al completarse)
> Estados: `- [ ]` pendiente · `- [~]` parcial · `- [?]` hecho, pend. verificación de Kevin · `- [x]` verificado→Historial.
> **Al cambiar de foco, reconciliar esto PRIMERO** (regla en `CLAUDE.md` → "Integridad documental").
- [?] **Observabilidad de fallos silenciosos del backend — BARRIDO AMPLIO** (rama `feat/backend-failure-observability`,
  2026-06-14). TraceEvent nuevo `degraded {component,reason,detail}` + helper `reportDegraded` (emite; el sink
  loguea —nivel error— y persiste) + callback `onDegrade` para el core puro (`modality`) + barrido de los fallos
  del inventario (media-openrouter status+body; neon-memory query-emb vacío; sources body-en-Error; speech tts
  vacío; trace-composite sink roto; telegram webhook no-JSON). `embeddings` ya propagaba el status (sin cambio).
  Dos niveles: log SIEMPRE; TraceEvent persistido donde afecte la respuesta. **171 tests** (151 agente + 20
  compress); typecheck/biome/build limpios; **6 tareas inline**. Par de specs →
  [`2026-06-14-backend-failure-observability-design.md`](superpowers/specs/2026-06-14-backend-failure-observability-design.md)
  · [`…-plan.md`](superpowers/specs/2026-06-14-backend-failure-observability-plan.md). **e2e real ✅:** audio
  basura por `/chat` → log `transcribe failed status:400` + evento `degraded` (HTTP 200, turno intacto) →
  **diagnosticó el bug real del audio** (ver ítem ↓). **Pend. verificación de Kevin + merge a `main`.**
- [ ] **Bug — `TRANSCRIBE_MODEL` como lista CSV no funciona** (descubierto 2026-06-14 por la observabilidad ↑).
  El endpoint `/audio/transcriptions` espera **UN solo modelo**; con `TRANSCRIBE_MODEL` = CSV de varios, OpenRouter
  responde `400 "Model … does not exist"` → TODO audio falla la transcripción. A diferencia de `VISION_MODELS`/
  `SPEECH_MODELS` (cadenas con fallback), el transcriber manda el string tal cual. **Fix (def. con Kevin):** o el
  transcriber soporta cadena de fallback (como vision/speech), o se valida/documenta que es un único modelo +
  corregir el `.env`/Railway. Cambio chico; su propio par o fix directo.
> **Diferido/registrado (no es WIP, vive en su fase):** norte **"Vaio se nutre solo"** — fuentes **CRUDAS
> (código/repos, NO webs)** + self-awareness + tiempo real. **Paso 4 (curación/`saveFact`) ✅ hecho; pasos 1-3
> (lo crudo) pendientes** → ítem rastreable en **§"🔵 Pendiente FUTURO — Vaio se nutre solo"** (abajo) +
> `SPEC.md` §"Vaio se nutre solo" + memoria `vaio-self-nourishing-memory-vision`.
> Cerrados el 2026-06-13 (→ Historial): **Harness de tools (eje 2) — infra mergeada en `main`** (registry +
> gating 2 capas + seam HITL delgado; searchMemory migrado) · **Grounding (voz≠hechos) mergeado en `main`** +
> **ritual refinado en CLAUDE.md** · **Observabilidad (App Attribution + persistencia de traza) mergeada y
> EN PRODUCCIÓN** (migraciones 0002+0003 aplicadas, `trace_events` escribiendo) · **Multimodal fases 1+2 mergeado en `main`** (entrada audio/voz+imágenes,
> STT/visión/TTS por modalidad, salida de voz Telegram, observabilidad de media; e2e Kevin) · `OWNER_TELEGRAM_ID` (local+Railway) · e2e Telegram (owner/visitante + 2
> topics aislados) · **merge de `feat/conversational-core-telegram` a `main`** · **ahorro de tokens de compresión
> verificado en logs** (RAG ~3.5% / conv ~0.6%; persona intacta).

---

## Historial de lo implementado (cronológico; los conteos de tests son snapshots de cada hito)

**🟢 saveFact (CURACIÓN) + HITL PERSISTIDO + facts BI-TEMPORAL — MERGEADO en `main`** (2026-06-14, ex
`feat/savefact-curation-hitl`). 1ª **write-action** sobre el harness, primer paso de "Vaio se nutre solo".
`proposeFact`/`commitFact` (owner-only, gating de 2 capas): Vaio propone un hecho sobre Kevin y, tras
confirmación, lo escribe. **HITL estructural** (`commitFact` exige un pending id real → no se fabrica inline).
Tabla `facts` **bi-temporal** (migración `0004`; status pending/confirmed/rejected + valid/invalid + tx time;
invalidar≠borrar; motor mínimo). `searchMemory` mergea `documents`+`facts` confirmados (`unionAll`, ranking
global). **Propuestas persistidas (Nivel B)**: sobreviven al corte de charla y Vaio las retoma en el prompt
(carga best-effort). Policy del owner actualizada para reflejar las tools. **166 tests** (146 agente + 20
compress); typecheck/biome/build limpios; **8 tareas subagent-driven** + review final ✅. Verificado por Kevin
(flujo owner e2e). Specs → [`…-savefact-curation-hitl-design.md`](superpowers/specs/2026-06-13-savefact-curation-hitl-design.md)
· [`…-plan.md`](superpowers/specs/2026-06-13-savefact-curation-hitl-plan.md). **Pendiente futuro:** Nivel C
(scheduler + push proactivo), `escalate` (Fase 2), dedup/adjudicación de conflictos, extracción automática
post-conversación, facts desde web. ⚠️ Deploy: la migración `0004` debe aplicarse ANTES del código nuevo
(`searchMemory` referencia `facts`); el release step la aplica.

**🟢 HARNESS DE TOOLS (eje 2) — SOLO INFRA + seam HITL delgado — MERGEADO en `main`** (2026-06-13, ex
`feat/tools-harness-registry`). Generaliza `ToolName` (unión cerrada de 1 tool) → **registry de acciones**
(`core/actions/`: `types.ts` = `ActionDescriptor{name,sideEffecting,clearance,build(ctx):Tool}` + `ActionContext`;
`registry.ts` = `ACTIONS` + `buildTools(ctx, actions=ACTIONS)`; `search-memory.ts` = migración). **Gating de 2
capas:** (1) canal **oculta** vía `caps.allowedTools` (la tool no entra al ToolSet); (2) principal **deniega en
runtime** si no cumple `clearance` → `deniedTool` emite `tool.result {ok:false,denied:true}` y devuelve cortesía
(punto de decisión del **seam HITL delgado**, sin async). `searchMemory` migrado **sin cambio de comportamiento**
(`clearance:"anyone"`); `trusted` binario (no RBAC); campo `denied?` en `tool.result` (contracts); `core/tools.ts`
eliminado. **156 tests** (136 agente + 20 compress); typecheck/biome/build limpios. **e2e real ✅:** `/chat` →
`searchMemory` se dispara vía el registry (`tool.call`+`tool.result`), cita el CV, voz intacta, sin denegaciones.
Specs → [`…-tools-harness-registry-design.md`](superpowers/specs/2026-06-13-tools-harness-registry-design.md) ·
[`…-plan.md`](superpowers/specs/2026-06-13-tools-harness-registry-plan.md). **Camino de upgrade (futuro):** las
write-actions *side-effecting* + el seam HITL **async** se construyen sobre el HITL **nativo del AI SDK v6** (tool
sin `execute` → confirmación); `sideEffecting`/`clearance` ya son los disparadores. Encaja con `escalate` (Fase 2)
y `saveFact` ("Vaio se nutre solo").

**🟢 GROUNDING (voz ≠ hechos) — MERGEADO en `main`** (2026-06-13, ex `feat/grounding-voice-not-facts`).
Cierra el bug donde Vaio inventaba origen/fútbol sobre Kevin (§"Hallazgos del bot real" #1-4): `prompt.ts` con
voz = estilo (voseo valluno) **sin biografía** (quitada la identidad geográfica = vector de fuga); **grounding
duro + stop-rule** (hechos de Kevin SOLO de `searchMemory` este turno); **fallback por audiencia**; **no
over-imperar** (condicional, excluye saludos). `tools.ts`: descripción de `searchMemory` con categorías + sin
"SIEMPRE". **151 tests**; typecheck/biome/build limpios. **e2e (con trazas):** "¿de dónde es Kevin?" →
`searchMemory` → Bucaramanga (CV), no "caleño"; "hola" → no dispara la tool; voz intacta. Specs →
`2026-06-13-grounding-voice-not-facts-{design,plan}.md`. Junto: **refinamiento del ritual** en `CLAUDE.md`
(skills + subagentes como disciplina visible) y registro del norte **"Vaio se nutre solo"** en `SPEC.md`
(diferido a harness/Fase 2/3). §Hallazgos #5 (ingerir hechos personales) queda futuro.

**🟢 OBSERVABILIDAD — MERGEADO + EN PRODUCCIÓN** (2026-06-13, ex `feat/observability-traceability`).
**(a) App Attribution:** `APP_NAME`(→`X-Title`)/`APP_URL`(→`HTTP-Referer`) al provider del AI SDK Y a las
llamadas REST (`attributionHeaders`) → el dashboard de OpenRouter atribuye la app (antes "unknown"). **(b)
Persistencia de traza:** tabla `trace_events` (append-only; `request/conversation/turn id` + `seq` por turno +
`payload jsonb`; migración `0003`), `PgTraceSink` best-effort/fire-and-forget (un fallo NUNCA rompe el turno) +
`CompositeTraceSink` (stdout+pg) + flag `TRACE_PERSIST`. Persiste los MISMOS `TraceEvent` del sink de stdout
(event-stream; Convex = norte, no clon). Habilita el panel de conversaciones futuro y hace **verificable** el
grounding. **149 tests**; typecheck/biome/build limpios. **Verificado en prod:** `trace_events` escribiendo +
`messages.attachments` aplicada. Specs →
[`…-trace-persistence-design.md`](superpowers/specs/2026-06-13-trace-persistence-design.md) ·
[`…-plan.md`](superpowers/specs/2026-06-13-trace-persistence-plan.md). Gotcha registrado: `openrouter/free` no
sirve para visión (rutea a content-safety) → fijar VLMs en `VISION_MODELS`. Follow-ups (en el design): panel de
conversaciones, `media.*` como TraceEvent, enriquecer `messages`, retención/TTL.

**🟢 MULTIMODAL (fases 1+2) — MERGEADO en `main`** (2026-06-13, ex `feat/multimodal-input`). **Fase 1:**
contrato de entrada multimodal (audio/voz + imágenes), estrategia híbrida (puertos `Transcriber`/
`MediaUnderstanding` + parts nativos por flag `MULTIMODAL_NATIVE_IMAGES`), núcleo puro `core/modality`,
Telegram normalize+descarga (token nunca en logs), persistencia texto-derivado+ref (`messages.attachments`
jsonb, migración `0002`). **Fase 2:** modelos POR MODALIDAD (`VISION_MODELS`/`TRANSCRIBE_MODEL`/`SPEECH_MODELS`,
explícito o OFF), STT dedicado (`/audio/transcriptions`), **salida de voz/TTS** (`/audio/speech` → Telegram
`sendAudio`, policy `shouldSpeak`, cadena `model|voice|format` con fallback client-side, pcm→WAV@24k),
grounding del prompt (capacidades E/S), observabilidad de media (`media.vision/transcribe/speak` con el modelo
real). **Single-provider OpenRouter por REST** (fuente: `openrouter-api-surface`; el provider del AI SDK no
envuelve rerank/speech/transcription). **142 tests** (122 agente + 20 compress) + fixes de Kevin
(`stepCountIs 10`, voces TTS). **e2e ✅:** round-trips reales (kokoro mp3, gemini pcm→WAV→whisper) + Telegram
real (imágenes + voz in/out). Specs → [`…-multimodal-input-design.md`](superpowers/specs/2026-06-13-multimodal-input-design.md)
· [`…-plan.md`](superpowers/specs/2026-06-13-multimodal-input-plan.md). **Rerank** quedó como pendiente futuro
(diseño decidido, no se codeó: ~29 chunks no aporta).

Estado (2026-06-10): **código de Fase 1 COMPLETO** en monorepo pnpm (`apps/agent` +
`packages/contracts`), arquitectura ports/adapters, **Drizzle ORM + migración inicial**,
Biome + Vitest (12 tests verdes). Verificado: typecheck/build/lint/test limpios; server
corre (`/health` 200, `/chat` 401 sin key, 400 body inválido, cortesía 200 sin OpenRouter).

**Ya en `main` además:** Node **24** (LTS) en `.nvmrc`/CI/`engines`; Biome alineado con `clon-ai`
(formato + reglas); Dependabot configurado para el monorepo (globs + grouping); y **deps mayores
al día y verificadas** (ai 6, zod 4, openrouter-provider 2, hono-node-server 2, drizzle 0.45,
TS 6, vitest 4 + vite 8). Fixes aplicados: `declaration:false` en la app (TS4058 de ai v6) y `vite@^8`.

**🟢 CORRE END-TO-END EN LOCAL** (jun-2026, con keys): `db:migrate` creó el schema en Neon;
`pnpm ingest` pobló **29 chunks** (`gemini-embedding-2` de a uno, truncado a 1536); `/chat` responde
con **RAG real citando CV/portfolio/Last.fm**; **fallback** y **cortesía** en error verificados.
Pendiente de embeddings: el **triage multimodal de documentos** (diseño en `SPEC.md`) es fase 2.

**🟢 OBSERVABILIDAD** (jun-2026, **en `main`**): logs estructurados a stdout con pino (json prod /
pretty dev), puertos `Logger`+`TraceSink`, traza de cada turno
(`turn.start→tool.call→tool.result→reasoning→llm.step→turn.finish`) correlacionada por `requestId`,
redacción tras `LOG_PROMPTS`. Diseñada para persistir a futuro (debug de chats). Plan completo →
[`superpowers/specs/2026-06-11-vaio-observability.md`](superpowers/specs/2026-06-11-vaio-observability.md).
Verificado e2e (traza completa, redacción on/off, sin secrets).

**🟢 DESPLEGADO EN RAILWAY** (2026-06-12): vía **Dockerfile** multi-stage del monorepo (build del
workspace → `pnpm --filter @vaio/agent --prod --legacy deploy` → runtime mínimo `node dist/index.js`).
`railway.json` con `builder: DOCKERFILE` + `startCommand: node dist/index.js` (override del custom
start de la UI). Dominio interno: `vaio.railway.internal`. Gotchas en [`LEARNINGS.md`](LEARNINGS.md).

**🟢 IMPLEMENTADA (rama, falta e2e con keys) — Iteración 2: núcleo conversacional + arnés + canales +
Telegram** (rama `feat/conversational-core-telegram`, 2026-06-12). Memoria conversacional persistida
(`conversations`/`messages`, migración `0001`) + resumen rodante; arnés (capacidades por canal,
registry de tools gated); core stateful (`respond(TurnRequest)→{stream,text}`, persistencia en
background); canal **Telegram** `/tg`. **58 tests verdes**; typecheck/biome/build limpios; smoke local
OK (`/health`, `/chat` auth+cortesía, `/tg` secret/allowlist/dedupe). Diseño técnico →
[`…-telegram-design.md`](superpowers/specs/2026-06-12-stateful-channels-telegram-design.md) ·
plan de alto nivel → [`…-telegram-plan.md`](superpowers/specs/2026-06-12-stateful-channels-telegram-plan.md).
**✅ Cerrado (2026-06-13):** `db:migrate` aplicado + e2e real (multi-turno por `/chat` con mismo
`conversationId`; bot real de Telegram vía `setWebhook`) verificado; **rama mergeada a `main`**.
Diferido a iteraciones siguientes (cada una su par design+plan): HITL/escalación, facts semánticos, Graphiti.

**🟢 IMPLEMENTADA (misma rama) — Capa de compresión determinística (cavemem):** `@cavemem/compress`
vendorizado (`@vaio/compress`, MIT) tras un puerto `Compressor`; comprime el contexto al modelo (resumen +
turnos históricos + chunks de RAG) **sin llamar a un modelo**, con léxico ES. Dos tiers (determinístico +
resumen LLM). **84 tests verdes** (18 del paquete + 66 del agente); typecheck/biome/build limpios; boot OK
(`compress:true`, 0 import-errors). Diseño/plan →
[`…-cavemem-compression-design.md`](superpowers/specs/2026-06-12-cavemem-compression-design.md) ·
[`…-cavemem-compression-plan.md`](superpowers/specs/2026-06-12-cavemem-compression-plan.md).
La rama ya está **mergeada a `main`** (2026-06-13).
**✅ Ahorro verificado en logs (2026-06-13):** se agregó el log `"rag compressed"` (`{before,after,saved,chunks}`
en `tools.ts`, espejando el `"context compressed"` de `agent.ts` — antes el ahorro de RAG era invisible). e2e
real (`/chat` con keys, `LOG_LEVEL=debug`): **RAG (`full`) ~3.5%** (5 muestras 1197–1345 tok → 38–71 saved) y
**conversación (`lite`) ~0.6%**. **Ahorro marginal** porque el corpus real (CV/portfolio/GitHub) es **denso/
factual** (listas de tech, fechas, identificadores, headings → se preservan byte-a-byte); el benchmark ≥30% era
prosa inglesa con filler, no representativo. **Persona/calidad intactas** (respuestas grounded + voseo). Es
ahorro "gratis" (sin llamada a modelo). El gran ahorro real vendría de comprimir **en ingesta** la prosa de los
chunks (ya anotado en "Compresión transversal") o cuando las charlas crucen `SUMMARY_THRESHOLD` (12) y el resumen
rodante compuesto comprima de verdad — hoy, marginal.

**🟢 IMPLEMENTADA (misma rama) — Sync de esquema (DX Convex-like) + refinamiento Telegram** (2026-06-12):
(a) **hot-sync de esquema**: `db:push`/`db:push:watch` (dev) + release step de migraciones en deploy
(`railway.json preDeployCommand`); (b) **allowlist Telegram opcional** (vacía = abierto); (c) **hilos
de Telegram**: `message_thread_id` → 1 topic = 1 conversación (ventana de contexto por hilo), el bot
responde dentro del topic; (d) **persona**: nombre desambiguado (no "Sos Vaio") + caleño/palmireño
(voseo valluno medido) + **formato HTML con fallback a texto plano**; (e) **identidad/owner**:
`OWNER_TELEGRAM_ID` → sólo Kevin es `trusted` (perfil pleno), el resto = visitante capado que presenta a
Kevin; `audience` inyectada al system prompt. **75 tests del agente + 20 compress verdes**; typecheck/
biome/build limpios. Diseño/plan →
[`…-telegram-threads-persona-identity-design.md`](superpowers/specs/2026-06-12-telegram-threads-persona-identity-design.md)
· [`…-plan.md`](superpowers/specs/2026-06-12-telegram-threads-persona-identity-plan.md).
**✅ Cerrado (2026-06-13):** `OWNER_TELEGRAM_ID` puesto (local+Railway); e2e real verificado (2 topics =
contexto aislado; owner vs visitante; HTML renderiza y, si rompe, cae a plano).

### 🔜 PRÓXIMO PASO MAYOR — evolución del core conversacional (espera el "go" de Kevin para `brainstorming`)
La base conversacional (texto) quedó sólida y validada → es el cimiento del adaptador. **Antes de apilar
audio/multimedia/harness**, Kevin va a resolver de su lado lo siguiente; cuando dé el go, **arrancar con
`brainstorming` → design+plan** (su propio par por feature). Dos ejes **foundational** (caros de
retro-ajustar, decidir primero):

1. ✅ **Contrato de entrada multimodal** (audio/voz + imágenes) — **IMPLEMENTADO** (2026-06-13, rama
   `feat/multimodal-input`; híbrido como se recomendó). Ver el WIP `[?]` arriba + specs
   `2026-06-13-multimodal-input-{design,plan}.md`. Followups de evolución → § "Evolución multimodal" abajo.
2. ✅ **Framework de tools/acciones (el "harness") — INFRA** (2026-06-13, rama `feat/tools-harness-registry`,
   pend. verificación + merge). Generalizado a un **registry de acciones** (`ActionDescriptor`: name/
   sideEffecting/clearance/build), gating de 2 capas (canal **y** principal), seam HITL **delgado** (deny path
   con traza). Ver el WIP `[?]` arriba + specs `2026-06-13-tools-harness-registry-{design,plan}.md`.
   **Pendiente (próxima iteración, su propio par):** las **write-actions** *side-effecting* + el seam HITL
   **async** (confirmación/notificación/reanudación, sobre el HITL nativo del AI SDK v6) — encaja con el
   `escalate` de fase 2 y la curación de "Vaio se nutre solo".

**Diferibles (ya hay seam, no urgen):** ventana de contexto **por tokens** (hoy por conteo de mensajes);
persistencia de **adjuntos** (referencias de media + transcripción); **persona/policies como dato**
(hoy hardcoded en `prompt.ts`) para tunear el system prompt sin redeploy; **guardas de costo/rate por
principal** en el core (hoy solo en el proxy); identidad **cross-canal** + facts por-usuario (fase 2);
**turnos proactivos** (no iniciados por el usuario).

### 🎙️ Evolución multimodal
**✅ HECHO en Fase 2** (ver el WIP `[?]` arriba): **envs por modalidad** (`VISION_MODELS`/`TRANSCRIBE_MODEL`/
`SPEECH_MODELS`, cada uno explícito o OFF — sin `MULTIMODAL_MODELS`); **STT dedicado** (`/audio/transcriptions`);
**salida de voz / TTS** (`/audio/speech` → Telegram, cadena `model|voice|format`, pcm→WAV); **grounding del
prompt** = capacidades de E/S reales. Todo por OpenRouter REST → single-provider (ver `openrouter-api-surface`).

**Queda pendiente (futuro):**
- **Rerank — precisión de retrieval para el grounding** (OpenRouter `/rerank`, AI SDK `rerank()`): segunda
  etapa del RAG = recuperar un K **ancho** por vectores → rerankear (cross-encoder, query+chunk juntos) →
  recortar al top-N. Mejora QUÉ entra al contexto (mejor grounding). **Timing:** hoy el corpus (~29 chunks)
  es chico → prematuro; **el valor escala con el corpus** (facts fase 2, más fuentes). Seam: `searchMemory`
  con K ancho opcional → rerank → trim. Diseño decidido en el design spec; atar a fase 2 de memoria.
- **TTS en web `/chat`** (hoy solo Telegram; el `/chat` es stream de texto → necesita canal de audio).

### 🔬 Hallazgos del bot real (jun-2026) → followups de grounding / meta-prompting (espera el "go" de Kevin)
Probando el bot, ante "¿quién eres?" Vaio respondió **sin consultar `searchMemory`** y afirmó por inercia
que Kevin es "caleño/palmireño de pura cepa" y que sigue fútbol/un equipo — **TODO inventado. Kevin NO es
caleño.** La persona palmireña/voseo es la **VOZ de Vaio** (decisión cultural deliberada); el bug es que esa
voz se **proyectó como HECHO sobre Kevin**. Auditoría + investigación con **verificación adversarial
(29/31 claims soportados)** → followups (cuando Kevin dé el go; **produce su par design+plan**):

1. **Desacoplar VOZ de HECHOS en `prompt.ts`** (raíz del bug). `prompt.ts:16/28` hardcodean origen + el
   causal "Sos caleño… **Por eso** hablás voseo": (a) proyecta la persona de Vaio sobre Kevin como hecho,
   (b) deja la instrucción de `searchMemory` demasiado blanda para sobreescribir esa "verdad de fondo".
   `prompt.ts:28` (EN) incluso **afirma falsamente** "Kevin is from Palmira". Fix: el prompt mantiene SOLO
   rol/voz/política/reglas de consulta; los **hechos de dominio** de Kevin salen del copy → vienen de
   `searchMemory`. ⚠️ Matiz honesto (verificación marcó *uncertain* el absolutismo): la regla NO es "ningún
   dato jamás" (Anthropic critica hardcodear *lógica* frágil y avala híbridos; los rasgos de voz/identidad
   pueden quedar como señal cultural — `CLAUDE.md` los protege). Regla precisa: **sin hechos de DOMINIO
   consultables; el voseo queda como estilo puro, sin afirmar biografía.** [Anthropic context-engineering]
2. **Grounding duro + stop rule** (patrón OpenAI, *supported*): reemplazar "no inventes" (exhortación débil)
   por **constraint de fuente**: "sobre Kevin, respondé ÚNICAMENTE con lo que devuelva `searchMemory` este
   turno; si no hay, decílo y ofrecé alternativa". Salida por audiencia (owner: pedí el dato faltante;
   visitor: "no tengo ese dato de Kevin" + ofrecé proyectos/contacto).
3. **No sobre-imperar** (*supported*): NADA de "DEBES SIEMPRE/CRITICAL" en mayúsculas para `searchMemory`
   — los modelos modernos **sobre-disparan** tools → costo (objetivo "pocos $/mes"); frasear condicional
   ("cuando la respuesta dependa de un hecho concreto de Kevin, consultá primero") y **excluir saludos/charla**.
   El bug fue *under-triggering*; cuidado de no pasarse al extremo opuesto.
4. **Anclar el grounding en DOS lugares**: el prompt **y** la descripción de `searchMemory` en `tools.ts`
   (enumerar categorías: bio, origen, stack, proyectos, gustos, contacto). [Anthropic writing-tools-for-agents]
5. **Alimentar tu info real a la MEMORIA, no al prompt**: ingerir hechos graduales ("no me gusta el fútbol",
   origen correcto, etc.) como memoria del producto → Vaio aprende sin tocar código.

**Reconciliación construido↔norte (hecha YA en `SPEC.md` → bullet "System prompt — capas"):** prompt =
rol/voz/política/grounding (núcleo inmutable en git); hechos en memoria/grafo, entran sólo por la tool; el
prompt nunca crece con hechos → no compite con el crecimiento orgánico; sobrevive a Neon→Graphiti.

**System prompt por DB (lo que preguntaste):** veredicto *supported* = **prematuro hoy** (solo-dev, una
persona que editás vos; git ya da versionado/rollback/audit; un fetch remoto suma latencia + un punto de
fallo en el camino que `CLAUDE.md` exige "siempre responde"). Disparador = mismo que OpenSpec (≥2 superficies
con prompts distintos, o A/B sin redeploy). Cuando llegue: **núcleo en código + persona-snapshots versionadas
en DB** (bi-temporal-friendly; nunca interpolar datos por-request en el bloque estable).

**Grafos (tu duda "cómo compromete el conocimiento"):** la frontera no cambia — el grafo es el store durable
fuera de la ventana; entra por la tool. Diseñar `facts`/grafo **bi-temporal** desde el día 1 (valid/invalid +
created/expired; *invalidar en el WRITE/ingest, no borrar* — Graphiti/Zep + paper STALE, *supported*). ⚠️ Un
claim salió **refutado**: "agregar retrieval resuelve el conflicto y los modelos prefieren lo recuperado" — la
evidencia dice lo contrario (los modelos de alta capacidad **resisten** lo recuperado; el retrieval mete sus
propios conflictos). Implicación: **no** confiar en que el retrieval "arregle" un hecho rancio → razón de más
para no meter el hecho (rancio/falso) en el prompt, y para **adjudicar validez al ingerir**.

**Feature — panel de control de conversaciones (alto valor, futuro):** revisar charlas; ver qué dijo/no dijo/
inventó Vaio y darle **feedback conversacional correctivo**. Diseño *grounded*: el feedback **NO muta el
system prompt** (rompería reproducibilidad) → va como `feedback_type` (confirmed/corrected/rejected) en los
facts (fase 2) y **pesa el ranking de `searchMemory`**; en grafo (fase 3), edges temporales de aprobación.

**Gap de costo descubierto:** `SPEC.md` asumía "prompt caching del system" pero **hoy NO se cachea**
(`openrouter.ts` sin `cache_control`; el resumen rodante va dentro del `system` y lo invalida). Matiz: la
persona es corta (< mínimo ~1024 tok) → cachearla sola no rinde; el quick-win (cuando crezcan tools/policy)
es cachear **tool defs + bloque estable** como prefijo (las tools preceden al system y se reusan en los ~5
steps/turno) y separar `buildSystemPrompt` en `{estable, volátil}`; la cadena de fallback rompe el cache al
cambiar de provider. *SPEC ya ajustado para no afirmar un caching inexistente; implementación = followup cuando rinda.*

### 🔵 Pendiente FUTURO — "Vaio se nutre solo": fuentes CRUDAS (código/repos), NO ingesta de webs
**Norte de Kevin — NO diluir** (rastreable acá para que no se pierda al cerrar features). El "vivo" se alimenta de
**código crudo y repos (incl. el suyo), en tiempo real**, **no de scrapear el HTML/web desplegado**. La ingesta
batch de URLs/APIs de hoy (`adapters/sources/*`) es el **punto de partida a superar**, no el norte. Decomposición
(detalle en [`SPEC.md`](SPEC.md) §"Vaio se nutre solo" + memoria `vaio-self-nourishing-memory-vision`):
- ✅ **Paso 4 — Curación agéntica** (`saveFact` + HITL): **HECHO** (2026-06-14, ver Historial). El "decide qué guardar".
- **Paso 1 — Fuentes crudas** (pendiente): collectors que leen **repo md/código** (no HTML desplegado). Mismo
  patrón `collectX()→DocChunk[]`. Su propio par design+plan.
- **Paso 2 — Self-awareness** (pendiente): Vaio ingiere **su propio repo** ("sus tripas"). ⚠️ excluir secrets/`.env`.
- **Paso 3 — Acceso en tiempo real / on-demand** (pendiente): retrieval como **read-action del harness** (eje 2,
  ya existe la infra); sync continuo → Fase 3.
- **Paso 5 — Grafos** (pendiente, Fase 3): `facts` → Graphiti bi-temporal.
> **Los pasos 1-3 son el corazón del "vivo" que falta** (paso 4 ya da la curación; 1-3 dan el acceso a lo crudo).
> Cada paso = su propio `brainstorming` → design+plan cuando se priorice.

### 🔵 Pendiente FUTURO — Neon como DB reactiva estilo Convex
El **hot-sync de esquema** (`db:push`) ya da la DX de "el esquema sigue al código". La **reactividad real**
(queries que se actualizan solas, suscripciones) es otra cosa: Neon/Postgres no la trae. Opciones a futuro
(su propio par design+plan): Postgres `LISTEN/NOTIFY` + WebSockets/SSE para empujar cambios a los clientes,
o evaluar Convex si la app `web` lo justifica. Fuera de alcance hoy.

### 🔵 Pendiente FUTURO — Compresión transversal (`Compressor`) + Vaio como harness
El puerto `Compressor` (Tier 1, determinístico) hoy se aplica a **conversación + RAG**. Queda como
**seam transversal** para extenderlo, cuando aplique (cada uno su par design+plan):
- **Ingesta**: comprimir la prosa de los chunks antes de almacenar/servir como contexto (ojo: **embeber
  el original**, comprimir solo para el contexto; cuidar que no degrade el retrieval).
- **Facts** (Fase 2): los facts ya son densos; la compresión es su formato natural de almacenamiento.
- **Vaio como harness personal** (norte): exponer/consumir memoria por **MCP** (cavemem es TS+MCP) para
  que Vaio participe del desarrollo (Claude Code u otros arneses) llevando prácticas/contexto de Kevin;
  ahí también cabría el **caveman de salida** (respuestas terse agente→agente, donde la persona no importa).

> **Nota de diseño (2026-06-13) — dónde la compresión SÍ rinde, y dónde no.** El ahorro hoy es marginal
> (~3.5% RAG / ~0.6% conv) porque el corpus es denso/factual. En **uso agéntico / desarrollo de sistemas** el
> ahorro debería crecer, pero NO uniformemente:
> - **SÍ rinde:** (a) prosa explicativa/conversacional voluminosa (más filler removible que el CV); (b) volumen
>   alto → ahorro **absoluto** mayor aunque el % sea parecido, y el resumen rodante recién comprime de verdad al
>   cruzar `SUMMARY_THRESHOLD` (12); (c) **caveman de salida agente→agente** en `ultra` (sin persona/legibilidad
>   que cuidar → se puede comprimir agresivo).
> - **NO rinde (por diseño):** código, paths, diffs, stack traces, identificadores → se preservan **byte-a-byte**
>   a propósito; una charla 80% código tiene techo de ahorro bajo. Además el léxico es **ES** y mucho trabajo
>   agéntico es en inglés.
> - **Implicación:** la compresión léxica determinística es ahorro **gratis complementario**, NO el motor de
>   costo. Las palancas grandes en uso agéntico serán: **selección/retrieval** (qué entra al contexto), el
>   **resumen Tier 2 (LLM)** de historiales largos, y la **salida terse agente→agente**. Validar con medición
>   real cuando "Vaio como harness" tenga su par design+plan (no asumir el % del CV).

**Después de la iteración 2: integración del portafolio** (`ChatSheet.tsx` + proxy `/api/agent` →
apuntar al dominio **público** de Railway, no al `.internal`). Luego `apps/web`. Diseño:
[`SPEC.md`](SPEC.md) · Workflow: [`../CLAUDE.md`](../CLAUDE.md).

---

## Cuentas / keys — estado
Las keys de **Fase 1 ya están** (OpenRouter, Neon `DATABASE_URL`, Embeddings, GitHub, Railway, Last.fm) y el
repo está **conectado a Railway** (desplegado y corriendo). **Pendiente de Kevin (solo cuentas/secrets):**
- ~~`OWNER_TELEGRAM_ID` (id de @userinfobot) en `.env` local + secrets de Railway~~ → **✅ puesto (2026-06-13)**; perfil **owner** activo.
- *(MÁS ADELANTE, para integrar el portafolio):* en **Vercel** `AGENT_URL`, `AGENT_API_KEY` (la del proxy) +
  Upstash Redis (rate-limit), apuntando al dominio **público** de Railway.

## No bloqueante (sin keys nuevas)
- **`apps/web` (frontend)** — visión futura: dashboard de configs/datos/conectores/flujos + el **panel de
  control de conversaciones** (feedback correctivo, ver arriba). Reusa `@vaio/contracts`. `brainstorming` antes.
- **Integración en el portafolio (`KevinJGV`)** — `ChatSheet.tsx` + proxy `/api/agent` (verificable con build
  aunque Vaio no esté live). **Va DESPUÉS del foco actual.**
- **Sincronizar la copia del SPEC en el portafolio** (`KevinJGV/.../2026-06-09-vaio-agent-design.md`) con el
  diseño actual — quedó **desfasada** (pendiente).

---

## Decisión diferida: OpenSpec (tooling SDD)

Evaluado el 2026-06-10. **Decisión: NO adoptar todavía** — el flujo actual (`SPEC.md` +
superpowers) es eficiente para un servicio / una feature por vez, y meter tooling SDD pesado
ahora arriesga sobre-especificación / spec rot. **El disparador exacto para adoptarlo está
en [`../CLAUDE.md`](../CLAUDE.md) → "Cuándo escalar a OpenSpec"** (resumen: cuando `apps/web` +
fase 2 estén activos a la vez, o aparezcan ≥2 síntomas de que el `SPEC.md` monolítico quedó chico).

## Secuencia sugerida (desde hoy)
1. **Fase 1** (keys → memory/ingest/agent → local → **deploy Railway**). ✅ HECHO.
2. **Iteración 2 + compresión + refinamiento Telegram + hot-sync + fix grounding** → **✅ MERGEADO en `main`** (2026-06-13).
3. **(Kevin)** `OWNER_TELEGRAM_ID` + e2e real (2 topics, owner/visitante) → **✅ HECHO**; queda solo **ver el ahorro de tokens** en logs.
4. **Review + merge** de `feat/conversational-core-telegram` → **✅ HECHO** (2026-06-13).
5. **Próximo paso mayor** — ejes foundational: **multimodal** → **✅ MERGEADO**; **framework de tools/harness
   (infra)** → **✅ MERGEADO** (2026-06-13). Quedan los **followups de grounding** (§ "Hallazgos del bot real").
6. **Próximo (espera "go"):** las **write-actions** + seam HITL **async** sobre el harness (1ª candidata:
   `escalate`/`saveFact`; curación "Vaio se nutre solo") — su propio par `brainstorming`→design+plan.
7. **Después:** integración del portafolio (`ChatSheet.tsx` + proxy → dominio público de Railway). Luego `apps/web`.

> Definition of Done por tarea y verificación: ver `../CLAUDE.md`.
