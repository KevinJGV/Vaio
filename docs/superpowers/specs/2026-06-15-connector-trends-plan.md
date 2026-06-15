# Acumulación + patrones de conectores ("trends") — Plan de alto nivel

> **For agentic workers:** TDD, commits frecuentes. Diseño técnico (DDL, firmas, prompt, edge-cases, tests) →
> [`2026-06-15-connector-trends-design.md`](2026-06-15-connector-trends-design.md) (NO se repite acá).

**Goal:** que Vaio note **patrones en el tiempo** de la actividad de Kevin (música/gaming/código), con
clasificación (géneros/categorías). Serie temporal de snapshots + chunk de tendencia derivado con LLM cada ingest
(degrada a delta determinístico), accesible vía `searchMemory`. Flag OFF por defecto. Precursor de los grafos (Fase 3).

## Fases (secuencia con dependencias)
1. **Schema + migración 0008** — tabla `connector_snapshots`. *Dependencia de todo.*
2. **Config** — `TRENDS_ENABLED`/`TREND_MODELS`/`TREND_RETENTION` + `trendChain` + `.env.example`. *Independiente.*
3. **`core/trends.ts`** (puro, TDD) — hash/normalize, `buildTrendPrompt` (ES/EN, grounding), `deterministicTrend`.
4. **Puerto `SnapshotStore` + adapter `neon-snapshots`** (TDD con fake db). *Depende de 1.*
5. **Puerto `TrendSummarizer` + adapter `trend-summarizer`** (espeja `summarizer.ts`). *Independiente.*
6. **`ingest.ts`** — snapshot append (dedup) + prune + listRecent + derivar (LLM/fallback) + upsert `trend:source`;
   wiring de los adapters. *Depende de 1-5.*
7. **Tests del flujo** (fakes) + **verificación + e2e**.

## Entregables
- Tabla `connector_snapshots` (serie temporal) + migración 0008 aplicada.
- `core/trends.ts` puro + 2 puertos + 2 adapters.
- `ingest.ts` que acumula snapshots y deriva el chunk `trend:<source>` (degrada).
- 3 envs + `trendChain`; flag OFF por defecto.
- Tests nuevos verdes; suite sin regresión; ingest legacy intacto con el flag OFF.

## Estrategia de ejecución (OBLIGATORIA)
**Directo/secuencial (yo-orquestador), NO subagentes.** Justificación: cadena de dependencias (schema → core →
puertos/adapters → wiring en `ingest.ts`), todo converge en `ingest.ts`/`schema.ts` → subagentes en paralelo se
pisarían (+ el hook de typecheck encadena). Las piezas independientes (config, trend-summarizer) son chicas → no
rinde el fan-out. **La fase de DISEÑO sí usó un Plan agent** (feature ambiciosa/fresca); la implementación es directa.

## Verificación
typecheck/biome/test/build limpios + migración 0008 + **e2e**: `TRENDS_ENABLED=1`, `pnpm ingest` ×2 con datos
distintos → serie en `connector_snapshots` + chunk `trend:*` grounded en `documents`; `/chat` "¿qué viene
haciendo/escuchando Kevin?" lo trae. Degradación LLM→determinístico; OFF→legacy. **Followup:** prioridad de
retrieval del trend (estilo `searchFacts`) si no aflora — medir primero.
