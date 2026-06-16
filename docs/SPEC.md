# Spec — Agente personal de IA "Vaio"

**Estado:** Fase 1 (MVP) **en `main` y desplegado en Railway** (Docker). Observabilidad en `main`.
**Iteración 2 (núcleo conversacional + canales + Telegram)** **mergeada en `main`** (memoria conversacional
persistida + resumen rodante, arnés con capacidades por canal, canal Telegram `/tg`, compresión cavemem,
refinamiento Telegram, hot-sync de esquema). e2e verificado (owner/visitante, 2 topics aislados); **único
pendiente = ver el ahorro de tokens de compresión en logs.** Plan/diseño por feature →
[`superpowers/specs/2026-06-12-stateful-channels-telegram-{design,plan}.md`](superpowers/specs/).
**Siguiente:** followups de grounding + evolución del core (entrada multimodal / framework de tools-harness);
**el portafolio va DESPUÉS**. Actualizado 2026-06-13
**Repos:** este spec vive en AMBOS — el portafolio (`KevinJGV`) y el repo del agente
(`Vaio`). Mantener en sync.

> **Rol de este doc:** norte/visión + diseño **FUNDACIONAL** del agente (fases, arquitectura macro,
> stack). Los **planes/diseños de cada feature** viven en [`superpowers/specs/`](superpowers/specs/)
> (**el par `-design.md` + `-plan.md`** por feature; ahí se promueve lo aprobado de plan mode / `writing-plans`). Estado
> real + siguiente paso → [`NEXT-STEPS.md`](NEXT-STEPS.md). El agente vive en **repo aparte `Vaio`**;
> el portafolio solo suma un chat-sheet + un proxy.

## Contexto

Kevin quiere un **agente** (estilo Claude Code/Hermes) accesible desde el portafolio por un
**sheet lateral tipo chat**, alimentado por su repo/GitHub/Spotify/CV + lo que le cuente,
con **memoria que se nutre** con cada conversación, **acciones condicionales** (si no sabe →
guarda la duda y le avisa por Telegram/correo, canales por los que también charla/retroalimenta),
**modelos baratos + fallback multi-proveedor** para siempre responder. Empezamos por un MVP
demostrable y vamos capando.

## Decisiones (stack elegido)

| Decisión | Elegido | Alternativas descartadas (por qué) |
|---|---|---|
| **Alcance** | MVP enfocado primero, luego fases | Full de una (lento/riesgoso) |
| **Runtime agéntico** | **Vercel AI SDK** (TS, standalone) | Mastra (más opinado), Claude Agent SDK (pesado) |
| **Gateway/fallback** | **OpenRouter** (array de fallback, Llama free de red) | Vercel AI Gateway (menos catálogo), LiteLLM (más ops) |
| **Memoria** | **Neon Postgres + pgvector** (RAG + tabla `facts`) | Graphiti (→ fase 3), mem0 (menos control) |
| **Hosting agente** | **Railway** (always-on, predecible, Postgres/cron) | Vercel functions (pelea con background), Fly (más ops) |
| **Canales** | Telegram webhook + Resend (saliente, ya existe) — fase 2 | polling (lento), email entrante → fase 3 |
| **Compresión de contexto** | **cavemem** (`@vaio/compress`, determinístico, al ENVIAR) — implementado (it. 2.1) | comprimir al guardar (descartado: turnos crudos en DB) |
| **Repo** | **Monorepo pnpm** (`apps/agent` + `packages/contracts`, hueco `apps/web`) | Multi-repo (fricción para compartir contratos web↔agente) |
| **Arquitectura agente** | **ports/adapters-lite** (core puro + puertos + adapters) | Hexagonal completo (ceremonia excesiva), módulos planos (poco desacople para fases) |
| **DB** | **Drizzle ORM + migraciones** (driver `node-postgres`) | pg crudo (sin migraciones versionadas), Prisma (pesado, pgvector no first-class) |
| **Tooling** | **Biome** (lint+format), **zod** (validación env), **Vitest** (tests) | ESLint+Prettier (2 deps), sin tests |

