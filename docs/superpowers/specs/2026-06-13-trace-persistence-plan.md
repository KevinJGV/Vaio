# Plan de alto nivel — Persistencia de traces (DB traceability)

> QUÉ hacer + estrategia de ejecución. CÓMO técnico → [`…-design.md`](2026-06-13-trace-persistence-design.md).

## Contexto

Tras multimodal (mergeado), Kevin pidió **trazabilidad real en la DB**. La traza por turno ya existe como
`TraceEvent` pero solo a stdout (efímero); `trace.ts` ya preveía un sink de Postgres. Esto **habilita** el
panel de conversaciones futuro y hace **verificable** el trabajo de grounding. Norte (no clon): el schema
`messages` del componente `agent` de Convex.

## Entregables
1. Tabla `trace_events` (append-only, jsonb payload) + migración `0003`.
2. `PgTraceSink` (best-effort async, `seq` por turno, nunca rompe el turno).
3. `CompositeTraceSink` (stdout + pg) + flag `TRACE_PERSIST` + wiring (reusa el `db` existente).
4. Tests + verificación e2e (un turno real escribe filas; con DB caída el turno sigue).

## Fases (secuencial; pasos chicos verificables)
1. **Schema + migración** (`trace_events`) → `db:push` dev / `generate`. _Verif:_ typecheck.
2. **PgTraceSink** (`adapters/trace-pg.ts`) + test (mock db: inserta por evento, asigna seq, swallow error).
3. **CompositeTraceSink** + test (fan-out a N sinks).
4. **Config `TRACE_PERSIST` + wiring** en `index.ts`. _Verif:_ config test + boot.
5. **Verificación e2e:** `/chat` real → filas en `trace_events` (turn.start…turn.finish, ordenadas por seq);
   matar la DB / forzar error de insert → el turno responde igual (best-effort).

## Verificación (DoD)
`pnpm -r typecheck` + `biome` + `pnpm -r test` limpios; boot `/health`; un turno real persiste sus eventos;
fallo de insert no rompe el turno; sin secrets en logs.

## Estrategia de ejecución
**Orquestador directo, secuencial-acoplado** (schema→sink→composite→wiring comparten tipos y convergen en
`index.ts`; piezas chicas). TDD en `PgTraceSink`/`CompositeTraceSink` (mock db). Sin subagentes, sin worktree.
Rama `feat/observability-traceability` (junto con App Attribution).

## Fuera de alcance
Panel de conversaciones (UI); enriquecer `messages` (columnas hot); `media.*` como TraceEvent; retención/TTL;
batch inserts; redacción en DB. Todos como follow-ups en el design.
