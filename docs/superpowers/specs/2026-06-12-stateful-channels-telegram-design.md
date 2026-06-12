# Spec — Núcleo conversacional + arnés + capacidades por canal + Telegram (Iteración 2)

**Estado:** aprobado 2026-06-12 · feature branch `feat/conversational-core-telegram`.
**Norte/fundacional:** [`../../SPEC.md`](../../SPEC.md) · **Estado+siguiente:** [`../../NEXT-STEPS.md`](../../NEXT-STEPS.md).

## Contexto

Vaio está desplegado (Fase 1: `/chat` stateless con RAG). Antes de integrarlo al portafolio, Kevin
quiere una **primera versión bastante más capaz**: **conversar óptimamente con memoria** (no mensajes
sueltos por POST), con un **arnés** que dictamine cómo trabaja, **capacidades distintas por canal**, y
un **canal para hablarle ya** reusando infra existente (**Telegram Bot API**) en vez de construir
transporte desde cero. Hoy el agente es **stateless por request** (el caller manda todo el historial;
`conversationId` solo se usa para trazas; solo existe la tabla `documents`; una sola tool
`searchMemory`; system prompt fijo). Esta iteración construye el cimiento conversacional + el seam de
canales/capacidades para que las fases siguientes (HITL, facts, Graphiti, portafolio) enchufen sin
reescribir el core.

**Decisiones de alcance (cerradas con Kevin):**
1. **Iteración 1** = núcleo conversacional + arnés + abstracción canal/capacidades + **Telegram**.
   **Diferido** (cada uno su propio spec luego): HITL/escalación, `facts` semánticos, Graphiti, y la
   **integración del portafolio** (se mantiene `/chat` como canal web para pruebas locales).
2. **Memoria** = historial persistido + **resumen rodante** (LLM, lossy; la compresión determinística
   "cavemem" se sumó aparte → `2026-06-12-cavemem-compression-design.md`). Sigue el RAG sobre
   `documents`. **Sin** tabla `facts` ni Graphiti.
3. **Capacidades** = **perfil por canal** (Telegram = pleno; web/portafolio = capado en info y
   acciones). Permisos **por-usuario** = **seam documentado**, sin RBAC. Telegram: identidad =
   allowlist del user id de Kevin por env.
4. **Telegram ahora** = conversar + `searchMemory`. El arnés debe permitir agregar tools "gated" por
   canal después; **sin** acciones con efectos secundarios todavía.

**Enfoque (Approach A):** core **stateful** vía un puerto `ConversationStore`; los canales son
**adapters entrantes** que normalizan a un `TurnRequest`; el **arnés** (armado de system prompt +
política de capacidades + ensamblado de memoria) son **módulos puros** en `core/`. Honra
ports/adapters-lite, mantiene el core puro y testeable, y respeta el stack ya elegido (AI SDK
standalone, sin frameworks pesados).

## Invariantes a preservar
- El agente **nunca** tira error crudo → degrada a `courtesy(locale)`. `/health` siempre 200.
- `core/` depende de puertos, no de adapters; `index.ts` hace todo el wiring/inyección.
- ESM con sufijo `.js`, TS estricto (`noUncheckedIndexedAccess`), Biome, Vitest.
- Trazas vía `TraceSink`; redacción en `core/logging.ts`. La persistencia de conversación (memoria de
  **producto**) es **distinta** de la traza (memoria de **dev**) — no mezclar.

## 1. Puerto `ConversationStore` (nuevo)
`apps/agent/src/ports/conversation.ts` — tipos de dominio **internos al agente** (no al contrato wire):
```ts
interface StoredMessage { role: "user" | "assistant"; content: string }
interface ConversationContext { conversationId: string; summary: string; recent: StoredMessage[]; messageCount: number }
interface TurnRecord { user: string; assistant: string; usage?: Usage }   // Usage ya existe en @vaio/contracts
interface ConversationStore {
  ensure(channel: Channel, threadKey: string, locale: string): Promise<string>          // getOrCreate → id interno
  loadContext(conversationId: string, recentLimit: number): Promise<ConversationContext> // summary + últimos K + count
  appendTurn(conversationId: string, turnId: string, rec: TurnRecord): Promise<void>      // idempotente por turnId
  updateSummary(conversationId: string, summary: string, summarizedUpToMessageId: number): Promise<void>
}
```
Adapter `apps/agent/src/adapters/neon-conversation.ts` (Drizzle, espejo de `neon-memory.ts`:
`createConversationStore(db)`). Fake in-memory en `test/fakes/in-memory-conversation.ts` para tests.

