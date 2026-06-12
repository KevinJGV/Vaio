# Plan (alto nivel) — Capa de compresión determinística (cavemem)

> **Hermano técnico:** [`2026-06-12-cavemem-compression-design.md`](2026-06-12-cavemem-compression-design.md)
> (firmas, integración, edge-cases). Este plan = qué hacer (fases/secuencia/estrategia), sin repetir lo técnico.
> **Ejecutar task-by-task:** `superpowers:executing-plans`.

**Goal:** comprimir determinísticamente (costo cero) el contexto que se manda al modelo (resumen + turnos
históricos + chunks de RAG) adoptando `@cavemem/compress`, para escalar el uso de tokens desde ahora.

**Arquitectura:** dos tiers (Tier 1 determinístico = `@cavemem/compress` vendorizado tras un puerto
`Compressor`; Tier 2 = resumen LLM existente para acotar). Detalle → design.

## Estrategia de ejecución
**Orquestador-directo (esta sesión).** Es trabajo **chico, secuencial y acoplado**: vendorizar → puerto+
adapter → 2 puntos de integración (core + searchMemory) → léxico ES → tests → docs. No hay ramas de
trabajo independiente que paralelizar; el valor está en integrar bien, no en cubrir amplitud → subagentes
no aportan. (Si en el futuro se aplica a facts+ingesta+MCP a la vez, reevaluar.)

## Fases (cada una = verificable + commit)
1. **Vendorizar `@cavemem/compress` → `packages/compress`** (`@vaio/compress`, LICENSE MIT + NOTICE). Build
   propio (gotcha import-attributes de `lexicon.json`). **Verificar:** sus tests vendorizados + build verdes.
2. **Puerto `Compressor` + adapter** (`ports/compress.ts`, `adapters/compress.ts`) + helper `compressOrRaw`.
   Dep `@vaio/compress` en `apps/agent`. **Verificar:** typecheck.
3. **Léxico ES** (entradas en `lexicon.json`) + tests fixtures ES (preserva técnicos byte-a-byte, quita
   artículos/fillers ES, acentos/ñ intactos). **Verificar:** tests del package.
4. **Integrar Tier 1 en conversación** (`core/agent.ts`): comprimir resumen + turnos históricos; NO la query
   viva ni la persona; log de ahorro. Fake `Compressor` espía en `agent-loop.test`. **Verificar:** tests.
5. **Integrar Tier 1 en RAG** (`core/tools.ts`): comprimir chunks de `searchMemory`. Test en `tools.test`. **Verificar.**
6. **Config + wiring** (`config.ts`, `index.ts`, `.env.example`): `COMPRESS_ENABLED`/`COMPRESS_INTENSITY`
   (+RAG), inyección, boot log. **Verificar:** typecheck + tests.
7. **Rename del mislabel**: `core/summary.ts` → "resumen rodante (LLM)"; reservar "compresión cavemem" para Tier 1.
8. **Verificación e2e + docs**: suite completa + `/chat` real (ahorro en logs, persona intacta, cita CV);
   degradación `COMPRESS_ENABLED=false`. Reconciliar SPEC/NEXT-STEPS/LEARNINGS + este par.

## Verificación global
`pnpm --filter @vaio/compress build` + sus tests · `pnpm -r typecheck` · `pnpm exec biome check .` ·
`pnpm -r test` · `pnpm build` limpios · `/chat` real con ahorro visible y calidad intacta · determinismo
(`compress(x)` estable) · `COMPRESS_ENABLED=false` → texto crudo, todo anda.

## Dependencias / secuencia
1 → 2 → 3 secuencial (el adapter necesita el package; el léxico vive en el package). 4 y 5 dependen de 2.
6 depende de 4-5. 7-8 cierran. Todo en la rama `feat/conversational-core-telegram` (extiende iteración 2).