> **Por qué subir el listón de ingeniería ahora** (antes minimalista): el usuario proyecta un
> **frontend** (configs/datos/conectores/flujos) → monorepo + contratos compartidos desde el
> inicio evita una migración disruptiva post-deploy. Decidido el 2026-06-10.

⚠️ **Modelos exactos y precios** (chat + embeddings) se fijan **al construir** vía OpenRouter
— el research trajo datos post-corte (ene-2026) que cambian mensualmente. La **estrategia**
(primario barato → fallback → free de última instancia + prompt caching) es lo durable.
> **Nota (jun-2026): el prompt caching es ESTRATEGIA, no está activo todavía.** Hoy `openrouter.ts`
> no setea `cache_control` y el resumen rodante va dentro del string `system` (lo invalidaría). Además
> la persona es corta (~200-400 tok < mínimo ~1024 del cache) → cachearla sola no rinde. El quick-win real
> (cuando crezcan tools/policy) es cachear **tool defs + bloque estable** como prefijo y separar el system
> en {estable, volátil}. Detalle y plan → `NEXT-STEPS.md` ("Hallazgos del bot real").

## Arquitectura

```
PORTAFOLIO (Astro/Vercel, output:static)        AGENTE Vaio (repo aparte, Railway, always-on)
─────────────────────────────────────           ─────────────────────────────────────────
ChatSheet.tsx (isla React, client:visible)       POST /chat (stream)  ← Hono + Vercel AI SDK
  │ botón flotante (glass, estilo Tools)            │ loop: system+RAG → modelo (OpenRouter
  ▼                                                 │   fallback chain) → stream
/api/agent  (proxy: origin-check + rate-limit  ──▶  │ tools (MVP): searchMemory(query)
   + oculta key/URL + passthrough stream)           ▼
                                                  [Neon Postgres + pgvector]
                                                    documents(source, chunk, embedding)
                                                    (facts → fase 2)
                                                  [Ingesta] (script/cron):
                                                    cv.vindevsito.dev (ES/EN, texto limpio),
                                                    vindevsito.dev/me·/contact, GitHub API
                                                    (perfil+repos+lenguajes), Last.fm (música)
OpenRouter: models:[barato, fallback, llama-free]  → "siempre responde" + caching del system
```

## Fase 1 — MVP "chat que te conoce"

**Repo del agente `Vaio`:**
- **Server**: Hono (TS, ligero, buen streaming) en Node, deploy en Railway (always-on + health).
- **Runtime**: Vercel AI SDK (`ai`) + provider **OpenRouter** (`@openrouter/ai-sdk-provider`).
  `streamText({ model, system, messages, tools })`. Cadena de fallback de OpenRouter.
