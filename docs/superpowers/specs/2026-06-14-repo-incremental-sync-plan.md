# Plan de alto nivel — Memoria viva de repos: sync incremental + frescura autónoma lazy (paso 3, parte 1)

> **Altitud:** fases, secuencia, estrategia. Detalle técnico (DDL, firmas, edge-cases) →
> [`2026-06-14-repo-incremental-sync-design.md`](2026-06-14-repo-incremental-sync-design.md).

## Objetivo y entregable
El índice de los repos curados se mantiene fresco **solo, barato, lazy y autónomo**: Vaio detecta (cheap) si un repo
relevante está desactualizado y, si lo está, lo **sincroniza incrementalmente** (re-embebe solo lo cambiado) — inline
si es rápido, con caveat + refresco en background si es largo. Mención natural solo al owner; silencio en web/visitante.

## Dependencias
Pasos 1+2 (collectRawRepo, github-api, filterTree, secret-scan, chunkers) — reusados. `OPENROUTER_API_KEY`/`DATABASE_URL`
(ya están). Grounding de auto-introspección (ya hecho) — para que el "pedí un momento" no bloquee preguntas técnicas.

## Fases
| # | Fase | Entregable | Verificación |
|---|---|---|---|
| 1 | Diff/freshness PUROS | `core/repo-sync.ts` (diffRepoTree, compareFreshness, isInlineSync) | `repo-sync` test verde |
| 2 | Schema + migración | `schema.ts` (path/blob_sha + tracked_repos) + migración drizzle | typecheck + migrate en branch Neon |
| 3a | RepoTracker | `ports/repo-tracker.ts` + `adapters/neon-tracker.ts` | test get/upsert |
| 3b | MemoryStore + | `listIndexedFiles`/`deleteFiles`/`replaceFile` + persistir path/blobSha + DocChunk | test (legacy intacto) |
| 4 | Orquestador | `adapters/sources/repo-sync.ts` (syncRepo, repoFreshness) | mockGithub: fresh/stale/truncado/404/legacy |
| 5 | Tools + wiring + prompt | check-repo-freshness, sync-repo, ActionContext, index/agent, prompt política | sync-actions test + typecheck |
| 6 | Entrypoint | `apps/agent/src/sync.ts` | e2e: 2ª corrida skipped-fresh |
| 7 | Cierre | biome/build + reconciliar docs + commit | todo verde |

## Secuencia y dependencias
1 y 2 son la **base secuencial** (todo depende del diff puro + el schema). 3a y 3b son **independientes** (archivos
distintos, sin estado compartido). 4 depende de 1+2+3. 5 depende de 4. 6 depende de 4. 7 cierra.

## Estrategia de ejecución
**Híbrido (decisión visible, CLAUDE.md):**
- **Directo (yo), secuencial:** fase 1 (diff puro — el corazón, TDD primero) y fase 2 (schema/migración — toca DDL).
- **Subagentes en paralelo:** fases **3a (RepoTracker)** y **3b (MemoryStore ext)** — piezas de I/O independientes,
  aisladas, mockeables, en archivos distintos → ideal para paralelizar.
- **Directo (yo), acoplado:** fases 4 (orquestador que integra todo), 5 (tools + wiring + política de prompt — toca
  el harness y el system prompt) y 6 (entrypoint + e2e). Es lo que integra y tiene riesgo de pisarse → directo.
Es el incremento más grande de la sesión; el engine ya fue **pressure-tested por un Plan agent**.

## Verificación macro (DoD)
- typecheck + biome + test limpios (nuevos verdes).
- **e2e engine:** migrate → `sync.js` 1ª corrida full+legacy; **2ª inmediata = skipped-fresh (0 embeddings)**; tocar 1
  archivo → re-embebe solo ese.
- **e2e chat:** sync autónomo inline + mención natural SOLO al owner, silencio en web; sin mensajes dedicados; sync
  largo → caveat + background; pregunta técnica → responde libre (no bloqueo).
- Migración aplicada (Neon), legacy reconciliado sin perder lo buscable. Sin secrets en el diff.
- Docs reconciliados (NEXT-STEPS + memoria de turnos proactivos) + SPEC.md (superficie sync).

## Riesgos
Migración (1ª en varias sesiones; aplicar antes del deploy) · corrección del diff (TDD) · sync inline lento si diff
grande (cap + caveat+background) · sobre-disparo del sync (prompt condicional + frescura barata como gate) · no romper
el RAG legacy en la reconciliación.

## Followups (registrados también en NEXT-STEPS + memoria)
**★ Incremento 2 — turnos proactivos** ("Vaio retoma solo", estilo Claude Code background tasks; Telegram-first;
seam transversal que también habilita escalate/Nivel C) · **parte 2 del paso 3** (on-demand ingest de repo nuevo,
owner+background+notify) · cron · webhook GitHub · `behind?` · grafos (Fase 3).
