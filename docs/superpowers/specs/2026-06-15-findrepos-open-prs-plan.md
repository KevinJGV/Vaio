# Plan (ALTO NIVEL) — `hasOpenPRs`: PRs sin mergear como param de `findRepos`

> **Diseño técnico (firmas, query, edge-cases):** [`2026-06-15-findrepos-open-prs-design.md`](2026-06-15-findrepos-open-prs-design.md).
> Este doc = **qué hacer** (fases, secuencia, dependencias, verificación macro) + **Estrategia de ejecución**.

## Objetivo
Sumar el estado vivo "PRs sin mergear" como **param de `findRepos`** (Invariante #10, no tools nuevas): el
usuario pregunta "¿qué repos tengo con PRs abiertos?" → `findRepos({hasOpenPRs:true})` lista los repos con PRs,
enriquecido con número+título (cap 5/repo). Cross-repo en 1 llamada (Search API), público-only, degrada honesto.

## Fases (secuenciales — cadena acoplada puerto→core→adapter→action→wiring)
1. **Puro `repo-activity.ts` (TDD).** `parseRepoFromUrl` + `groupPRsByRepo` + tests. **Entregable:** verde.
2. **Puerto.** `OpenPR` + `OwnerRepoActivity` en `ports/owner-repos.ts`.
3. **Adapter (TDD).** `createOwnerRepoActivity` (Search API, TTL, error→null) + tests con mock `fetch`.
4. **Acción + wiring (TDD).** param `hasOpenPRs` + enriquecido + intersección en `find-repos.ts`;
   `ActionContext.repoActivity?`; `index.ts`. Tests de los 3 caminos + combinado con language.
5. **Verificación.** typecheck + biome + test + e2e local.

## Dependencias
- Fase 1 independiente. 2→3→4 en cadena (firma del puerto guía el adapter y la acción). Wiring último.
- Reusa lo ya en `main`: `githubApi` (`sources/github-api.ts`), `filterRepos` (`core/repo-filter.ts`), patrón de
  TTL-cache de `createOwnerRepoCatalog`, el `done(ok, output)` + emit de `find-repos.ts`, `ActionContext`.

## Verificación macro
1. `pnpm -r typecheck` + `pnpm exec biome check .` + `pnpm -r test` limpios.
2. **e2e local** (`pnpm dev`, `/health` 200): `/chat` "¿qué repos tengo con PRs sin mergear?" →
   `findRepos({hasOpenPRs:true})` → output enriquecido con PRs reales (o "no tenés PRs sin mergear"); 1 llamada a
   Search API en `trace_events`. Degradado: token inválido → "no pude consultar".
3. Queda `- [?]` (pend. verificación por Telegram de Kevin).

## Estrategia de ejecución
**Directo/orquestador (sin subagentes).** Incremento CHICO y **acoplado** en cadena (puerto→core→adapter→action→
wiring), todos los archivos ya leídos y el diseño cerrado. El hook global `PostToolUse(typecheck)` bloquea cada
edit hasta typecheck-limpio → subagentes en paralelo se pisarían. Red de seguridad = **TDD + e2e**, no la
paralelización. Misma decisión consciente que los incrementos previos del área (findRepos a+b+c, repo-awareness states).

## Docs al cerrar
- `NEXT-STEPS.md`: este incremento a WIP `- [?]` → Historial al verificar Kevin; en "candidatos" marcar #2 (PRs)
  hecho, **CI sigue pendiente** como sub-item.
- Sin memoria nueva (Invariante #10 ya en `few-extensible-intent-tools`).
