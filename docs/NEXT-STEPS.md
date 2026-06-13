# Pendientes — Vaio (para retomar)

> **ESTADO ACTUAL (2026-06-13) — fuente de verdad viva.**
> **Fase 1: completa y DESPLEGADA** (Railway/Docker; RAG real Neon+pgvector; observabilidad pino) — en `main`.
> **Iteración 2 — MERGEADA en `main`:** núcleo *stateful* + capacidades por canal + Telegram `/tg`,
> **compresión cavemem** (`@vaio/compress`), **refinamiento Telegram** (hilos/topics, HTML, identidad/owner),
> **hot-sync de esquema** (`db:push` + release step) y la **corrección mínima de grounding** (voz≠hechos).
> **Tests: 75 agente + 20 compress; typecheck/biome/build limpios** (snapshot del merge). **e2e real ✅:** con
> `OWNER_TELEGRAM_ID` puesto (local+Railway), el bot respondió por Telegram → owner-vs-visitante y 2 topics con
> contexto aislado verificados.
> **Sin WIP abierto.** El ahorro de compresión quedó **verificado en logs** (2026-06-13): ~3.5% RAG (`full`) /
> ~0.6% conversación (`lite`) sobre el corpus real — marginal porque el corpus es denso/factual; persona/calidad
> intactas. Detalle → Historial.
> **Foco / "go" pendiente:** followups de grounding (§ "Hallazgos del bot real") + **próximo paso mayor**
> (entrada multimodal + framework de tools/harness). **El portafolio va DESPUÉS — NO es el próximo paso.**

## 🚧 En proceso / verificación (lista viva — cerrar y mover al Historial al completarse)
> Estados: `- [ ]` pendiente · `- [~]` parcial · `- [?]` hecho, pend. verificación de Kevin · `- [x]` verificado→Historial.
> **Al cambiar de foco, reconciliar esto PRIMERO** (regla en `CLAUDE.md` → "Integridad documental").
- [?] **Contrato de entrada multimodal** (audio/voz + imágenes) — eje 1 del próximo paso mayor.
  IMPLEMENTADO en `feat/multimodal-input` (sin mergear). Decisiones: multimodal primero (harness/HITL
  después), audio+imágenes (no PDF), híbrido (puertos `Transcriber`/`MediaUnderstanding` + parts nativos por
  flag `MULTIMODAL_NATIVE_IMAGES`), modelos de media por modalidad (ver Fase 2), persistencia
  texto-derivado+ref (`messages.attachments` jsonb). **121 tests verdes** (101 agente + 20 compress);
  typecheck/biome/build limpios. **e2e ✅:** `/chat` con imagen base64 → visión describe → respuesta grounded
  ("rojo"); degradación con modelo multimodal roto → `[imagen no procesable]` + HTTP 200 (nunca 500). Diseño →
  [`…-multimodal-input-design.md`](superpowers/specs/2026-06-13-multimodal-input-design.md) · plan →
  [`…-multimodal-input-plan.md`](superpowers/specs/2026-06-13-multimodal-input-plan.md).
  **Pendiente de Kevin:** (1) aplicar la migración `0002` (`messages.attachments`) a Neon — `db:push` (dev) o
  `db:migrate` (el e2e mostró que sin la columna el turno responde igual, solo falla la persistencia en
  background); (2) e2e Telegram real (nota de voz + foto + voz→audio) tras deploy; (3) review + merge de la rama.
- [?] **Multimodal Fase 2** (misma rama) — **IMPLEMENTADO**: envs por modalidad (`TRANSCRIBE_MODEL`/
  `VISION_MODELS`/`SPEECH_MODELS`, cada uno explícito o OFF; sin `MULTIMODAL_MODELS`); **STT dedicado** `POST /audio/transcriptions`;
  **salida de voz (TTS)** `POST /audio/speech` → Telegram `sendAudio` con policy `shouldSpeak` (default texto;
  voz si entró voz o se pide); **cadena TTS de fallback** `SPEECH_MODELS=model|voice|format,…` (client-side,
  voz/formato por-modelo; pcm→WAV@24k para Telegram); **grounding del prompt** = capacidades de E/S reales
  (cierra "Vaio dice solo-texto"). Single-provider OpenRouter por REST (ver `openrouter-api-surface`).
  **142 tests** (122 agente + 20 compress); typecheck/biome/build limpios. **e2e ✅:** boot
  `transcribe/vision/speech` on; `/chat` imagen → "Rojo"; **round-trips reales** contra OpenRouter:
  `kokoro-82m`/`af_bella`→mp3→`whisper-large-v3`, y `gemini-3.1-flash-tts-preview`/`Zephyr`→pcm→WAV@24k→whisper. **Rerank** = pendiente futuro (diseño en el design, no se codea: ~29 chunks no
  aporta). Specs actualizados (`§ Fase 2`).
  **Pendiente de Kevin:** (1) e2e Telegram real (nota de voz → STT → respuesta; voz→audio espejo; "respondeme
  con voz") tras deploy + secrets `SPEECH_MODELS`/`TRANSCRIBE_MODEL`/`VISION_MODELS`; (2) sigue pendiente la
  migración `0002` de fase 1; (3) review + merge.
> Cerrados el 2026-06-13 (→ Historial): `OWNER_TELEGRAM_ID` (local+Railway) · e2e Telegram (owner/visitante + 2
> topics aislados) · **merge de `feat/conversational-core-telegram` a `main`** · **ahorro de tokens de compresión
> verificado en logs** (RAG ~3.5% / conv ~0.6%; persona intacta).

---

## Historial de lo implementado (cronológico; los conteos de tests son snapshots de cada hito)

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
2. **Framework de tools/acciones (el "harness")**. Hoy `ToolName` es unión cerrada de **una** tool
   (`searchMemory`, read-only). Generalizar a un **registry de acciones**: descriptor (name/description/
   inputSchema/execute), flag *side-effecting*, gating por capacidad **y por principal**, y seam de
   **confirmación / human-in-the-loop** antes de acciones reservadas (encaja con el `escalate` de fase 2).

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
5. **Próximo paso mayor** (espera "go"): contrato de entrada **multimodal** + framework de **tools/harness**
   (§ "Próximo paso mayor") y los **followups de grounding** (§ "Hallazgos del bot real").
6. **Después:** integración del portafolio (`ChatSheet.tsx` + proxy → dominio público de Railway). Luego `apps/web`.

> Definition of Done por tarea y verificación: ver `../CLAUDE.md`.
