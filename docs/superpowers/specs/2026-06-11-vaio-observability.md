# Spec — Observabilidad de Vaio (logs estructurados a stdout, listos para persistir)

**Estado:** implementado y verificado e2e (rama `feat/observabilidad-logs`, jun-2026; pendiente merge).
**Tipo:** feature de Fase 1 (cross-cutting). **Norte/visión:** [`../../SPEC.md`](../../SPEC.md).

> Este archivo es el **plan/diseño durable** de la feature (promovido del plan de plan mode). El
> `docs/SPEC.md` queda como visión/norte y solo lo referencia. Responsabilidades de docs en
> [`../../../CLAUDE.md`](../../../CLAUDE.md) → "Metodología".

## Contexto

Antes de desplegar Vaio a Railway, Kevin quiere **control y gestión**: ver todo lo relevante de la
ejecución del agente — uso de tools y sus respuestas, el "pensamiento"/razonamiento del modelo, y
cada vuelta del agent loop. Antes solo había `console.*` sueltos con prefijos `[tag]`: nada
estructurado, nada correlacionable por conversación, nada buscable ni reusable.

**Objetivo:** logging estructurado a **stdout** con `pino` (lo captura Railway), instrumentando
**todo el servicio** (boot, HTTP, agent loop, searchMemory, ingest). El modelo de eventos se diseña
con la riqueza de "máxima visibilidad" y detrás de una **abstracción de sink**, para que features
futuras (debug de conversaciones, persistencia de chats vía CRUD) sean **un adapter nuevo, no un
rewrite**. Salida por defecto segura (razonamiento + tools/usage siempre; texto crudo de prompts
solo con `LOG_PROMPTS=on`).

Encaja con ports/adapters y con el AI SDK v6 (verificado en context7 + `.d.ts` instalados:
`onChunk` da `tool-call`; `onStepFinish` da `stepNumber`/`reasoningText`/`toolCalls[].input`/
`toolResults[].output`/`model.modelId`/`finishReason`/`usage`; `onFinish` da `steps`/`totalUsage`).

## Arquitectura (dos preocupaciones, dos puertos)

1. **`Logger` (logs operativos)** — niveles, JSON en prod / pretty en dev, redacción de secrets.
   Lo usa todo el servicio (boot, HTTP, ingest, errores). Backend: **pino**.
2. **`TraceSink` (eventos de dominio de un turno)** — el flujo rico y *persistible*:
   `turn.start → tool.call → tool.result → reasoning → llm.step → turn.finish | turn.error`,
   correlacionados por `requestId` (+ `conversationId` opcional). Hoy **una sola impl**:
   `loggerTraceSink` (serializa cada evento por el `Logger` aplicando la redacción). **Mañana**: un
   `drizzleTraceSink` que escribe a Postgres → habilita el CRUD de debug/persistencia **sin tocar el core**.

El `core/agent` depende de los **puertos**, nunca de pino ni de la DB. El wiring (`index.ts`) inyecta.

## Componentes / archivos

**Contracts (`@vaio/contracts`, futuro-ready para el CRUD web):**
- `src/trace.ts` — zod + tipos del **taxonomy de eventos** `TraceEvent` (unión discriminada por
  `type`), con `requestId`, `conversationId?`, `turnId`, y payload por tipo. Los campos de contenido
  (mensajes, args/output de tools, reasoning) **existen completos** en el schema (máxima visibilidad);
  la redacción se aplica al emitir. Reexportado desde `src/index.ts`.
- `chatBodySchema`: `conversationId` opcional (el proxy del portafolio puede hilar una conversación).

**Puertos (`apps/agent/src/ports/`):** `logger.ts` (`Logger`) y `trace.ts` (`TraceSink`).

**Adapters (`apps/agent/src/adapters/`):**
- `logger.ts` — `createLogger({ level, format, nodeEnv })` → `Logger` sobre **pino**. pretty →
  transport `pino-pretty`; json → pino default. `redact` de paths sensibles; `child()` → pino child.
- `trace-logger.ts` — `createLoggerTraceSink(logger, { logPrompts })`: aplica la política y emite
  cada evento como una línea estructurada del logger.

**Lógica pura (`apps/agent/src/core/logging.ts`):** `resolveLogFormat` + `toLogRecord` (redacción).
Testeable sin montar pino.

**Wiring e instrumentación:** `index.ts` (logger+sink+boot log), `routes.ts` (middleware `requestId`
+ child logger + `request.start/finish` + pasa `ctx` a `agent.respond`), `core/agent.ts` (emite los
eventos del turno; degradación a cortesía intacta), `ingest.ts`/`migrate.ts`/`openrouter.ts`
(console→logger). `config.ts` se queda con `console.error` en su fail-fast (corre antes del logger).

