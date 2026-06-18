# Plan — Inc 2: hilo consciente de su razón

> Par: [`-design.md`](2026-06-18-fact-lifecycle-inc2-thread-aware-design.md) (diseño técnico de bajo
> nivel: firmas, render de la nota, ancla). Este archivo = alto nivel + estrategia. No duplica el design.

## Objetivo

Que Vaio lleve el **contexto del origen del hilo** de escalada (nota de sistema, cada turno) y que el
`factId` ya anclado habilite "desaprendé ESO" por pronombre de forma **determinística** (Inv #8).
Decisiones de Kevin: anclaje determinístico + nota cada turno (stateless).

## Fases (secuencia con dependencias)

1. **Cimiento — port + adapter.** `ThreadOrigin` + `findResolvedByTopic` (LEFT JOIN a `facts`).
   Entregable: lookup de la escalada resuelta por topic. Sin migración (columnas existentes). Test del
   store primero. → habilita todo lo demás.
2. **Conciencia — nota en el prompt.** Param `threadOrigin` en `buildSystemPrompt` + bloque localizado
   de fondo. Entregable: la nota se renderiza (pura, testeable). Depende solo del tipo (fase 1).
3. **Ancla — unlearnFact.** `ActionContext.threadOrigin` + param `thisThread`. Entregable: "desaprendé
   eso" invalida el fact anclado sin matcher. Depende del tipo (fase 1).
4. **Cableado — threading.** `TurnContext.threadOrigin` (agent.ts → prompt + tools) + lookup en
   `handleTurn` (Telegram). Entregable: la nota y el ancla llegan al modelo en vivo. Depende de 1-3.
5. **Verificación.** typecheck + biome + tests (nuevos incluidos) + `/health`; commit atómico. e2e
   conversacional de Kevin (Telegram) como gate final antes de merge a `main`.

## Verificación macro
- Unit: prompt (nota), unlearnFact (ancla), store (lookup), wiring Telegram. Ver design §Tests.
- e2e (Kevin, Telegram): escalar desde otra cuenta → responder en el hilo → "olvidá eso" en el mismo
  hilo → desaprende el fact anclado (visible) sin re-preguntar; "en realidad es X" → rememberFact
  corrige (supersede); fuera del hilo la nota no aparece.

## Estrategia de ejecución

**Directo (orquestador-yo), sin subagentes.** Es un **vertical slice secuencial y acoplado**: un único
tipo (`ThreadOrigin`) fluye por port → adapter → core (agent/prompt/tool) → adapter Telegram, y cada
fase depende de la anterior (el cableado no compila sin el tipo; la nota/ancla no sirven sin el lookup).
No hay sub-tareas independientes ni paralelizables que justifiquen el costo de coordinar subagentes —
desplegarlos acá agregaría overhead sin ganancia (criterio CLAUDE.md: subagentes rinden en trabajo
grande/independiente/paralelo; esto es chico/acoplado/secuencial). La exploración de diseño SÍ se hizo
con 3 agentes `Explore` en paralelo (mapa de escaladas, ciclo de facts, notas/ActionContext); la
**implementación** va directa con TDD por archivo.

## Riesgos / mitigaciones
- **Fuga del uuid al modelo** → la nota solo lleva NL; el `factId` vive en `ActionContext` (test lo
  verifica).
- **Falsos positivos del lookup** → solo owner + `threadId` presente; query por topic exacto.
- **Costo por turno** → query indexada sub-ms, solo turnos del owner en hilo (Kevin: hilos efímeros).
- **Ancla sobre fact equivocado** → el modelo solo pone `thisThread:true` ante deixis clara (framing);
  degrada a `about` si no hay ancla (fallo visible).

## Post-merge
Reconciliar `NEXT-STEPS.md` (cluster Inc 2 → Historial) tras el OK de Kevin del e2e. Lección a
`LEARNINGS.md` si surge algo no obvio. Costuras Inc 1 que quedan para otros incrementos (refuerzo del
juez, conciencia de huecos) siguen en su propio WIP.