## 2. Core stateful — `core/agent.ts` (modificar)
- `createAgent` recibe deps nuevas: `{ model, memory, conversations: ConversationStore|null,
  summarizer: Summarizer|null, capabilities: CapabilityResolver, summaryThreshold=12, recentLimit=10 }`.
- **Nueva firma** (async): `respond(req: TurnRequest, ctx: TurnContext): Promise<RespondResult>` con
  `RespondResult = { stream: ReadableStream<Uint8Array>; text: Promise<string> }`. **Una sola** llamada
  `streamText`; se **tee-ea** el `textStream` → el `stream` para HTTP (passthrough) y el `text` (texto
  final acumulado) para canales no-streaming (Telegram `await result.text`). `text` **nunca rechaza**
  (resuelve `courtesy` si el modelo falló/no emitió).
- **Flujo del turno:** `ensure` → `capabilities.resolve(channel, principal)` →
  `loadContext(recentLimit)` → `buildSystemPrompt({locale, policyText, summary})` →
  `messages = [...recent, {role:"user", content: userText}]` → `streamText({ system, messages,
  tools: buildTools(caps, memory, emit), stopWhen: stepCountIs(5), ...instrumentación igual a hoy })`.
- **Persistencia + resumen en background** tras cerrar el stream (en el finalizer, `void persist()`,
  **sin bloquear** al consumidor, todo `try/catch` → en fallo `logger.error` + `turn.error
  where:"persist"|"summary"`; jamás afecta la respuesta ya entregada): `appendTurn(...)`; si
  `messageCount+2 >= summaryThreshold` y hay summarizer → resumir (§4).
- Si `conversations===null` (sin DB) → **modo stateless single-turn** (sin ensure/load/append).
- `courtesy(locale)` se mantiene exportado (lo reusan los adapters).

## 3. Arnés — módulos puros en `core/` (nuevos)
- `core/prompt.ts`: `personaPrompt(locale)` (mueve el body del `systemPrompt` actual) +
  `buildSystemPrompt({locale, policyText, summary})` → `[persona, policyText, summary?]`. El resumen va
  al **system**; los turnos recientes van como **model messages**.
- `core/capabilities.ts`: `CapabilityProfile { channel, allowedTools: ToolName[], memoryScope:{sources?,
  maxK}, policyText }`; `Principal { channel, id, trusted }`; `CapabilityResolver.resolve(channel,
  principal)`; `createCapabilityResolver()`. Perfiles: **telegram(trusted)** → maxK 8, policy "full
  agentic, hablás con Kevin"; **web(capped)** → `sources:["cv","cv-en","me","github","lastfm"]`, maxK 6,
  policy "chat público; no reveles internals". El cap vive en **policyText + memoryScope** (mismo tool
  set hoy) y la estructura deja agregar tools de acción gated por canal sin reescribir.
- `core/tools.ts`: `buildTools(caps, memory, emit, logger)` — registry **gated**: arma `searchMemory`
  (extrae el body inline actual de `agent.ts`, con `k = caps.memoryScope.maxK`) e **incluye solo** las
  tools en `caps.allowedTools`. Agregar acción futura = nuevo builder + listarla en el perfil.

## 4. Resumen rodante — `core/summary.ts` (puro) + puerto `Summarizer`
- `shouldSummarize({messageCount, threshold}): boolean` (count-based, determinista/testeable;
  token-based = refinamiento futuro). `buildSummaryPrompt({priorSummary, olderMessages, locale})`
  (LLM: condensa summary previo + turnos que salen de la ventana en un running summary terso de hechos).
- Puerto `apps/agent/src/ports/summary.ts` `Summarizer.summarize(input): Promise<string>`; adapter
  `adapters/summarizer.ts` usa `generateText` (no-streaming) con **modelo barato** (`SUMMARY_MODEL` o
  la cola de la cadena), sobre el provider OpenRouter (con su fallback array). Falla → log + mantener
  ventana cruda; nunca rompe el turno (corre en el `persist()` de background).

