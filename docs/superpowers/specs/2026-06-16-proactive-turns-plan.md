# Plan (ALTO NIVEL) — Turnos proactivos (Nivel C), v1: seam genérico in-process

> **Diseño técnico (firmas, flujo, edge-cases):** [`2026-06-16-proactive-turns-design.md`](2026-06-16-proactive-turns-design.md).
> Este doc = **qué hacer** (fases, secuencia, dependencias, verificación macro) + **Estrategia de ejecución**.

## Objetivo
Construir la **infra de turnos proactivos** ("Nivel C"): un puerto `ProactiveResume` + la re-entrada al loop, de
modo que (en incrementos siguientes) una tarea en background pueda, al terminar, hacer que Vaio **retome solo** y
responda la duda original por Telegram. v1 = **seam genérico, in-process, re-responder** (sin cablear triggers).

## Fases (secuenciales — cadena acoplada puerto→core→adapter→wiring)
1. **Puerto + threading core.** `ports/proactive.ts`; `TurnContext.resume?` + pasarlo al `ActionContext` en
   `buildTools`; `ActionContext.resume?`. **Entregable:** typecheck verde (pasamanos, nadie lo usa aún).
2. **Adapter `createTelegramResume` (TDD).** `adapters/telegram/proactive.ts`: re-entrada anti-loop + sendMessage.
   Tests (fakes de agent/client) ANTES de la impl.
3. **Wiring del canal.** `routes.ts handleTurn` construye e inyecta el resume; web no lo pasa.
4. **Verificación.** typecheck + biome + test + no-regresión (boot + `/chat`).

## Dependencias
- Reusa: `agent.respond` (re-entrada con req sintético, `core/agent.ts:185`), `TelegramClient.sendMessage`,
  el `req`/`norm` de `handleTurn`, `randomUUID`. NO toca `conversations`/`memory` (la persistencia del proactivo la
  hace `respond` sola).
- Fase 1 habilita 2 (la firma del puerto). 3 depende de 2. Sin DB ni migración.

## Verificación macro
1. `pnpm -r typecheck` + `pnpm exec biome check .` + `pnpm -r test` limpios.
2. **TDD** del adapter: task resuelta → re-entrada (req sintético + `resume:null` anti-loop) + sendMessage; task
   rechazada → log, sin envío; prefijo por locale.
3. **No-regresión:** boot (`/health` 200) + un `/chat` normal responde igual (el threading no rompe el turno).
4. Queda `- [?]`: **e2e en vivo NO en v1** (ningún trigger invoca el resume) → llega al cablear `learnRepo` (followup).

## Estrategia de ejecución
**Directo/orquestador (sin subagentes para implementar).** Seam CHICO y acoplado en cadena (puerto→core
threading→adapter→wiring); el hook `PostToolUse(typecheck)` serializa los edits → subagentes en paralelo se
pisarían. **La exploración del seam SÍ se hizo con 1 Explore agent** (decisión visible — mapear re-entrada/
persistencia/gaps en un área amplia). Red de seguridad = TDD + no-regresión. Si al cablear triggers el alcance
crece (persistencia, múltiples triggers), se reevalúa subagentes ahí.

## Docs al cerrar
- `NEXT-STEPS.md`: WIP `- [?]` (seam listo; 1er trigger learnRepo = followup para demo en vivo). `SPEC.md` §Fase 2
  puede referenciar el seam.
- Memoria `proactive-turns-vision`: actualizar (seam v1 hecho; triggers + persistencia = followups).
- Followups explícitos: (a) cablear `learnRepo` (1 línea, demo), (b) persistencia (tabla + worker), (c) framing del
  turno sintético, (d) cortesía en onErr, (e) más triggers (sync largo, escalate).
