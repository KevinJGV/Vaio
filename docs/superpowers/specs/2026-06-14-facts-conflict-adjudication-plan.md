# Adjudicación de conflictos de `facts` — Plan de alto nivel

> **For agentic workers:** ejecutar con TDD, commits frecuentes. Diseño técnico (firmas, DDL, query, edge-cases,
> tests) → [`2026-06-14-facts-conflict-adjudication-design.md`](2026-06-14-facts-conflict-adjudication-design.md)
> (NO se repite acá). Este doc = qué hacer, en qué orden, y la estrategia de ejecución.

**Goal:** que `saveFact` adjudique al confirmar — invalidar (bi-temporal) un fact vigente que el nuevo
contradice, plegando la resolución a la confirmación que ya existe, con linaje `supersedes`.

## Fases (secuencia con dependencias)

1. **Schema + migración `0006`** — `facts.supersedes jsonb`. `db:generate` → revisar el `.sql` → aplicar a un
   branch de Neon (`db:push`/`db:migrate`). *Dependencia de todo lo demás (el adapter escribe la columna).*
2. **Config** — `FACT_CONFLICT_DISTANCE` (+ helper `positiveFloatWithDefault`) y `FACT_CONFLICT_CANDIDATES` +
   `.env.example`. *Independiente; la consume el wiring del adapter.*
3. **Puerto `FactStore`** — nuevos tipos/firmas (`ConflictCandidate`, `propose→{id,conflicts}`,
   `commit(id,{supersedes})`). *Rompe typecheck en adapter+actions hasta cerrarlos (mismo PR) — por eso secuencial.*
4. **Adapter `neon-facts` — `propose`** (TDD) — embeber + detectar candidatos cercanos. *Depende de 1,2,3.*
5. **Adapter `neon-facts` — `commit` con `supersedes`** (TDD) — tx confirma + invalida + linaje. *Depende de 3.*
6. **Action `proposeFact`** (TDD) — texto con conflictos + instrucción de `supersedes`. *Depende de 4.*
7. **Action `commitFact`** (TDD) — input `supersedes` + pasaje a `commit`. *Depende de 5.*
8. **Wiring `index.ts`** — pasar la config al `createFactStore`. *Depende de 2.*
9. **Verificación + e2e owner** — suite completa + los 4 escenarios e2e del design (reemplazo, coexistencia,
   visitante sin tools, idempotencia). *Cierre.*

## Entregables
- Migración `0006` aplicada; `facts.supersedes` en el schema.
- `FactStore` con detección al proponer + invalidación con linaje al commitear.
- 2 envs nuevas documentadas.
- Tests nuevos (adapter + actions) verdes; suite total sin regresión.
- e2e owner real verificado (reemplazo y coexistencia).

## Estrategia de ejecución (OBLIGATORIA)
**Directo / secuencial (yo-orquestador), NO subagentes en paralelo.** Justificación por tamaño + acoplamiento:
- **Un solo subsistema** (`facts`): puerto → adapter → 2 actions → wiring, todos comparten los tipos nuevos del
  puerto. Cambiar la firma de `propose`/`commit` rompe typecheck en cascada hasta cerrar todos los consumidores
  → **el hook `PostToolUse` de typecheck bloquea** cualquier estado intermedio roto; subagentes en paralelo
  editando puerto+adapter+actions se pisarían.
- **Tareas chicas y dependientes** (la 4 depende de 3, la 6 de 4, etc.): no hay paralelismo real que explotar.
- **Riesgo concentrado en 2 puntos** (la query de detección y la tx de invalidación) que conviene tener en una
  sola cabeza con TODO el contexto, no repartidos.

Decisión visible: **directo**. (Exploración/diseño ya se hizo en plan mode con las 3 decisiones de producto
cerradas; no hay incertidumbre de arquitectura que justifique perspectivas paralelas.)

## Verificación
Ver §Verification del plan aprobado y §Testing del design. Gate de "listo": typecheck/biome/test/build limpios +
migración aplicada + e2e owner (reemplazo invalida el viejo y `searchMemory` devuelve solo el nuevo; coexistencia
no invalida; visitante no ve las tools).
