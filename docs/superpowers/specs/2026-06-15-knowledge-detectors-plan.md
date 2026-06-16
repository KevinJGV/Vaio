# Plan (ROADMAP) — Capa de detectores de conocimiento disponible

> **Visión + contratos:** [`2026-06-15-knowledge-detectors-design.md`](2026-06-15-knowledge-detectors-design.md).
> Este doc = **roadmap de incrementos de ALTO NIVEL + estrategia de ejecución**. NO repite los contratos del design.
> ⚠️ Es una **visión**: no se implementa toda junta. Cada incremento se prioriza con Kevin y tiene su propio
> design+plan detallado cuando se arranque. Este plan es el ORDEN sugerido.

## Objetivo
Que Vaio complemente la memoria de la DB con **señales de disponibilidad** detectadas por el sistema (repos sin
indexar, staleness, metadata fina, fuentes vivas) → sensación "omnisciente", con separación de responsabilidades
(searchMemory = contenido; detectores = señal). Generaliza el patrón `behindNote`.

## Incrementos (orden sugerido) y dependencias
1. **Fundación: puerto `KnowledgeDetector` + `DetectorRegistry` + extracción del `FreshnessDetector`.** Crear el
   puerto/registry; **migrar** el freshness gate (`ensureFresh`/`behindNote`) de `searchMemory` a un
   `FreshnessDetector` (refactor sin cambio de comportamiento → searchMemory queda más limpio). `ActionContext +=
   detectors`. **Entregable:** la infra + el primer detector (el que ya existe, ahora extraído). Es el cimiento; sin
   esto los demás no enchufan. **Dependencia:** ninguna (refactor + infra).
2. **`UnindexedRepoDetector` (caso ACME) — 1er incremento de VALOR.** La query matchea un repo del owner no indexado
   → nota "tenés X sin indexar → learnRepo". Resuelve el gap real que destapó Kevin. **Dependencia:** incremento 1 +
   `OwnerRepoCatalog`/`resolveRepoName`/`isTracked` (ya existen). Decisión a cerrar: heurística query→repo conservadora.
3. **`ThinContentDetector`** (futuro): lo recuperado es solo la descripción del conector `github`, no `repo:*` →
   sugiere learnRepo para el código. **Dependencia:** 1.
4. **`LiveMetadataDetector`** (futuro, atado al pendiente "queries vivas a GitHub"): señala que una pregunta de
   CI/PRs/topics/lenguajes es consultable en vivo → sugiere la tool de pull correspondiente. **Dependencia:** 1 + el
   diseño de "queries vivas a GitHub" (su propio brainstorming).

## Verificación (macro, por incremento)
- Tests: detectores PUROS/orquestadores con puertos fakeados (patrón `learn-repo.test.ts`/`search-memory.test.ts`);
  el registry (cap de notas, best-effort no rompe). Refactor del gate: la suite existente de searchMemory/repo-sync
  debe seguir verde (comportamiento idéntico).
- e2e: índice con un repo no indexado + query que lo matchee → la nota aparece en el output de searchMemory → el
  modelo dispara learnRepo solo (sin pedírselo). El caso ACME, pero proactivo.

## Estrategia de ejecución
- **Incremento 1 (fundación + extracción del gate):** **directo/orquestador**. Es un refactor acoplado que toca
  `searchMemory`/`types.ts`/`agent.ts`/`index.ts` + el nuevo puerto; el hook global de typecheck serializa edits y
  un puerto a medio cablear bloquea todo → subagentes en paralelo se pisarían. TDD para mantener comportamiento.
- **Incremento 2 (UnindexedRepoDetector):** **directo**. Unidad chica (un detector puro + su orquestación) que
  depende del 1; TDD con fakes. No amerita subagentes.
- **Incrementos 3-4 (futuros):** cada uno su propio design+plan; chicos/independientes entre sí una vez está la
  fundación → podrían ir en paralelo si se hacen varios, pero default directo por tamaño.
- **Default:** todo directo/secuencial. La capa es chica por incremento; el valor está en el patrón, no en el volumen.

## No-objetivos (de esta visión)
- El **ruido de retrieval** (basura del portafolio en queries de tema) — es calidad de rerank, su propio followup.
- Los **detectores pre-turno** (en el agent-loop) — diferidos hasta que un caso lo pida.
- Implementar las 4 fuentes ya — es visión; se priorizan de a una.
