# Diseño técnico — Persistencia de traces (DB traceability)

> **Altitud:** spec TÉCNICO (firmas, DDL, edge-cases). Plan de alto nivel →
> [`2026-06-13-trace-persistence-plan.md`](2026-06-13-trace-persistence-plan.md). Estado → `../../NEXT-STEPS.md`.

## Problema

La traza de cada turno (`TraceEvent`: turn.start, reasoning, tool.call/result, llm.step, turn.finish/error,
+ los `media.*` que loguea el adapter) existe **solo en stdout** (efímero). `trace.ts` ya lo anticipa:
*"diseñado para PERSISTIR a futuro; mañana un sink de Postgres escribe ESTOS MISMOS eventos para habilitar
debug de conversaciones / historial sin tocar el core"*. La tabla `messages` es mínima (role, content,
attachments, tokens). Kevin quiere **trazabilidad real en la DB** (referencia/norte: el schema `messages` del
componente `agent` de Convex — model/provider/usage/finishReason/status/error/warnings/reasoning/sources/
stepOrder/parentMessageId/partes estructuradas). Objetivo: implementar el **PgTraceSink** ya previsto.

## Decisiones

1. **Event-stream, no message-centric.** Tabla `trace_events` **append-only** que persiste los `TraceEvent`
   tal cual (1 fila por evento). Es más completa para debug (captura el ciclo del turno: reasoning + tool
   calls + per-step model + errores) y **alineada al diseño existente** (el sink de stdout y el de pg escriben
   los MISMOS eventos). El schema Convex (message-centric, enorme, con uniones por cada parte) es **norte, no
   clon**: para nuestra escala (Postgres, single-dev, tráfico bajo) un `jsonb` payload + columnas hot alcanza.
2. **Separada de `messages`.** `messages` = memoria conversacional (lo que el modelo ve; se mantiene lean para
   cargar contexto). `trace_events` = capa de auditoría/observabilidad. **Join por `turn_id`** cuando el panel
   futuro necesite ambos. No bloatear `messages` (degradaría las lecturas de contexto).
3. **Contenido completo en DB.** El `PgTraceSink` recibe el evento **crudo** (sin redactar) y lo persiste
   entero — la redacción `LOG_PROMPTS` es un concern de **stdout** (logs pueden filtrarse; la DB es privada).
   El panel necesita ver prompts/tool-args/reasoning. (Flag futuro si se quiere redactar también en DB.)
4. **Best-effort, nunca rompe el turno** (invariante "siempre responde"). El sink es fire-and-forget
   (`emit(e): void`). El PgTraceSink inserta **async best-effort**: error → log debug, jamás throw. Por evento
   (no batch): ~7-9 inserts/turno, aceptable a tráfico bajo; batch = optimización futura.
5. **Orden preservado con `seq`.** Inserts async pueden reordenar `created_at`/`id` → el sink asigna un `seq`
   monotónico **por turno** (Map<turnId, n> en el sink, incrementado en `emit` síncrono) → el panel ordena por
   `(turn_id, seq)`.
6. **Composite sink.** `createCompositeTraceSink([loggerSink, pgSink])` → `emit` fan-out a ambos. stdout sigue
   igual; pg se suma si hay DB + `TRACE_PERSIST`.

## Firmas / DDL

### `apps/agent/src/adapters/db/schema.ts` (+ tabla)
```ts
export const traceEvents = pgTable("trace_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  requestId: text("request_id").notNull(),
  conversationId: uuid("conversation_id"),   // nullable: turnos stateless no tienen. SIN FK dura
  turnId: text("turn_id").notNull(),
  seq: integer("seq").notNull(),             // orden dentro del turno (asignado en emit)
  type: text("type").notNull(),              // turn.start | reasoning | tool.call | ... | media.*
  payload: jsonb("payload").$type<TraceEvent | Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  index("trace_events_conv_idx").on(t.conversationId, t.id),
  index("trace_events_turn_idx").on(t.turnId, t.seq),
])
```
Migración `0003_*.sql` (additiva, tabla nueva → no toca nada existente). Dev `db:push`; prod
`generate`+`migrate` vía `railway.json preDeployCommand`.

### `apps/agent/src/ports/trace.ts` (puerto existente — sin cambios)
`TraceSink.emit(e: TraceEvent): void`. (Los `media.*` hoy son `logger.info`, no `TraceEvent` — ver edge-cases.)

### `apps/agent/src/adapters/trace-pg.ts` (NUEVO)
```ts
export function createPgTraceSink(db: Db, logger: Logger): TraceSink {
  const seqByTurn = new Map<string, number>()   // orden por turno
  return {
    emit(e) {
      const seq = (seqByTurn.get(e.turnId) ?? 0)
      seqByTurn.set(e.turnId, seq + 1)
      if (e.type === "turn.finish" || e.type === "turn.error") {
        // liberar el contador del turno tras un tick (evita leak; los inserts ya tomaron su seq)
        queueMicrotask(() => seqByTurn.delete(e.turnId))
      }
      void insert(db, e, seq).catch((err) =>
        logger.debug({ err: errMsg(err) }, "trace persist falló")  // best-effort
      )
    },
  }
}
```
`insert` mapea `e` → fila (`requestId/conversationId?/turnId/seq/type/payload:e`). `conversationId` solo si es
uuid válido (los stateless no lo traen).

### `apps/agent/src/adapters/trace-composite.ts` (NUEVO)
```ts
export function createCompositeTraceSink(sinks: TraceSink[]): TraceSink {
  return { emit: (e) => { for (const s of sinks) s.emit(e) } }
}
```

### Config / wiring (`config.ts` + `index.ts`)
- `config.ts`: `TRACE_PERSIST` (bool, default **true**) — persistir traces si hay DB.
- `index.ts`: si `DATABASE_URL` + `TRACE_PERSIST` → `pgSink = createPgTraceSink(db, logger)`;
  `sink = createCompositeTraceSink([loggerSink, pgSink])`. Si no → solo `loggerSink` (como hoy).
  El `db` ya se crea para conversaciones/RAG; reusar la misma instancia.

## Edge-cases
- **Sin DB / TRACE_PERSIST=false** → solo stdout (comportamiento actual). 
- **Insert falla** (DB caída, columna, etc.) → log debug, turno sigue. NUNCA throw (fire-and-forget).
- **Turno stateless** (sin conversationId) → fila con `conversation_id NULL`; el panel filtra por turn_id.
- **`media.*`** hoy son `logger.info` directos en los adapters, NO pasan por el TraceSink → **no** se
  persisten en este corte. Follow-up: convertirlos en `TraceEvent` (`media.understand/transcribe/speak`) para
  que entren al stream. Anotado, no en este corte (mantener el alcance acotado).
- **Volumen / retención**: sin política ahora (tráfico bajo). Follow-up: TTL/cron si crece.
- **Memoria del sink** (`seqByTurn`): se libera tras turn.finish/error; cap implícito por el microtask.

## Seams futuros (NO implementar acá)
Panel de conversaciones (lee `trace_events` + `messages` por turn_id); enriquecer `messages` con columnas hot
(model/finish_reason/status/error) estilo Convex; `media.*` como TraceEvent; retención/TTL; redacción opcional
en DB; batch inserts si sube el volumen.
