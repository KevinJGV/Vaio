# Plan de alto nivel — Ingesta de fuentes CRUDAS de repos ("Vaio se nutre solo", pasos 1+2)

> **Altitud:** qué hacer (fases, entregables, secuencia, dependencias, verificación macro) + **Estrategia de
> ejecución**. El detalle técnico (firmas, filtros, patrones de secret, manejo de la API, edge-cases) vive en
> [`2026-06-14-raw-repo-ingestion-design.md`](2026-06-14-raw-repo-ingestion-design.md) — **no se repite acá**.

## Objetivo y entregable

`pnpm ingest` puebla `documents` con el contenido **crudo** (md + código) de repos curados —incl. el propio
`KevinJGV/Vaio` (self-awareness)— leído por GitHub API, con procedencia clickeable y **sin un solo secret**.
Entra al RAG existente sin tocar el core del agente. **Sin migración** (reúsa `documents`).

## Dependencias / supuestos

- `GITHUB_TOKEN` ya en env (rate limit 5000/h). Repos públicos. No requiere nada de Kevin para arrancar
  (default `RAW_SOURCE_REPOS=KevinJGV/Vaio`); el slug del portafolio lo agrega Kevin cuando lo confirme.
- API verificada vía context7 (Trees recursive + Contents raw hasta 100MB). Sin deps nuevas.

## Fases y entregables

| # | Fase | Entregable | Verificación |
|---|---|---|---|
| 1 | Config | `RAW_SOURCE_REPOS`/`RAW_FILE_MAX_BYTES`/`RAW_REPO_MAX_CHUNKS` + `rawSourceRepos()` | `config.test.ts` verde |
| 2 | Secret-scan (PURO) | `core/secret-scan.ts` | tests exhaustivos (incl. `.env.example` real) |
| 3 | Repo-ingest (PURO) | `core/repo-ingest.ts` (filterTree/isProseFile/languageOf/isProbablyText) | `repo-ingest.test.ts` verde |
| 4 | Code-chunking (PURO) | `core/code-chunking.ts` (chunkCode + withProvenanceHeader) | `code-chunking.test.ts` verde |
| 5 | GitHub API (I/O) | extraer `adapters/sources/github-api.ts` (`githubApi`+`githubRaw`); refactor `github.ts` | test `collectGithub` sigue verde |
| 6 | Collector (I/O) | `adapters/sources/repo.ts` `collectRawRepo` | `sources.test.ts` (mockFetch: multi-repo/404/secret) |
| 7 | Wiring | `ingest.ts` (collector condicional) + `.env.example` | typecheck + build |
| 8 | e2e | ingesta real contra `KevinJGV/Vaio` | `pnpm ingest` (0 secrets) + `/chat` cita repo |
| 9 | Cierre | Biome + reconciliar `NEXT-STEPS.md`/memoria | `biome check` limpio; docs al día |

## Secuencia y dependencias

- Fases **1-5 son independientes entre sí** (config, y 3 módulos puros + 1 helper de I/O sin estado compartido).
- Fase **6 depende de 1-5** (el collector integra todo). Fase **7 depende de 6**. Fase **8 depende de 7** y de
  keys reales (DB de dev / branch de Neon). Fase **9** cierra.

## Estrategia de ejecución

**Subagentes en paralelo para las fases 2-5** (recomendado). Son piezas **puras/aisladas con contrato claro y
tests propios**, sin estado compartido — el caso de libro para paralelizar (cada subagente hace TDD de su módulo
contra las firmas del `-design.md`). La fase 1 (config) la hago **directa** primero porque las demás referencian
sus tipos/firmas, es chica, y evita una condición de carrera trivial sobre `config.ts`.

**Directo/orquestador para las fases 6-9.** El collector `repo.ts` **integra** las 5 piezas (acoplado), el wiring
toca `ingest.ts`, y la verificación e2e + reconciliación de docs son **secuenciales y dependientes** — no hay
paralelismo que ganar y sí riesgo de pisarse. Las hago yo, en orden, verificando con evidencia cada una.

> Justificación (tamaño + complejidad): el trabajo grande/independiente está en los 4 módulos puros → ahí rinden
> los subagentes; lo acoplado (integración + e2e) es secuencial → directo es más barato y seguro. Decisión visible
> por mandato de `CLAUDE.md`.

## Verificación macro (Definition of Done)

- `pnpm -r typecheck` + `pnpm exec biome check .` + `pnpm -r test` limpios (nuevos tests verdes).
- **e2e:** `RAW_SOURCE_REPOS=KevinJGV/Vaio pnpm ingest` → logs (kept/skipped por reason, **0 secrets**),
  `source="repo:KevinJGV/Vaio"` poblado; `pnpm dev` + `/chat` "¿cómo Vaio cablea los adapters?" → cita un chunk
  con header de procedencia + url blob. (Requiere keys → lo corro con DB de dev / branch de Neon.)
- `.env.example` actualizado; **sin secrets en el diff**; sin migración.
- Docs reconciliados (NEXT-STEPS: mover el `[~]` a hecho; memoria si aplica).

## Riesgos (resumen — detalle en design)

Secrets en memoria pública (doble guard + skip-no-redact, tests duros) · costo de embeddings (caps + log de
descartes; dedup por hash = followup) · árbol truncado / repos privados / binarios (best-effort + WARN).

## Followups (fuera de alcance)

- **Paso 3:** acceso on-demand como read-action del harness (su propio par design+plan).
- **Dedup por hash de chunk** para no re-embeber lo no cambiado entre ingestas.
- **Adjudicación de conflictos/staleness de `facts`** (planteado por Kevin 2026-06-14) → es de `facts`, no de
  `documents`; ver `NEXT-STEPS.md` §"🟠 Pendiente PRIORIZADO".
