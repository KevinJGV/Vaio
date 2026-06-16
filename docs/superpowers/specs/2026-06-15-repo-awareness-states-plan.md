# Plan (ALTO NIVEL) — `repo-awareness` detector: estados unindexed | stale | incompleto

> **Diseño técnico (firmas, máquina de estados, edge-cases):** [`2026-06-15-repo-awareness-states-design.md`](2026-06-15-repo-awareness-states-design.md).
> Este doc = **qué hacer** (fases, secuencia, dependencias, verificación macro) + **Estrategia de ejecución**.

## Objetivo
Sumar dos estados a la "conciencia de repos" (incremento 3 de la capa de detectores): **stale** e
**incompleto/cap-bajo** del repo NOMBRADO, además del **unindexed** ya existente. El sistema clasifica y
dispara la acción en background (Inv #9); el modelo solo lee la nota. Sin migración (cobertura precisa).

## Fases (secuenciales — cadena acoplada puerto→core→adapter→detector→wiring)

1. **`coverageGap` PURO (TDD).** `core/repo-sync.ts` + `core/repo-sync.test.ts`. Tests (completo / cap-bajo /
   tombstones) ANTES de la impl. Reusa `filterTree`. **Entregable:** helper exportado + verde.
2. **Puerto `ensureRepoReady`.** `ports/repo-sync.ts`: tipo `RepoReadiness` + método en `RepoSyncPort`.
   **Entregable:** typecheck rojo en el adapter (falta la impl) → guía la fase 3.
3. **Impl adapter `ensureRepoReady`.** `adapters/sources/repo-sync.ts` en `createRepoSync`: cobertura→freshness,
   TTL compartido, dispara `forceFull`/incremental bg, best-effort. + smoke test del wiring.
   **Entregable:** typecheck verde + smoke verde.
4. **Rename detector + estados (TDD).** `unindexed-repo.ts`→`repo-awareness.ts` (+ factory + `unindexed-repo.test.ts`
   →`repo-awareness.test.ts`). Tests por estado/dedup/guard/ambas señales con `RepoSyncPort` fake ANTES de
   tocar la lógica. Actualizar import en `registry.ts` (si aplica) e `index.ts` wiring.
   **Entregable:** detector clasifica por estado; suite verde.
5. **Verificación.** `pnpm -r typecheck` + `biome check` + `pnpm -r test` + e2e local (ver abajo).

## Dependencias
- Fase 1 no depende de nada. Fases 2→3→4 en cadena (la firma del puerto guía el adapter; el método guía el
  detector). El wiring (`index.ts`) es lo último.
- Toda la infra ya en `main`: registry/puerto de detectores, `OwnerRepoCatalog`, `guardedSync`/`inFlight`/
  `lastChecked`, `filterTree`, `compareFreshness`, `remoteHead`, patrón `[nota del sistema: …]`.

## Verificación macro
1. `pnpm -r typecheck` + `pnpm exec biome check .` + `pnpm -r test` limpios (los ~383 previos + nuevos).
2. **e2e local** (`pnpm dev`, `/health` 200): repo trackeado **des-completado** a propósito (índice cap-bajo)
   → `/chat` "hablame de <repo>" → nota "incompleto" en `trace_events` + `forceFull` en bg (logs). Ídem stale
   (repo nombrado, índice atrás, chunks no recuperados → nota stale + incremental bg).
3. `FreshnessDetector` sigue disparando en su caso (repo recuperado + stale) sin doble nota.
4. Queda `- [?]` (pend. verificación por Telegram de Kevin) hasta su prueba conversacional.

## Estrategia de ejecución
**Directo/orquestador (sin subagentes).** Justificación por tamaño+complejidad: incremento CHICO y
**acoplado** en cadena (puerto→core→adapter→detector→wiring), con todos los archivos ya leídos y el diseño
cerrado. El hook global `PostToolUse(typecheck)` bloquea cada edit hasta typecheck-limpio → subagentes en
paralelo se pisarían (un puerto a medio editar bloquea todo edit del repo). La red de seguridad es el **TDD +
e2e**, no la paralelización. Misma decisión consciente que los incrementos previos de esta capa
(learnRepo, detectores fundación, repo-awareness a+b+findRepos).

## Docs al cerrar
- `docs/NEXT-STEPS.md`: este incremento a WIP `- [?]` → Historial al verificar Kevin. Limpiar el candidato #1
  de "🔜 PRÓXIMA SESIÓN" (queda hecho).
- La visión `knowledge-detectors-vision` (memoria) ya cubre el norte → no requiere memoria nueva.
