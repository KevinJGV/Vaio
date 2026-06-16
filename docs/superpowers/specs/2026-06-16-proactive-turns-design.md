# Design (TÉCNICO) — Turnos proactivos (Nivel C), v1: seam genérico in-process

> **Plan de alto nivel + estrategia de ejecución:** [`2026-06-16-proactive-turns-plan.md`](2026-06-16-proactive-turns-plan.md).
> Este doc = **diseño técnico de bajo nivel** (firmas, flujo, edge-cases). Norte: memoria `proactive-turns-vision`.

## Problema / norte
Vaio debe **RETOMAR solo** tras una tarea en background: disparar algo largo (futuro: `learnRepo`/sync), seguir
conversando, y **cuando termina, re-entrar el loop e iniciar un mensaje** (Telegram) que responde la duda original
— sin que el usuario re-pregunte. Capacidad transversal ("Nivel C") que habilita avisos de tareas largas y `escalate`.

## Decisiones (brainstorming Kevin, 2026-06-16)
- **v1 = seam GENÉRICO, sin trigger** (puerto + re-entrada; cablear learnRepo/sync = incrementos siguientes).
- **In-process** (closure en el proceso vivo; sin DB/worker/cron). Restart pierde la continuación (persistencia=followup).
- **Re-responder la duda original** (re-entrar `agent.respond` con turno sintético), no solo avisar.
- **Telegram-first** (web `/chat` no puede push tras cerrar → resume null en web).

## Seam confirmado (Explore)
- `agent.respond(req: TurnRequest, ctx: TurnContext, media?)` (`core/agent.ts:185`) → `{ stream, text: Promise<string> }`.
  Admite un `TurnRequest` SINTÉTICO: carga historia server-side (`conversations.ensure/loadContext`) y persiste sola.
- `TurnContext` (`core/agent.ts:108`) hoy = `{ logger, sink, requestId }`.
- `ActionContext` se arma en `buildTools({...})` (`core/agent.ts:309`).
- `TelegramClient.sendMessage(chatId, text, { messageThreadId? })` (`adapters/telegram/client.ts`) — singleton, invocable siempre.
- Telegram `handleTurn` (`adapters/telegram/routes.ts:79`) arma el `req` y tiene `deps.agent`/`deps.client`/`norm`.
- **Gaps:** no hay señal de completitud de tareas (hoy `void ctx.repoSync.sync().catch()`), ni seam de continuación, ni scheduler.

## Contratos / firmas

### 1. Puerto — `ports/proactive.ts` (nuevo)
```ts
export interface ProactiveResume {
  /** Registra una tarea en background; al COMPLETAR re-entra el loop con la duda original y entrega la
   *  respuesta por el canal (best-effort, no bloquea el turno actual). Canal sin push (web) → null. */
  resume(task: Promise<unknown>, opts?: { label?: string }): void
}
```

### 2. Threading core (solo pasamanos, sin lógica nueva)
- `core/agent.ts`: `TurnContext` += `resume?: ProactiveResume | null`. En `buildTools({...})` (≈:309) agregar
  `resume: ctx.resume ?? null`.
- `core/actions/types.ts`: `ActionContext` += `resume?: ProactiveResume | null`.
  (Ningún action lo usa en v1. 1er consumidor futuro = `learnRepo`: `ctx.resume?.resume(ctx.repoSync.sync(spec), {label:"learnRepo"})`.)

### 3. Adapter — `adapters/telegram/proactive.ts` (nuevo)
```ts
export function createTelegramResume(deps: {
  agent: Agent
  client: TelegramClient
  logger: Logger
  sink: TraceSink
  req: TurnRequest            // el turno ORIGINAL (conversationKey/userText/locale/principalId/trusted)
  chatId: number
  threadId?: number
  newRequestId: () => string  // inyectable (randomUUID en prod; determinista en test)
}): ProactiveResume
```
`resume(task, opts)` → `void task.then(onDone).catch(onErr)` (NO bloquea el turno actual):
- **onDone(result):** turno SINTÉTICO `synthetic = { ...deps.req }` →
  `const { text } = await deps.agent.respond(synthetic, { logger, sink, requestId: newRequestId(), resume: null })`
  → `const answer = await text` → `await deps.client.sendMessage(chatId, prefix(req.locale) + answer, { messageThreadId: threadId })`.
  **`resume: null` en el turno sintético = guard ANTI-LOOP** (un turno proactivo NO dispara otro).
