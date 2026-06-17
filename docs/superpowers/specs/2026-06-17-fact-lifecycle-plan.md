# Ciclo de vida del fact (Inc 1) — Plan de alto nivel

> Qué hacer (fases, entregables, secuencia, dependencias, verificación) + Estrategia de ejecución. El **cómo**
> técnico (firmas, DDL, edge-cases) vive en `2026-06-17-fact-lifecycle-design.md` (no se repite acá; se referencia).

## Contexto y objetivo

El cluster "ciclo de vida del fact" es el **PRÓXIMO MAYOR** del roadmap (decisión de Kevin 2026-06-16). Se entrega
**faseado**: **Inc 1** (este plan) cierra el bug P2 (cercanía coseno tratada como contradicción → facts colgados en
`pending`) y la fuga de memoria rancia, con **tres pilares**: (1) un **juez de contradicción LLM** compartido por
los dos caminos de curación; (2) **atomicidad** (descomponer statements compuestos antes de juzgar); (3)
**desaprender** facts (invalidar bi-temporal). **Inc 2** (después, su propio par design+plan) = el **hilo-puntero**;
Inc 1 deja las costuras.

Decisiones de Kevin cerradas en planificación: invalidar (no borrar) · juez **unificado** (ambos caminos) ·
fasear · `unlearnFact` tool nueva · escalada+alta-confianza → auto-invalida+visible · juicio **completo** (sin
truncar por `LIMIT`) · atomicidad **fundacional** · diferir portfolio↔facts y consolidación ontológica.

## Entregables (fases verificables)

| # | Entregable | Depende de | Verificación |
|---|-----------|-----------|--------------|
| 1a | `ConflictJudge` (puerto+adapter) | — | tests adapter (normalización/degradación/N-vs-1) |
| 1b | `FactStore.invalidate` + `findConfirmedNear` + juicio completo (sin LIMIT, cap logueado) | — | tests (idempotente, no-borra) |
| 1c | `FactDecomposer` (evolución del drafter, lista atómica) | — | tests (compuesto→N, atómico→1, sensible→[]) |
| 2 | Wiring (`index.ts`, `ActionContext`, `config.ts` umbral/cap, deps de `curate`) | 1a-1c | typecheck + boot `/health` |
| 3 | `curate` reescrito (decompone+bucle+juez+middleware-siempre+linkFact-siempre+confirmación) | 2 | tests regresión + e2e escalada |
| 4 | `rememberFact` con decompose+juez | 2 | tests + e2e conversacional |
| 5 | `unlearnFact` + registry | 2 | tests + e2e desaprender |

## Secuencia y dependencias

- **1a, 1b, 1c son independientes** (puertos/adapters aislados, sin estado compartido) → paralelizables.
- **2** es la barrera: cablea las tres piezas; el resto depende de él.
- **3, 4, 5 son secuenciales-directos**: comparten el wiring y los call-sites; el hook `PostToolUse` de typecheck
  bloquea al guardar `.ts`, así que ediciones paralelas sobre el mismo árbol chocarían.

## Estrategia de ejecución

**Híbrido: subagentes para la fase 1, orquestador-directo para 2-5.**
- **Fase 1 (1a+1b+1c) → subagentes en paralelo.** Tres piezas **grandes e independientes** (cada una = puerto +
  adapter + tests, sin tocar archivos comunes): encaja en el caso donde los subagentes rinden (trabajo
  independiente/paralelo, sin estado compartido). Despliegue: un subagente por pieza con el design como contrato.
- **Fases 2-5 → directo (yo orquesto).** Acopladas al wiring común (`index.ts`, `ActionContext`,
  `escalation-inbound.ts`) y **secuenciales** (3-5 dependen de 2). Paralelizarlas haría chocar el typecheck-hook y
  generaría conflictos de merge sobre los mismos archivos. Es trabajo coherente "un cambio por vez" → más barato y
  seguro directo (pocos $/mes), y mantiene la disciplina de incrementos chicos verificados.
- **TDD** en la lógica pura (decomposer/juez/invalidate/curate/unlearn): tests antes del código (la disciplina del
  repo para `memory`/`facts`).

## Verificación macro (evidencia antes de "listo")
- `pnpm -r typecheck` + `pnpm exec biome check .` + `pnpm -r test` limpios; `/health` 200.
- **e2e atomicidad:** statement compuesto → facts atómicos separados, cada uno recuperable.
- **e2e conversacional** (owner): pasta+fútbol → coexisten, NADA pending (regresión P2); "no le gusta el fútbol" +
  "anécdota de fútbol" → coexisten; "ya no le gusta X, ahora Y" → pending → `resolveFact` reemplaza; `unlearnFact`
  → invalida y deja de aflorar en `searchMemory`.
- **e2e escalada:** respuesta que contradice un vigente de alta confianza → auto-invalida + aviso visible; aditiva
  → coexiste sin colgar pending.
- **fallback** del juez/decomposer (primario caído → conservador, no rompe el turno).

## Fuera de alcance (diferidos, apuntados en NEXT-STEPS)
- (a) **portfolio↔facts**: cruce `documents`/`facts` + precedencia (fact confirmado gana sobre la fuente).
- (b) **consolidación ontológica** ("completar" facts del mismo tópico) → Fase 3 (Graphiti).
- (c) **feedback cross-fuente del juez** (puente de (a): sugerir corregir el dato en el portfolio) — la costura
  `suggestion` queda lista en Inc 1.
- **Inc 2 — hilo-puntero**: continuar/ajustar/desaprender anclado al `threadId` de la escalada (Inv #8).

## Cierre documental (al terminar Inc 1)
Reconciliar `NEXT-STEPS.md` (Inc 1 → Historial cuando Kevin verifique; Inc 2 + diferidos como WIP rastreable),
`LEARNINGS.md` ("cercanía vectorial ≠ contradicción" → resuelto; lección de atomicidad), y la memoria de la
herramienta si surge un principio durable.