## Modelo de eventos (taxonomy)

Unión discriminada `TraceEvent` (comunes: `type`, `requestId`, `conversationId?`, `turnId`):
- `turn.start` — `{ locale, messageCount, lastUserPreview? }`
- `reasoning` — `{ stepNumber?, text }` (el "pensamiento")
- `tool.call` — `{ toolCallId, toolName, args? }`
- `tool.result` — `{ toolCallId, toolName, output?, hits?, latencyMs?, ok? }`
- `llm.step` — `{ stepNumber, modelId?, finishReason, usage? }`
- `turn.finish` — `{ steps, usage?, durationMs }`
- `turn.error` — `{ message, where }`

`args`/`output`/`text`/`lastUserPreview` son redaction-aware: el schema los admite completos (para
el futuro sink de DB), pero `loggerTraceSink` los recorta/oculta según la política al ir a stdout.

## Política de redacción / seguridad (chat público)

- **Nunca**: keys/secrets (`AGENT_API_KEY`, `OPENROUTER_API_KEY`, headers de auth), ni el system
  prompt. `redact` de pino como red de seguridad sobre paths conocidos.
- **Siempre** (default seguro): tipos de evento, ids, **nombres** de tools, `#hits`, `usage`/tokens,
  `finishReason`, duraciones, `modelId`, conteos, y el **texto de `reasoning` truncado** (~2000 chars).
- **Solo con `LOG_PROMPTS=on`** (default off; on en dev): texto crudo de mensajes del usuario, `args`
  y `output` crudos de tools, y reasoning completo sin truncar.

## Config / entorno (`config.ts` zod + `.env.example`)

- `NODE_ENV` — `development|production|test`, default `development` (Railway setea `production`).
- `LOG_LEVEL` — `trace|debug|info|warn|error|silent`, default `info`.
- `LOG_FORMAT` — `pretty|json|auto`, default `auto` (pretty si `NODE_ENV !== production`, si no json).
- `LOG_PROMPTS` — boolean (acepta `true`/`1`; cualquier otra cosa = false), default `false`.

## Deps

`pino` (dependency) + `pino-pretty` (devDependency; transport solo en dev, prod = JSON).

## Tests (TDD, Vitest)

- `resolveLogFormat` — auto/pretty/json × NODE_ENV.
- **Política de redacción** (`toLogRecord`) — oculta args/output/mensajes sin `logPrompts`; reasoning
  truncado; metadata siempre; con `logPrompts` aparece todo.
- **Sink** (`createLoggerTraceSink`) — nivel correcto por evento y redacción respetada.
- **Loop** — `MockLanguageModelV3` + sink fake: `turn.start` con metadata; modelo que cae → `turn.error`
  + cortesía (degradación intacta). (25 tests verdes en total.)

## Extensión futura (documentada, NO construida)

Para el debug de conversaciones / persistencia de chats:
- Tablas Drizzle `conversations` / `turns` / `events` (migración nueva).
- `adapters/trace-drizzle.ts` (`drizzleTraceSink`) con el MISMO puerto; el wiring emite a ambos sinks
  (`fanoutTraceSink([...])`).
- Endpoints protegidos de lectura (`GET /conversations`, `GET /conversations/:id/events`) para el CRUD/UI.
- `conversationId` hilado desde el proxy del portafolio (ya opcional en `chatBodySchema`).
Nada de esto altera el core: solo adapters/rutas. **Esa es la "infra aprovechable".**

## Verificación (evidencia)

1. `pnpm -r typecheck` + `pnpm exec biome check .` + `pnpm -r test` (25) limpios.
2. `pnpm dev` → log de **boot** con features on/off (pretty en dev).
3. `/chat` (con `x-agent-key`) → traza completa en stdout: `request.start → turn.start → tool.call
   (searchMemory) → tool.result → reasoning → llm.step (modelId/usage) → turn.finish`, mismo `requestId`.
4. Redacción: sin `LOG_PROMPTS` no aparece texto crudo de prompts ni args/output; con `LOG_PROMPTS=on`, sí.
   Nunca aparece una key.
5. `LOG_FORMAT=json` → líneas JSON (como las verá Railway).

**Verificado e2e (jun-2026)** con keys reales: `/chat` respondió RAG real; traza completa y
correlacionada (`requestId`+`turnId`+`conversationId`); redacción on/off; sin secrets en claro;
formatos json y pretty; degradación/cortesía intacta.
