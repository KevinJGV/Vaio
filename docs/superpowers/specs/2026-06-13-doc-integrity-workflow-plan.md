# Plan (alto nivel) — Workflow de integridad documental (anti-drift) · 2026-06-13

Qué-hacer + secuencia + estrategia. El **cómo** técnico → [`…-design.md`](2026-06-13-doc-integrity-workflow-design.md);
las **reglas** durables → `CLAUDE.md` ("Integridad documental"). No se duplica.

## Objetivo
Que los docs nunca queden en estados incorrectos que introduzcan errores en el desarrollo, y que **nada
quede suelto** al cambiar de foco. Hacerlo **estructural** (mínima superficie que pueda pudrirse + una sola
fuente de verdad) con una **red automática** para el subconjunto verificable y **recordatorios** deterministas.

## Estrategia de ejecución
**Orquestador-directo (una sesión).** Cambios chicos y acoplados (CLAUDE.md, NEXT-STEPS, settings.json, 2
hooks, 1 script, CI, LEARNINGS, este par). Secuencial; sin estado paralelo → subagentes no aportan. El
riesgo está en que hooks/script funcionen (se prueban a mano).

## Fases / entregables
1. **Estructural (reglas):** codificar en `CLAUDE.md` single-source-of-truth (estado solo en NEXT-STEPS),
   estados WIP, **gate de reconciliación al cambiar de foco**, y ampliar el DoD. ✅
2. **Lista WIP viva:** sección "🚧 En proceso / verificación" en `NEXT-STEPS.md`, sembrada con el WIP real. ✅
3. **Red automática:** `scripts/check-docs.sh` + paso en `ci.yml`. ✅
4. **Hooks:** `SessionStart` (ritual) + `UserPromptSubmit` (avisa WIP abierto) + registro en `settings.json`. ✅
5. **Docs:** gotcha en `LEARNINGS.md` + este par; reconciliar `NEXT-STEPS`. ✅

## Dependencias / decisiones
- La fuente durable del WIP es el **doc** (sobrevive sesiones); las Task tools del harness son el espejo
  en-sesión. Denylist del checker deliberadamente **mínima** (evitar falsos positivos).

## Verificación (macro)
Ver design. Resumen: check-docs verde + caza fallos inyectados; hooks emiten/silencian bien; JSON/yaml
parsean; suite sin cambios. Commits atómicos.

## Estado
**Implementado y verificado** (esta sesión). Refuerza el flujo; la integridad semántica sigue siendo del criterio.
