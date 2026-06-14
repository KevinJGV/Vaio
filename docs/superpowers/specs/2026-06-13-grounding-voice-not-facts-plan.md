# Plan de alto nivel — Grounding: voz ≠ hechos

> QUÉ hacer + estrategia. CÓMO técnico → [`…-design.md`](2026-06-13-grounding-voice-not-facts-design.md).
> Estado → `../../NEXT-STEPS.md`. Raíz → `NEXT-STEPS` §"Hallazgos del bot real".

## Objetivo
Cerrar el bug donde Vaio inventa hechos sobre Kevin (origen "caleño", fútbol): **voz = estilo puro; hechos =
solo `searchMemory`**, con grounding duro — sin neutralizar la persona (CLAUDE.md la protege). Ahora
**verificable** con los `trace_events` persistidos.

## Entregables
1. `prompt.ts`: voz sin biografía + grounding duro/stop-rule + fallback por audiencia + no over-trigger.
2. `tools.ts`: descripción de `searchMemory` con categorías + condición (sin "SIEMPRE").
3. Tests de prompt/tools actualizados (verdes).

## Fases (secuencial; TDD)
1. **Tests primero:** actualizar `prompt.test.ts` (quitar el assert de "Palmira"; asertar voz + sin biografía +
   grounding duro) y `tools.test.ts` (categorías, sin "SIEMPRE"). _Verif:_ rojo esperado.
2. **prompt.ts + tools.ts:** aplicar los cambios hasta verde.
3. **Verificación e2e** (ver abajo).

## Verificación (DoD)
`pnpm -r typecheck` + `biome` + `pnpm -r test` limpios. e2e con `trace_events` como evidencia:
- "¿de dónde es Kevin?" → `searchMemory` → **Bucaramanga** (CV), no "caleño".
- "¿quién eres?" → sin inventar origen/fútbol.
- "hola" → **no** dispara `searchMemory` (no over-trigger; ver `trace_events`).
- "¿a Kevin le gusta el fútbol?" → "no tengo ese dato" + alternativa (por audiencia).
- Persona intacta (voseo presente).

## Estrategia de ejecución
**Orquestador directo** — cambio chico/acotado (2 archivos + tests), diseño ya resuelto y verificado en
§Hallazgos (brainstorming hecho). TDD. Sin subagentes (no hay trabajo paralelo/independiente que lo justifique),
sin worktree. Rama `feat/grounding-voice-not-facts`.

## Visión registrada (diferida) — "Vaio se nutre solo"
Kevin (2026-06-13) pidió considerar/registrar la **memoria viva auto-curada + self-awareness + fuentes
crudas/tiempo-real** ("Vaio accede a sus fuentes crudas, incl. su propio repo, y decide qué guardar"). **Decisión:
grounding ahora; TODO ese slice se DIFIERE a sus fases** (harness eje 2 / Fase 2 facts / Fase 3 grafos),
registrado en `SPEC.md` (visión) + cross-links en `NEXT-STEPS`. Detalle/decomposición en el design del grounding
(sección de visión) y en `SPEC.md`. Conexión: el grounding hace que los hechos vivan en memoria; esta visión es
cómo esa memoria crece sola. La **curación agéntica** (write-action + HITL) es el seam a contemplar al diseñar
el harness.

## Fuera de alcance
Ingerir hechos personales nuevos; harness; panel de conversaciones; system-prompt por DB; el slice de memoria viva.
