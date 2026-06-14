# Plan de alto nivel — Rerank (2ª etapa del RAG)

> **Altitud:** fases, secuencia, estrategia. Detalle técnico (puerto/adapter/firmas/API/edge-cases) →
> [`2026-06-14-rerank-design.md`](2026-06-14-rerank-design.md).

## Objetivo y entregable
`searchMemory` recupera wide-K por vector → rerankea (OpenRouter `/rerank`) → recorta al top-N del canal, mejorando
el grounding. Degrada a vector top-K sin reranker o si falla. Nuevo puerto + adapter + config + wiring; sin migración.

## Dependencias
- Corpus grande (ingesta de fuentes crudas, ya hecho) = la razón del valor. `OPENROUTER_API_KEY` (ya está).
- Reusa: `attributionHeaders` (`adapters/openrouter.ts`), patrón `speech-openrouter.ts` (cadena client-side),
  `positiveIntWithDefault` (`config.ts`), el quirk-handling de `embeddings.ts`.

## Fases
| # | Fase | Entregable | Verificación |
|---|---|---|---|
| 1 | Puerto + adapter + config | `ports/rerank.ts`, `adapters/rerank-openrouter.ts`, `rerankChain`/`RERANK_CANDIDATES` | `rerank-openrouter`+`config` tests verdes |
| 2 | Orquestación + wiring | `types.ts` (ActionContext), `search-memory.ts`, `index.ts`/`agent.ts`, `.env.example` | `search-memory` test + typecheck/build |
| 3 | e2e | server + `/chat`: rerank dispara (traza `media.rerank`) + cita repo; degradación sin RERANK_MODELS | traza + respuesta |
| 4 | Cierre | typecheck/biome/build + reconciliar NEXT-STEPS/memoria + commit | todo verde |

## Secuencia y dependencias
Fase 1 (puerto/adapter/config) es independiente → se puede paralelizar. Fase 2 depende de 1 (la action usa el
puerto + el config). Fase 3 depende de 2 + keys. Fase 4 cierra.

## Estrategia de ejecución
**Híbrido.** Fase 1 → **1 subagente** (TDD): el puerto, el adapter `rerank-openrouter` (espeja `speech-openrouter`,
mockFetch-testable) y el parser `rerankChain` son **independientes y aislados**. Fase 2 (orquestación en la action +
`ActionContext` + wiring en `index.ts`/`agent.ts`) es **acoplada y secuencial** → **directo**, lo hago yo integrando.
Fases 3-4 directas. Justificación (CLAUDE.md): lo independiente/testable-en-aislamiento → subagente; lo que integra
piezas y toca el wiring → directo.

## Verificación macro (DoD)
- typecheck + biome + test limpios (nuevos verdes).
- e2e: rerank dispara (traza `media.rerank`) y cita el repo; sin `RERANK_MODELS` → responde igual (vector).
- Sin secrets en el diff; sin migración; `.env.example` actualizado.
- Docs reconciliados (NEXT-STEPS §Evolución multimodal: rerank → hecho/verificado).
- Dos specs durables + commit atómico (rama `feat/raw-repo-ingestion`).

## Riesgos
Costo/latencia por llamada (acotado: pool 30, no dispara en saludos, top-N final intacto) · degradación robusta
(Invariante #1) · slug/precio del modelo de rerank cambia → verificar en la galería al activar.

## Followups (fuera de alcance)
Rerank en otros canales ya cubierto (vive en la action, aplica a todos). Tuning del pool/modelo por medición real.
