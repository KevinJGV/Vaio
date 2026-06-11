# Spec — Agente personal de IA "Vaio"

**Estado:** Fase 1 (MVP) — código completo y verificado (monorepo pnpm + ports/adapters +
Drizzle + Biome/Vitest, deps al día, Node 24); **pendiente keys + deploy**. Actualizado 2026-06-10
**Repos:** este spec vive en AMBOS — el portafolio (`KevinJGV`) y el repo del agente
(`Vaio`). Mantener en sync.

> Feature grande nueva → flujo spec-driven. El agente vive en **repo aparte `Vaio`**; el
> portafolio solo suma un chat-sheet + un proxy. Implementación: subagent-driven.

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
| **Compresión memoria** | "caveman" al guardar conversaciones — fase 2 | — |
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
- **Embeddings**: modelo barato hosteado (decidir al construir; p.ej. OpenAI `text-embedding-3-small`).
- **Ingesta** (`ingest.ts`, a mano y luego cron Railway):
  - `cv.vindevsito.dev/` y `/en/` → texto limpio del CV.
  - `vindevsito.dev/me`, `/contact` → "sobre mí" / posicionamiento.
  - **GitHub API** (token read-only): perfil, repos, lenguajes, pinned, READMEs.
  - **Last.fm** → gustos musicales / now-playing.
  - chunk → embed → upsert en `documents`. Lee fuentes públicas (desacoplado).
- **System prompt**: persona "asistente de Kevin" (persona/pro/dev), tono alineado con sus
  quirks (señal cultural deliberada, no neutralizar), responde en el **idioma del usuario**.
- **Endpoints MVP**: `POST /chat` (stream, requiere header `AGENT_API_KEY`), `GET /health`.

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

## Fase 2 — Memoria viva + escalación (el "se nutre")
- Tabla `facts(id, fact, source, valid_from, embedding)` + extracción de hechos post-conversación
  (LLM) + dedup. Compresión **caveman** antes de guardar.
- Tool `escalate(question)` con umbral de confianza → cola `unknown_questions`.
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

- **Memoria/grafo**: Graphiti (Zep, arxiv 2501.13956) · mem0 · Letta/MemGPT · "caveman" =
  compresión a hechos densos (github.com/wilpel/caveman-compression).
- **Frameworks**: Vercel AI SDK (ai-sdk.dev) · Mastra · Claude Agent SDK.
- **Gateways**: OpenRouter (fallback por array) · Vercel AI Gateway · LiteLLM · Portkey.
- **Modelos baratos+tool-use** (verificar al construir): DeepSeek, Gemini Flash-Lite, Qwen3,
  MiniMax, Mistral Small/Nemo, Llama (free en OpenRouter como red).
- **Human-in-the-loop**: "human-on-the-loop" (autónomo, escala en excepciones) — cola de dudas
  + notificación + ingesta de la respuesta como hecho (active learning sin fine-tuning).
- **Canales**: Telegram webhook · Resend saliente (ya existe) · entrante Postmark/Cloudflare (fase 3).