## 5. Contratos — `packages/contracts/src/index.ts` (modificar)
Agregar (boundary normalizado que un futuro cliente web/proxy debe acordar):
```ts
channelSchema = z.enum(["web","telegram"])        // "email" luego
turnRequestSchema = z.object({ channel, conversationKey: z.string(), userText: z.string().min(1),
  locale: localeSchema.optional(), principalId: z.string(), trusted: z.boolean().default(false) })
```
`chatBodySchema` **no cambia** esta iteración. `ConversationContext/StoredMessage/TurnRecord/
CapabilityProfile/Principal/Summarizer` quedan **internos** al agente.

## 6. DB — `adapters/db/schema.ts` (modificar, sin pgvector; `documents` intacta)
- `conversations`: `id uuid pk default random`, `channel text`, `thread_key text`, `locale text
  default 'es'`, `summary text default ''`, `summarized_up_to_message_id bigint`, `created_at/updated_at`.
  **unique (channel, thread_key)**.
- `messages`: `id bigserial pk`, `conversation_id uuid fk → conversations (cascade)`, `turn_id text`,
  `role text`, `content text`, `input/output/total_tokens int?`, `created_at`. Índice
  `(conversation_id, id)`; **unique (conversation_id, turn_id, role)** (append idempotente).
- Imports nuevos de `drizzle-orm/pg-core`: `uuid, bigint, integer, uniqueIndex`.
- **Migración (gotcha crítico):** `pnpm --filter @vaio/agent db:generate` emite un **nuevo** `0001_*.sql`
  (CREATE TABLE conversations/messages + índices) y **appendea** `meta/_journal.json`. **NO** tocar/regenerar
  `0000_*.sql` (ahí vive `CREATE EXTENSION vector`). Inspeccionar el diff antes de commitear.
- Queries: `ensure` = `INSERT ... ON CONFLICT (channel, thread_key) DO UPDATE SET updated_at=now()
  RETURNING id`. `loadContext` = select conversación + `messages ORDER BY id DESC LIMIT k` (revertir a
  cronológico) + `COUNT(*)`. `appendTurn` = 2 inserts `ON CONFLICT (conversation_id, turn_id, role) DO NOTHING`.