- **onErr(err):** `logger.warn(... "proactive resume falló")`; NO tira (best-effort, Inv #1). v1: no se manda nada
  (el turno original ya respondió "ya voy"); cortesía opcional = followup.
- Log de observabilidad `"tg: turno proactivo (resume)"` con `label`.
- `prefix(locale)`: es → `"✅ Listo — "`, en → `"✅ Done — "`.

### 4. Wiring del canal
- `adapters/telegram/routes.ts` (`handleTurn`): tras armar `req`, construir
  `const resume = createTelegramResume({ agent: deps.agent, client: deps.client, logger: log, sink: deps.sink, req,
  chatId: norm.chatId, threadId: norm.threadId, newRequestId: randomUUID })` (solo si `deps.agent`) y pasarlo:
  `deps.agent.respond(req, { logger: log, sink: deps.sink, requestId, resume }, resolved)`.
- `adapters/http/routes.ts` (`/chat` web): NO pasa `resume` (queda `undefined` → null) → sin push.

## Edge cases / invariantes
- **Anti-loop:** turno sintético con `resume: null`. Un test lo fija explícitamente.
- **#1 best-effort:** tarea o re-entrada que falle → log, nunca rompe; el turno original ya respondió.
- **Concurrencia:** el proactivo corre DESPUÉS de terminar la tarea (turno original cerrado). Si el user mandó otro
  mensaje entremedio, ambos appendean a la conversación (orden levemente entrelazado, aceptable v1).
- **Duplicado de userText:** el sintético re-pregunta el original → conversación [user X][assist "ya voy"][user X]
  [assist <real>]. Aceptable v1 (el prefijo "✅ Listo" lo enmarca). Refinar el framing = followup.
- **Durabilidad:** in-process → restart pierde la continuación. Documentado; persistencia (tabla + worker) = followup.
- **Web:** resume null → `ctx.resume?.resume(...)` es no-op.

## Testing (TDD)
`telegram-proactive.test.ts` con fakes de `agent` (respond → `{ text: Promise.resolve("answer"), stream }`) + `client`:
- task RESUELTA → `agent.respond` re-invocado con `req` sintético (mismo conversationKey/userText) **y `resume:null`**
  (anti-loop) → `client.sendMessage(chatId, prefix+"answer", { messageThreadId })`.
- task RECHAZADA → NO se manda respuesta; se loguea; no tira.
- `prefix` por locale (es/en).
- (pasamanos) `ActionContext.resume` llega desde `TurnContext.resume` — test liviano (fake action que lee `ctx.resume`).

## No-trigger en v1
Ningún action invoca `resume` aún → **no hay e2e en vivo**; verificación = tests + no-regresión (boot + `/chat` normal).

## Followup (refinamiento de Kevin 2026-06-16) — el PRINCIPIO que corona el fundamento
**TODO proceso que conversacionalmente conlleve a una tarea de fondo se debe PESCAR al finalizar para que Vaio
continúe el tema — SIEMPRE avisando** (al dispararlo) "en cuanto termine, retomo". Próxima fase = **barrido AGÉNTICO**
de todos los sitios detectables donde un action **difiere la respuesta real** a una tarea de fondo, y cablear cada uno:
`ctx.resume?.resume(task, {label})` + que el action **devuelva el aviso** ("ya voy, te retomo al terminar").
**Distinción clave:** bg **user-waiting** (difiere la respuesta → necesita resume; p.ej. `learnRepo`) vs bg
**silencioso** (freshness gate / `ensureRepoReady` / `ensureFresh` — el user ya tuvo respuesta con caveat → NO resume).
Otros followups: persistencia (tabla+worker, sobrevive restart), framing del turno sintético, cortesía en onErr, web
(canal push SSE/WS).
