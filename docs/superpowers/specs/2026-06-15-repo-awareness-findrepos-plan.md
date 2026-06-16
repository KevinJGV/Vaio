# Plan — Repo-awareness (a+b) + findRepos (c) + filosofía de tools

> **Spec técnico:** [`2026-06-15-repo-awareness-findrepos-design.md`](2026-06-15-repo-awareness-findrepos-design.md).
> Este doc = fases + estrategia de ejecución. Continúa el roadmap de detectores (knowledge-detectors).

## Objetivo
Cerrar a/b/c del roadmap de detectores: (a) match multi-palabra del UnindexedRepoDetector, (b) señal "es solo una
descripción" (mismo detector enriquecido), (c) tool `findRepos` para queries de metadata (lenguaje/topic). Y
**establecer la filosofía de tools** (pocas tools-intención extensibles, anti-bloat) como principio durable.

## Fases / entregables
1. **Infra detectores:** `DetectContext.retrieved` (chunks, no solo sources) + `DetectionHint.repo` + dedup en el
   registry. Refactor `FreshnessDetector` + `searchMemory` + tests. **Dependencia:** ninguna (toca la base existente).
2. **Catálogo enriquecido:** `OwnerRepo` + adapter `owner-repos` += language/topics/description/stars. **Dep:** ninguna.
3. **Detector a+b:** helper puro `reposNamedInQuery` (multi-palabra) + `UnindexedRepoDetector` con señal-nombre +
   señal-contenido (parsea chunks github), dedup por repo. **Dep:** 1 + 2.
4. **Tool findRepos (c):** filtro por language/topic contra el catálogo enriquecido, fallo visible (#8), todos los
   canales; registry + capabilities + prompt. **Dep:** 2.
5. **Principio + reconciliación:** filosofía de tools → `CLAUDE.md` (regla de medición de tools nuevas) + memoria
   `few-extensible-intent-tools`. `NEXT-STEPS`: pendiente "queries GitHub" → metadata cerrada (findRepos), estado
   diferido (home = params de findRepos). **Dep:** 1-4.

## Verificación (macro)
typecheck/biome/test limpios. e2e: (a) des-indexar Tastrack_Challenge → "hablame de Tastrack" → nota del detector;
(c) "qué proyectos tenés en Java" → findRepos(language:Java) lista repos Java reales; topic inexistente → fallo
visible; findRepos disponible en web. Restaurar lo des-indexado.

## Estrategia de ejecución
**Directo/orquestador, secuencial (fases 1→5).** Las fases comparten el cambio de `DetectContext` y el catálogo
enriquecido, y tocan archivos acoplados (detectores, searchMemory, registry, capabilities, repo-resolve); el hook
global de typecheck serializa cada edit → subagentes en paralelo se pisarían y un puerto a medio cambiar bloquea
todo. Trabajo mediano-acoplado con muchas piezas chicas interdependientes → coordinar subagentes no compensa. TDD por
fase. (Si en el futuro un incremento de detectores es independiente y grande, ahí sí subagentes.)

## No-objetivos
- Queries de ESTADO vivo (CI/Actions/PRs/deploys) — diferidas; su home es findRepos (params futuros) + el estado de
  deploy vive en Railway (su propio diseño). No en esta tanda.
- LiveMetadataDetector como detector aparte — innecesario: findRepos (tool bien descrita) cubre las queries de metadata.
