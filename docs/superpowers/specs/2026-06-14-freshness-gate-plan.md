# Plan de alto nivel — Freshness gate

> **Altitud:** fases, secuencia, estrategia. Detalle técnico → [`2026-06-14-freshness-gate-design.md`](2026-06-14-freshness-gate-design.md).

## Objetivo y entregable
`searchMemory` deja de responder con chunks rancios sobre Kevin: tras recuperar, si vienen de un `repo:*` stale,
sincroniza (determinístico, TTL ~10 min) ANTES de responder. El repo del portafolio pasa a ser la única fuente de
verdad (drop del scrape cv/me/contact, con salvaguarda). Meta-conciencia explícita en el prompt.

## Dependencias
Sync incremental (paso 3 parte 1, ya hecho): reusa `RepoSyncPort` (`freshness`/`sync`), `createRepoSync`,
`ctx.repoSync`. Sin migración nueva.

## Fases
| # | Fase | Entregable | Verificación |
|---|---|---|---|
| 1 | `ensureFresh` + TTL | `ports/repo-sync.ts` + `createRepoSync` (cache TTL) + `config` (FRESHNESS_TTL_MINUTES) | unit (fakes): TTL/stale/deferred |
| 2 | Gate en searchMemory | refactor `retrieve()` + gate + re-retrieve | unit: refreshed→re-retrieve; degrada |
| 3 | Meta-conciencia | `prompt.ts` (ES+EN) | prompt.test |
| 4 | Drop scrape (condicional) | `ingest.ts` (quitar cv/portfolio + clear deprecated) | e2e: verificar contenido repo primero |
| 5 | e2e + cierre | sync full + verificación + /chat | gate dispara con stale; TTL cachea; cita repo no cv |

## Secuencia
1→2→3 son el gate (secuencial: el gate usa `ensureFresh`). 4 (drop scrape) es **condicional a la salvaguarda** de la
fase 5 (verificar que el repo cubre cv/me/contact con calidad). 5 cierra.

## Estrategia de ejecución
**Directo / orquestador (sin subagentes).** Cambio acoplado (puerto + adapter + action + prompt + ingest) y el hook
global de typecheck hace que el estado intermedio no-compilable bloquee edits → subagentes en paralelo se pisarían
(lo vimos en el paso 3 parte 1). Lo hago directo, TDD de las piezas testeables (`ensureFresh`, gate). Decisión
visible por mandato de `CLAUDE.md`: lo acoplado + el constraint del hook → directo.

## Verificación macro (DoD)
- Gate determinístico: pregunta sobre Kevin con repo stale → sincroniza antes de responder (no inercia). TTL
  respetado (sin request por consulta dentro de la ventana). Degrada limpio.
- Salvaguarda: si el contenido del repo cubre cv/me/contact → drop+clear del scrape; si no → mantener + followup.
- typecheck/biome/test/build limpios. Sin secrets en el diff. Sin migración.
- Docs reconciliados (cerrar 🟠 freshness gate; registrar followups nuevos). Commit atómico.

## Riesgos
Coste/latencia del gate (mitigado por TTL + solo sobre repo: sources) · dropear el scrape sin que el repo cubra bien
el contenido (mitigado por la salvaguarda de verificación) · loops de re-retrieve (mitigado: una sola vez).

## Followups (registrar en NEXT-STEPS — no diluir)
🆕 sentido del AHORA + actividad del día a día · 🆕 aprendizaje automático (extracción de facts) · 🆕 memoria
episódica · 🆕 guardrails de costo/loops · frescura no-repo (si la salvaguarda obliga a mantener el scrape).
Ya registrados: ⭐ turnos proactivos · 🟠 conflictos de facts · parte 2 (ingest on-demand).
