# Plan — `learnRepo`: ingesta on-demand de un repo público (paso 3 parte 2)

> **Spec técnico (firmas/DDL/edge-cases):** [`2026-06-15-learn-repo-design.md`](2026-06-15-learn-repo-design.md).
> Este doc = **alto nivel** (fases, entregables, secuencia, dependencias) + **Estrategia de ejecución**. No repite reqs técnicos.

## Objetivo
Habilitar que Kevin pregunte por un repo SUYO que Vaio no tiene indexado y Vaio lo **ingiera en background** para
responder. Reusa toda la maquinaria de ingesta/sync; agrega 1 acción (`learnRepo`) + resolución de nombre contra
los repos públicos reales de Kevin (Invariante #8 vía fallo visible). Owner-only, públicos-only, v1 sin notify.

## Fases y entregables
- **Fase 1 — Matcher puro** (`core/repo-resolve.ts` + test). Sin I/O. `resolveRepoName` → match/ambiguous/none.
- **Fase 2 — Catálogo** (`ports/owner-repos.ts` + `adapters/sources/owner-repos.ts` + test). Listado público
  cacheado (githubApi + filtro `private` + paginación con cap). Helper puro `publicReposOnly`.
- **Fase 3 — Acción `learnRepo`** (`core/actions/learn-repo.ts` + test). Owner-only, sideEffecting; resuelve →
  background `repoSync.sync` en match+no-tracked; sin ingerir en ambiguous/none/ya-tracked.
- **Fase 4 — Wiring**: `types.ts` (ActionContext), `registry.ts`, `capabilities.ts` (ToolName + owner profile),
  `core/agent.ts`, `index.ts` (instanciar el catálogo + `ownerUser`).
- **Fase 5 — Prompt/policy**: guía ES+EN en el `TELEGRAM_POLICY` (owner) — usar `learnRepo` cuando Kevin
  referencia un repo suyo no indexado (searchMemory vacío).

## Secuencia / dependencias
Fase 3 depende de 1 y 2 (importa el matcher, usa el puerto). 4 depende de 3. 5 independiente del código (texto),
se hace junto a 4. Sin migración de DB.

## Verificación (macro)
1. `pnpm -r typecheck` + `pnpm exec biome check .` + `pnpm -r test` limpios.
2. e2e: `/chat` owner "hablame de mi repo `<público-no-indexado>`" → `learnRepo` dispara → "lo estoy trayendo";
   verificar `trace_events` (tool.result learnRepo) + log `repo sync` background; tras completar, `tracked_repos`
   tiene el repo + `searchMemory` lo recupera → re-preguntar → Vaio cita el repo. Negativos: nombre inexistente →
   fallo visible; repo PRIVADO por nombre → `none` (no ingiere); visitante → tool ausente/denegada. 0 fuga de secrets.

## Estrategia de ejecución
- **Fases 1 y 2 = INDEPENDIENTES** (matcher puro vs adapter/puerto; no comparten estado, sin orden entre sí) →
  **2 subagentes en paralelo** (`dispatching-parallel-agents`), cada uno con TDD de su unidad. Trabajo acotado y
  bien-bordeado → rinde en paralelo.
- **Fases 3 → 4 → 5 = SECUENCIALES y ACOPLADAS** (la acción depende de 1+2; el wiring toca archivos compartidos
  `types.ts`/`agent.ts`/`index.ts`/`capabilities.ts`/`prompt.ts` → subagentes en paralelo se pisarían, y el hook
  global de typecheck bloquea todo edit ante un import roto) → **directo por el orquestador** (cambios chicos,
  coordinar subagentes no compensa).
- **Default elegido:** 1+2 en paralelo (subagentes) → 3,4,5 directo/secuencial. (Si el costo de orquestar 2
  subagentes para 2 archivos puros se ve excesivo, hacer las 5 fases directas en orden 1→2→3→4→5 es válido —
  decisión a tomar al ejecutar según contexto; lo VISIBLE es la elección.)

## Promoción/reconciliación
`NEXT-STEPS.md` §"🔵 Pendiente FUTURO — Vaio se nutre solo" (paso 3 parte 2 en progreso) + WIP `[?]`. Memoria
`vaio-self-nourishing-memory-vision` (paso 3 parte 2 arrancado). `SPEC.md` §"Vaio se nutre solo" si cambia el norte.