- **Memoria/RAG**: Neon + `pgvector` vía **Drizzle ORM**. Tabla `documents(id, source, url,
  chunk, embedding vector(1536), updated_at)` + índice HNSW `vector_cosine_ops`; búsqueda con
  `cosineDistance`. Embeddings con **`gemini-embedding-2`** vía OpenRouter (ver "Embeddings & ingesta
  multimodal"). Migraciones con `drizzle-kit` (la inicial antepone `CREATE EXTENSION vector`).
  Puerto `MemoryStore` (adapter `neon-memory`); tool `searchMemory(query)` → top-k → contexto al system.
- **Diseño de tools (harness) — "el modelo triggerea, el sistema gestiona los datos"** (invariante #8): las
  tools del modelo exponen **solo intención** (lenguaje natural) **+ opciones preestablecidas** (enum/ordinal/
  boolean); los **ids/uuids/objetos** se resuelven **determinísticamente** en el sistema (cache/persistencia),
  nunca los relaya el modelo (los LLM fallan emitiendo estructuras). Ej.: el flujo de facts es **uuid-free** —
  `rememberFact(statement)` y `resolveFact(decision, replaces:[ordinales])`; el sistema mapea ordinal→uuid desde
  la pendiente que ya cargó. Excepciones: pocas, con fallo **visible**. Detalle →
  `docs/superpowers/specs/2026-06-14-llm-no-relay-ids-design.md`.
- **Embeddings**: **`gemini-embedding-2`** vía OpenRouter (multimodal, 3072→**1536** Matryoshka) — ver "Embeddings & ingesta multimodal".
- **Ingesta** (`ingest.ts`, a mano y luego cron Railway):
  - `cv.vindevsito.dev/` y `/en/` → texto limpio del CV.
  - `vindevsito.dev/me`, `/contact` → "sobre mí" / posicionamiento.
  - **GitHub API** (token read-only): perfil, repos, lenguajes, pinned, READMEs.
  - **Last.fm** → gustos musicales / now-playing.
  - chunk → embed → upsert en `documents`. Lee fuentes públicas (desacoplado).
- **System prompt — capas (principio fundacional, para que el prompt NO compita con el crecimiento
  orgánico de la memoria):** el prompt define **rol + voz + política por canal + reglas de grounding**;
  **NUNCA hechos consultables de Kevin** (origen, stack, proyectos, gustos, contacto, experiencia con
  fecha). Esos **hechos viven en la memoria** (hoy `documents`/pgvector; fase 2 `facts`; fase 3 grafo) y
  entran al contexto **sólo por la tool** (`searchMemory` → futuro `searchGraph`). Así el prompt no crece
  con hechos y la frontera **sobrevive a Neon→Graphiti**. La persona (nombre, voseo valluno, tono — señal
  cultural deliberada, no neutralizar) es la **VOZ de Vaio**, inmutable en código/git; **no es un hecho
  sobre Kevin** y no debe proyectarse como tal (gatillo del bug de jun-2026: ver `NEXT-STEPS.md` →
  "Hallazgos del bot real"). Responde en el **idioma del usuario**. *Persona-contexto dinámica
  (snapshots versionados por DB) = fase 3+, no ahora; system-prompt-por-DB es prematuro hoy (git ya da
  versionado/rollback; sumaría latencia + un punto de fallo en el camino que "siempre responde").*
- **Endpoints MVP**: `POST /chat` (stream, requiere header `AGENT_API_KEY`), `GET /health`.
  **Iteración 2 suma** `POST /tg` (webhook Telegram: secret_token; allowlist **opcional** — vacía =
  abierto, con ids = whitelist) y vuelve el core **stateful** (memoria conversacional
  `conversations`/`messages` + resumen rodante; capacidades por canal; `searchMemory` gated por capacidad).
  **Refinamiento Telegram**: **hilos** (`message_thread_id` → 1 topic = 1 conversación = su propia ventana
  de contexto; responde dentro del topic); respuestas en **HTML** (fallback a texto plano); **identidad por
  owner** (`OWNER_TELEGRAM_ID` → sólo Kevin es `trusted`/pleno; el resto = visitante capado que **presenta a
  Kevin**; `audience` owner/visitor/public inyectada al system prompt). Diseño:
  [`superpowers/specs/2026-06-12-stateful-channels-telegram-design.md`](superpowers/specs/2026-06-12-stateful-channels-telegram-design.md)
  · [`…-telegram-threads-persona-identity-design.md`](superpowers/specs/2026-06-12-telegram-threads-persona-identity-design.md).
  Ambos instrumentados con observabilidad (ver "Observabilidad" abajo).

**Integración en el portafolio** (mínima, no rompe `output:'static'`):
- `src/components/react/ChatSheet.tsx` — isla `client:visible`: botón flotante (bottom-right,
  glass como `Tools.astro`) → panel lateral animado con chat + streaming. Bilingüe (`vlocale`/i18n).
- `src/pages/api/agent.ts` (`prerender=false`) — **proxy** (patrón `contact.ts`/`nowplaying.ts`):
  valida `Origin` (solo `vindevsito.dev`), **rate-limit** (Upstash Redis free), reenvía a
  `AGENT_URL/chat` con `AGENT_API_KEY`, **stream passthrough**. Oculta URL/key y protege costo.
- Reusa: i18n/`vlocale`, patrón glass (`Tools.astro`), GSAP, Resend (fase 2).

**Env/secrets**:
- Portafolio (Vercel): `AGENT_URL`, `AGENT_API_KEY`, `UPSTASH_REDIS_*`.
- Vaio (Railway): `OPENROUTER_API_KEY`, `DATABASE_URL` (Neon), `EMBEDDINGS_API_KEY`,
  `GITHUB_TOKEN` (read-only), `AGENT_API_KEY` (valida el proxy), `LASTFM_*`.

**Seguridad/costo**: el endpoint del agente exige `AGENT_API_KEY` (solo el proxy lo sabe); el
proxy hace origin-check + rate-limit (anti-abuso/quema de tokens).

## Embeddings & ingesta multimodal (diseño · 2026-06-11)

**Provider:** embeddings vía **OpenRouter** (endpoint `/embeddings`, compatible OpenAI, soporta
imágenes). **Una sola key**: `EMBEDDINGS_API_KEY` puede ser la misma `OPENROUTER_API_KEY` (el wiring
hace fallback a `OPENROUTER_API_KEY` si la primera no está).

**Un único modelo / un único espacio:** **`gemini-embedding-2`** (Gemini Embedding 2, multimodal
nativo: texto+imagen+video+audio+PDF; 3072-dim nativo, **lo guardamos truncado a 1536** vía
Matryoshka — ver Schema). Todo —texto y multimedia— cae en el MISMO espacio → una query de texto
recupera también imágenes/docs visuales (cross-modal gratis). Sin discriminadores ni fan-out. (Slug
exacto y formato de input multimodal del endpoint → verificar con context7 + openrouter.ai/models al implementar.)

**Por qué 002-solo y NO una cadena de varios embebedores:** dos modelos distintos = dos espacios
vectoriales **incomparables** (misma dimensión ≠ mismo espacio). La query DEBE embeberse con el mismo
modelo que los documentos. Por eso un "fallback" entre embebedores rompe el RAG. Resiliencia correcta
= reintento sobre el mismo modelo + degradar (query → sin RAG; ingesta → encolar/reintentar). Cambiar
el modelo canónico = re-indexar todo. (Optimización futura documentada: sumar `gemini-embedding-001`
solo-texto como segundo espacio si el costo de texto puro llegara a importar — hoy no aplica.)

**Schema:** `documents(... embedding vector(1536) ...)` + índice HNSW `vector_cosine_ops`.
pgvector limita el índice **HNSW a 2000 dims** para el tipo `vector` → guardamos **1536** (Matryoshka,
sin pérdida de calidad y mitad de storage); el adapter pide `dimensions: 1536` al modelo. (Para 3072
completos: `halfvec(3072)`, indexable hasta 4000 — alternativa documentada, no usada.)

**Costo:** ingestar todo el portafolio (~80k palabras + 9 imágenes) ≈ **3–5 centavos** a $0.20/1M
tokens. Los embeddings son ruido en la factura; el costo real está en el modelo de chat.

**Triage de documentos (ingesta) — diseño para fase 2 (hoy la ingesta sólo lee HTML/texto público):**
1. Detectar MIME/tipo.
2. Texto plano / md / código / HTML / JSON → leer → chunk → embed (texto).
3. PDF / docx / pptx / xlsx → extraer texto. Limpio y texto-dominante → texto. Escaneado o rico en
   visuales (tablas/charts/diagramas) → embeber la página/imagen (002 multimodal) o visión→caption→texto.
4. Imagen → 002 directo (o caption→texto). Audio → STT→texto. Video → 002 nativo (o keyframes+transcripción).
"A texto plano primero" = default barato; multimodal directo cuando el contenido visual importa.

## Observabilidad

Logging estructurado a stdout (pino) instrumentando todo el servicio. **Plan/diseño completo →**
[`superpowers/specs/2026-06-11-vaio-observability.md`](superpowers/specs/2026-06-11-vaio-observability.md).
Resumen: puertos `Logger` + `TraceSink` (core puro); taxonomy `TraceEvent` en `@vaio/contracts`
**diseñado para persistir a futuro** (debug/historial de chats); redacción de contenido tras
`LOG_PROMPTS`. Implementado y verificado e2e (rama `feat/observabilidad-logs`).

## Compresión de contexto (cavemem · 2026-06-12)
Para **escalar el uso de tokens desde ahora**, se adopta **`@cavemem/compress`** (`JuliusBrussee/cavemem`,
**MIT**, TS, cero deps) **vendorizado** como `packages/compress` (`@vaio/compress`, licencia preservada +
atribución). Es un compresor **determinístico y offline** (sin llamada a modelo) que preserva
código/URLs/números/identificadores byte-a-byte y comprime solo prosa. Memoria de **dos tiers**: Tier 1
(determinístico) sobre el **contexto que se manda al modelo** — resumen + turnos históricos + chunks de
RAG; Tier 2 (resumen LLM) solo para acotar hilos largos. **No** comprime la query viva ni la persona;
comprime **al enviar, no al guardar** (turnos crudos en DB). Es una **primitiva transversal** (puerto
`Compressor`) reusable luego en facts/ingesta y alineada con el norte "Vaio harness" (cavemem es TS+MCP).
Diseño/plan → [`superpowers/specs/2026-06-12-cavemem-compression-{design,plan}.md`](superpowers/specs/).

## Fase 2 — Memoria viva + escalación (el "se nutre")
- Tabla `facts` + extracción de hechos post-conversación (LLM) + dedup. **Diseñar bi-temporal**
  (`valid_at`/`invalid_at` + `created_at`/`expired_at`; invalidar al INGERIR, no borrar — ver
  `NEXT-STEPS.md` "Grafos"). La compresión de facts es seam futuro (el `Compressor` Tier 1 ya existe).
- **Tool `escalate(question)` + infra de notificación proactiva al owner — IMPLEMENTADO** (2026-06-16, ver
  [`superpowers/specs/2026-06-16-escalate-owner-notifier-design.md`](superpowers/specs/2026-06-16-escalate-owner-notifier-design.md)).
  Un visitante (web/telegram-no-owner) pregunta algo que Vaio no sabe → `escalate` lo PERSISTE (tabla `escalations`)
  y lo NOTIFICA a Kevin por su canal de owner vía el puerto **`OwnerNotifier`** (outbound genérico/maleable, base
  reusable para rutinas/cron/webhooks futuros; Telegram DM hoy, WhatsApp/correo = adapters nuevos). Kevin responde
  **citando** el DM → el inbound de `/tg` correlaciona por `message_id` (determinístico, Inv #8), marca `answered`,
  **retoma al visitante** donde haya push (Telegram, vía `ConversationResumer`) y lo **invita a curar** un fact. Web
  cierra vía fact. **Curación 100% gated por Kevin** (flujo `rememberFact`/`resolveFact`); Vaio NUNCA aprende facts
  por su cuenta de los visitantes. Anti-spam (rate-limit/dedup) + saneo de la pregunta + degradación (Inv #1).

### Norte: "Vaio se nutre solo" — memoria viva auto-curada + self-awareness (visión, 2026-06-13)
Materializa el **Invariante #3** (crecimiento orgánico > prompt estático) y el norte "Vaio como harness
personal". **Principio de la línea (NO diluir):** la data del "vivo" viene del **CÓDIGO CRUDO y los repos
(incluido el suyo), leídos en tiempo real** — **NO de scrapear las webs/HTML desplegados**. Hoy la ingesta es
**pull batch de URLs/APIs** (`adapters/sources/*`) → eso es el punto de partida a superar, no el norte. El norte:
Vaio **accede a las fuentes CRUDAS (repos, incl. EL SUYO) y en tiempo real, y DECIDE qué vale la pena guardar**
en memoria (DB → grafos) → "se siente vivo". Decomposición y fase (**paso 4 = `saveFact`, ✅ implementado
2026-06-14; pasos 1-3 = pendientes, son el corazón del "vivo" aún por construir**):
1. **Fuentes crudas** (repo md/código, no HTML desplegado) — collectors `collectX()→DocChunk[]` en
   `adapters/sources/`; cercano e independiente del harness.
2. **Self-awareness**: Vaio ingiere su propio repo ("sus tripas") — collector local (⚠️ excluir secrets/`.env`).
3. **Acceso en tiempo real / on-demand**: retrieval como **read-action del harness** (eje 2); sync continuo → Fase 3.
4. **Curación agéntica** ("Vaio decide qué guardar"): **write-action** (`recordar`/`saveFact`) con flag
   side-effecting + **HITL** → escribe `facts`. **Corazón del "vivo"**; depende del **harness (eje 2)** + esta
   Fase 2. El feedback correctivo del panel de conversaciones se ata acá (confirmed/corrected/rejected).
5. **Grafos**: `facts` → Graphiti bi-temporal (Fase 3).
> Conexión con el grounding (hecho): el prompt deja los hechos en la MEMORIA; esto es **cómo la memoria crece
> sola**. Al diseñar el **harness** (eje 2), las write-actions + HITL son el seam de "Vaio decide qué recordar".
> Detalle/decomposición → `docs/superpowers/specs/2026-06-13-grounding-voice-not-facts-design.md` (§visión).
- **Telegram bot** (webhook): te notifica la duda y por ahí respondés/charlás con el agente.
- **Correo saliente** (Resend, ya está) para notificarte.
- Tu respuesta (Telegram/correo) → se ingiere como `fact` → la próxima vez responde sin escalar.

## Fase 3 — Avanzado
- Migrar memoria a **Graphiti** (grafo temporal: qué cambió y cuándo, procedencia).
- **Correo entrante** (Postmark/Cloudflare Email). **Cron** de refresco. Métricas. Más tools/acciones.

## Costos (MVP, tráfico bajo)
OpenRouter ~$1–5/mes (modelo barato + caching) · Neon free · Railway ~$5/mes · embeddings
centavos · Upstash free. **≈ $5–10/mes**. (Re-verificar al construir.)

## Riesgos
- **Abuso/costo**: mitigado con auth del agente + rate-limit + origin-check.
- **Calidad del modelo barato**: cadena de fallback + primario decente + prompt caching.
- **Datos post-corte**: fijar modelos/precios reales al construir (context7 + docs vivas).
- **Privacidad**: solo fuentes públicas + lo que le cuentes; secrets en env, nunca en git.

## Verificación (Fase 1)
- Vaio local: `POST /chat "¿qué tecnologías usa Kevin?"` → responde citando el CV (RAG OK).
  Matar el primario → sigue respondiendo (fallback OK). `GET /health` OK.
- Portafolio: ChatSheet abre, envía y **streamea**; proxy bloquea origins ajenos + rate-limit;
  funciona ES/EN.
- Deploy: Vaio en Railway (health verde), proxy del portafolio apuntando; smoke test end-to-end.
- Proceso: context7 para Astro/React/Vercel AI SDK/Hono/Drizzle/Biome al implementar;
  `pnpm -r typecheck`, `pnpm -r build`, `pnpm exec biome check .` y `pnpm -r test` pasan.

---

## Apéndice — fundamentos y fuentes (research 2026)

- **Memoria/grafo**: Graphiti (Zep, arxiv 2501.13956) · mem0 · Letta/MemGPT. **Compresión adoptada:
  cavemem** (`JuliusBrussee/cavemem`, MIT → vendorizado como `@vaio/compress`), determinístico/offline.
- **Frameworks**: Vercel AI SDK (ai-sdk.dev) · Mastra · Claude Agent SDK.
- **Gateways**: OpenRouter (fallback por array) · Vercel AI Gateway · LiteLLM · Portkey.
- **Modelos baratos+tool-use** (verificar al construir): DeepSeek, Gemini Flash-Lite, Qwen3,
  MiniMax, Mistral Small/Nemo, Llama (free en OpenRouter como red).
- **Human-in-the-loop**: "human-on-the-loop" (autónomo, escala en excepciones) — cola de dudas
  + notificación + ingesta de la respuesta como hecho (active learning sin fine-tuning).
- **Canales**: Telegram webhook · Resend saliente (ya existe) · entrante Postmark/Cloudflare (fase 3).