## 7. Config/env — `config.ts` + `.env.example` (modificar)
Opcionales: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALLOWED_USER_IDS` (csv),
`SUMMARY_MODEL`, `SUMMARY_THRESHOLD` (default 12), `CONVERSATION_RECENT_LIMIT` (default 10). Helpers:
`telegramAllowedIds(env): Set<number>`, `telegramEnabled(env): boolean` (token && secret && ids>0).

## 8. Canales (adapters)
- **Web** (`adapters/http/routes.ts`, refactor): `POST /chat` (auth `x-agent-key` igual) arma
  `TurnRequest` channel:"web", principal trusted:false, `conversationKey = conversationId ?? randomUUID()`,
  `userText = último mensaje user` (guardar contra `undefined` por `noUncheckedIndexedAccess`).
  `const r = await agent.respond(req, ctx); return new Response(r.stream, {headers})`. Degradación igual.
- **Telegram** (`adapters/telegram/{routes,client,normalize}.ts`, nuevos):
  - `client.ts` (**fetch fino, sin dep** — convención "deps livianas"; solo `sendMessage` con chunking a
    ≤4096, `sendChatAction("typing")`, `setWebhook`). Errores se loguean, no se lanzan.
  - `normalize.ts` puro: `normalizeUpdate(u, allowed: Set<number>)` → `{kind:"turn",...}` |
    `{kind:"ignore",reason}` (no-text / sin `from` / **no allowlisted** → ignore).
    `detectTelegramLocale(language_code)` → "es"/"en" (default "es").
  - `routes.ts` `POST /tg`: valida header `X-Telegram-Bot-Api-Secret-Token === TELEGRAM_WEBHOOK_SECRET`
    (mismatch → 401, **no** detrás de `agentAuth`); normaliza; **allowlist gate**; **dedupe por
    `update_id`** (set LRU in-memory, seam a persistir); responde **200 rápido** + `void handleTurn`
    (typing → `respond` → `await r.text` → `sendMessage`; `try/catch` → courtesy). `conversationKey =
    String(chat.id)`, principal trusted:true.
  - **Registro webhook** (one-time, manual): `curl -F url=.../tg -F secret_token=... api.telegram.org/bot<token>/setWebhook`.

## 9. Wiring — `index.ts` (modificar)
- `conversations` solo si `DATABASE_URL` (reusar el `db` ya creado para memory). `summarizer` solo si
  OpenRouter. `capabilities = createCapabilityResolver()` siempre. Inyectar todo en `createAgent`.
- Montar `/tg` **solo si** `telegramEnabled(env)` (construir `createTelegramClient` + `telegramAllowedIds`).
  `buildApp` crece: `{ ..., telegram?: { client, allowedIds, webhookSecret } }`.
- Boot log: agregar `telegram`, `conversations`, `summarizer` (on/off), sin secrets.

## 10. Degradación
Sin OpenRouter → courtesy. Sin DB → `conversations=null` → **stateless single-turn** (responde igual,
sin multi-turno). Sin summarizer → nunca resume, persiste igual. Summarizer falla → log + ventana cruda.
Telegram env faltante → `/tg` no montado. Allowlist miss → reply privado + 200, sin llamar al modelo.
Persist falla → log + `turn.error where:"persist"`, el user ya tuvo respuesta.

## 11. Riesgos / edge cases
Ripple de firma async de `respond` (callers: `/chat`, `/tg`, `agent-loop.test.ts`). Orden stream→persist
(persist tras cerrar; si el cliente corta, se persiste lo emitido). Turnos concurrentes en una conv =
last-writer-wins + unique constraint anti-dupe (cola por-conv = futuro). Retries/duplicados Telegram =
ack 200 rápido + dedupe `update_id` + idempotencia DB. Seguridad: secret header + allowlist; nunca echo
de secrets. Locale Telegram desde `language_code`. **Gotcha #1: no clobberear `0000` al generar `0001`.**

## 12. Orden TDD (tests puros primero)
contratos (Channel/TurnRequest) → cores puros (`prompt`, `capabilities`, `summary`, `tools`, telegram
`normalize`) con sus tests → puerto `ConversationStore` + fake in-memory + test de contrato → refactor
`core/agent.ts` (+ actualizar `agent-loop.test.ts` a la firma nueva) → schema + migración +
`neon-conversation` → `summarizer` → Telegram `client`+`routes` → refactor `/chat` → wiring `index.ts` +
config. Tests nuevos: `prompt`, `capabilities`, `summary`, `tools`, `telegram-normalize`,
`conversation-store` (fake), + casos `config` (telegram helpers). Usar `MockLanguageModelV3` (`ai/test`).

## Verificación
1. `pnpm -r typecheck` (atrapa el ripple) · 2. `pnpm exec biome check .` · 3. `pnpm -r test` (suites
nuevas + `agent-loop` actualizado) · 4. `pnpm build` topológico OK.
5. `db:generate` → **inspeccionar `0001_*.sql`** (solo las 2 tablas, `0000` intacto, journal appendeado);
   con `DATABASE_URL`, `db:migrate` aplica limpio.
6. `pnpm dev` → `/health` 200; `POST /chat` con key → stream; **segundo** POST mismo `conversationId` →
   el modelo tiene contexto previo (ver filas en `messages` / `turn.start.messageCount`>1).
7. Telegram local (sin bot real) via curl simulando un update con el secret header → 200 {ok:true};
   secret incorrecto → 401; `from.id` no allowlisted → 200 sin llamada al modelo. E2E real: `ngrok` +
   `setWebhook`.
8. Fallback: primer modelo malo en `OPENROUTER_MODELS` → cae por la cadena; falla total → courtesy en
   `/chat` y `/tg`, nunca 500/vacío.

## Seguimiento (próximas iteraciones, cada una su spec)
- **HITL/escalación** (Fase 2 del SPEC): tool `escalate` + cola + notificación Telegram + ingesta de la
  respuesta. La superficie de tools gated por canal y el `Principal` ya quedan listos para enchufarlo.
- **Facts semánticos** (Fase 2): extracción post-conversación + tabla `facts`. La persistencia de
  `messages` es el insumo.
- **Permisos por-usuario** (seam de esta iteración): tabla de usuarios/roles + `resolveCapabilities`
  por-principal (hoy solo por canal).
- **Graphiti** (Fase 3) e **integración del portafolio** (proxy `/api/agent` → dominio público).
