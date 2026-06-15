# Diseño técnico — Adjudicación de conflictos / staleness de `facts`

> **Altitud:** spec técnico (firmas, DDL, query, edge-cases). Plan de alto nivel + estrategia de ejecución →
> [`2026-06-14-facts-conflict-adjudication-plan.md`](2026-06-14-facts-conflict-adjudication-plan.md).
> **Cimiento:** `saveFact` + `facts` bi-temporal ya mergeado
> ([`2026-06-13-savefact-curation-hitl-design.md`](2026-06-13-savefact-curation-hitl-design.md)). Esta iteración
> agrega el **motor de adjudicación** que el diseño original dejó como "futuro".

## Refinamiento post-e2e Telegram (2026-06-14) — bug de continuidad + auto-save
El e2e real por Telegram destapó que el flujo de 2 turnos **perdía los ids de conflicto**: se detectan al
**proponer** (turno N) pero se confirma en el turno N+1, y para entonces los ids eran inalcanzables (el historial
solo persiste `user`/`assistant`, no los tool results; el bloque de pendientes mostraba solo `[id] «stmt»`;
`searchMemory` no expone ids) → el modelo nunca pasaba `supersedes` → `invalid_at` nunca se marcaba (verificado
en DB: 4 facts contradictorios todos vigentes). **Hallazgo de medición:** la distancia coseno NO separa conflicto
real de falso (real "fútbol" 0.213 vs falso "hamburguesas~fútbol" 0.192 — el falso más cerca); el embedding capta
la **estructura** ("A Kevin le gusta X") más que la contradicción → ningún umbral los separa; **el modelo es el
juez** (filtró bien). Cambios:
1. **`listPending` recomputa los conflictos de cada pendiente con el embedding YA guardado** (sin re-embeber, sin
   migración) → `PendingFact.conflicts: ConflictCandidate[]`; `prompt.ts` los renderiza con sus ids → el turno de
   confirmación tiene los ids para `supersedes`. Helper `findNearConfirmed` reusado por `propose` y `listPending`.
2. **Auto-save sin conflicto:** `proposeFact` sin conflictos instruye commitear **en el acto** (sin pedir
   confirmación; el owner ya lo pidió). La confirmación queda **solo** para resolver conflictos.
3. **Menos candidatos** (`FACT_CONFLICT_CANDIDATES` 3→2) + wording "podría reemplazar, vos decidís".
Pendiente: re-verificación owner por Telegram (comportamiento de Vaio con la nueva guía del prompt).

## Objetivo
Que `saveFact` deje de ser **solo aditivo**: al confirmar un hecho que contradice uno vigente, **invalidar el
viejo** (bi-temporal: marcar, nunca borrar) en vez de acumular dos `confirmed` que `searchMemory` devuelve
juntos. **La adjudicación pasa al ESCRIBIR (commit), no al recuperar** (aprendizaje load-bearing: los modelos
buenos *resisten* lo recuperado → no alcanza con que el retrieval traiga ambos).

## Decisiones cerradas (Kevin, 2026-06-14)
1. **Detección = cercanía vectorial + el MODELO juzga.** Se recuperan facts confirmados cercanos (mismo
   principal, sobre umbral generoso) y se le presentan a Vaio; con el contexto de la charla decide reemplazar vs
   coexistir. Sin juez LLM aparte. El umbral es generoso a propósito: la cercanía vectorial detecta RELACIÓN, no
   CONTRADICCIÓN ("pizza"/"pasta" cercanas pero conviven) → sobre-recuperar es inocuo porque el modelo + el owner
   filtran; el umbral solo corta ruido lejano.
2. **Resolución plegada a la confirmación existente.** El conflicto se detecta **al PROPONER**; Vaio lo menciona
   en la misma pregunta de confirmación; un "sí" del owner invalida el viejo y confirma el nuevo. Sin round-trip extra.
3. **Linaje = columna `supersedes`** (ids reemplazados) en el fact nuevo.

## Modelo de datos (migración `0006`)
`facts` += una columna (las bi-temporales `valid_at`/`invalid_at`/`created_at`/`expired_at`/`decided_at` ya están):
```ts
// schema.ts, dentro de pgTable("facts", { … })
supersedes: jsonb("supersedes").$type<string[]>(), // nullable; ids de facts que este invalidó (linaje)
```
DDL efectivo: `ALTER TABLE facts ADD COLUMN supersedes jsonb;` (lo genera `drizzle-kit`). Sin índice nuevo.

## Puerto `FactStore` (firmas nuevas)
```ts
// ports/facts.ts
export interface ConflictCandidate {
  id: string
  statement: string
  validAt: Date | null   // para que Vaio diga "guardado el 12/6"
}

export interface FactStore {
  // propose ahora DEVUELVE los conflictos detectados (además del id).
  propose(input: {
    statement: string; principalId: string; channel: string
    conversationId?: string; turnId?: string
  }): Promise<{ id: string; conflicts: ConflictCandidate[] }>
  // commit ahora acepta los ids a superseder (invalidar) al confirmar.
  commit(id: string, opts?: { supersedes?: string[] }): Promise<boolean>
  reject(id: string): Promise<boolean>                       // sin cambios
  listPending(principalId: string, limit?: number): Promise<PendingFact[]>  // sin cambios
}
```

## Adapter `neon-facts`
Recibe un parámetro de config nuevo: `createFactStore(db, embedder, { conflictDistance, conflictCandidates })`.

**`propose`** (embebe ahora — cambio de timing, ver abajo):
1. `emb = await embedder.embed([statement])` (best-effort). Inserta la fila `pending` con `embedding=emb ?? null`.
2. Si hubo `emb`: buscar candidatos cercanos confirmados-vigentes del mismo principal, excluyendo la fila nueva:
   ```sql
   SELECT id, statement, valid_at,
          (embedding <=> $emb) AS dist
   FROM facts
   WHERE status='confirmed' AND invalid_at IS NULL
     AND principal_id = $principal AND id <> $newId
     AND (embedding <=> $emb) < $conflictDistance
   ORDER BY dist
   LIMIT $conflictCandidates
   ```
   (Drizzle: `cosineDistance(facts.embedding, emb)` + `and(eq(status,'confirmed'), isNull(invalidAt),
   eq(principalId,…), ne(facts.id, newId), lt(cosineDistance(...), distance))`, `orderBy(asc dist)`, `limit`.)
3. Devolver `{ id, conflicts }` (sin `emb` → `conflicts: []`).

**`commit(id, opts)`** (reusa el embedding; tx):
1. Leer la fila `pending` (`statement`, `embedding`). Si no existe/no pending → `false` (idempotente).
2. Si `embedding` es null → `emb = embed([statement])` (fallback; si falla → `false`).
3. `db.transaction`:
   - `UPDATE facts SET status='confirmed', embedding=<emb>, valid_at=now(), decided_at=now(),
     supersedes=<opts.supersedes ?? null> WHERE id=$id AND status='pending'`.
   - Por cada `oldId` en `opts.supersedes` (si los hay): `UPDATE facts SET invalid_at=now(), expired_at=now()
     WHERE id=$oldId AND status='confirmed' AND invalid_at IS NULL` (solo invalida vigentes; ids inexistentes/
     ya-invalidados se saltean sin romper).
4. `true` si el UPDATE principal afectó ≥1 fila.

**Cambio de timing del embedding (justificado):** el diseño original embebía en `commit` (no gastar en
rechazos). La detección al proponer **exige** el embedding en `propose`. Trade-off aceptado: `proposeFact` es
owner-only y raro. Robustez: embed-falla-en-propose → fila sin embedding + `conflicts:[]`; `commit` embebe como
fallback. `searchMemory` no cambia (el HNSW parcial sigue indexando solo confirmados-vigentes; el embedding de un
`pending` no entra al índice).

## Config (`config.ts`)
```ts
// helper float (mismo patrón que positiveIntWithDefault, sin .int())
function positiveFloatWithDefault(def: number) {
  return z.preprocess((v) => (v === "" ? undefined : v),
    z.coerce.number().positive().default(def))
}
// envSchema:
FACT_CONFLICT_DISTANCE: positiveFloatWithDefault(0.45),  // cosine distance máx para "cercano" (generoso)
FACT_CONFLICT_CANDIDATES: positiveIntWithDefault(3),     // cuántos candidatos sugerir como máx
```
`.env.example` documenta ambas. El wiring (`index.ts`) pasa `{ conflictDistance: env.FACT_CONFLICT_DISTANCE,
conflictCandidates: env.FACT_CONFLICT_CANDIDATES }` a `createFactStore`.

## Acciones (`core/actions/`)
**`propose-fact.ts`** — `execute` arma el texto según `conflicts`:
- Sin conflictos → texto actual ("Propuesta registrada (id X). Pedile confirmación…").
- Con conflictos → agrega: *"⚠️ Puede chocar con hechos ya guardados:\n- [<id>] «<statement>» (del <validAt>)\n
  Si el usuario confirma REEMPLAZAR, llamá commitFact con decision:confirm y supersedes:[<ids>]. Si conviven
  (no se contradicen), commitFact sin supersedes."* Vaio decide cuáles `supersedes` según la charla.

**`commit-fact.ts`** — `inputSchema` += `supersedes: z.array(z.string()).optional().describe("ids de hechos que
este reemplaza/invalida — solo si el usuario confirmó reemplazarlos")`. Pasa `{ supersedes }` a `ctx.factStore.
commit(id, { supersedes })`. Texto de éxito: si hubo `supersedes` → "Listo, lo guardé y reemplacé el anterior.";
si no → texto actual.

## Edge-cases
- **Sin embedding al proponer** (embed falla): fila pending sin embedding, `conflicts:[]`; commit embebe luego.
- **`supersedes` con id inexistente / ya invalidado / no-confirmado:** el UPDATE filtra por `status='confirmed'
  AND invalid_at IS NULL` → se saltea, no rompe el commit.
- **`supersedes` apuntando a un `pending`:** no se invalida (filtro de status) — correcto (un pending no es
  recuperable, no hay conflicto real).
- **Auto-conflicto:** `id <> newId` excluye la propia fila recién creada.
- **Coexistencia (pizza/pasta):** Vaio NO manda `supersedes` → ambos quedan confirmed (comportamiento aditivo,
  deseado para hechos que no se contradicen).
- **Modelo manda `supersedes` sin que el owner confirme:** mitigado por la descripción de la tool ("solo si el
  usuario confirmó"); la confirmación del owner es el gate (mismo HITL estructural de `commitFact`).
- **`factStore:null`** (sin DB): degradación a cortesía igual que hoy.

## Testing (TDD)
`neon-facts` (adapter contra schema / fake según convención del repo):
1. `propose` inserta pending con embedding; devuelve `{id, conflicts}`.
2. `propose` con un confirmado cercano del mismo principal → aparece en `conflicts`.
3. `propose`: candidato lejano (dist > umbral) / otro principal / `pending` / `invalidAt!=null` → NO aparece.
4. `propose` con embed-falla → `conflicts:[]`, fila sin embedding.
5. `commit(id, {supersedes:[old]})` → nuevo confirmed con `supersedes=[old]` + old con `invalid_at` seteado (tx).
6. `commit(id)` sin supersedes → confirma, no invalida nada (comportamiento actual).
7. `commit` con supersedes a id inexistente/no-confirmado → confirma el nuevo, no rompe.
8. `commit` idempotente (segundo commit → false).

Acciones (fake `FactStore`):
9. `proposeFact.execute` con conflicts → el texto los lista + instruye `supersedes`; sin conflicts → texto actual.
10. `commitFact.execute` pasa `supersedes` a `commit`; éxito con supersedes → menciona el reemplazo.

## Invariantes respetados
- **Siempre responde:** todo error → cortesía + `tool.result {ok:false}` (sin throw al loop).
- **Bi-temporal:** nunca DELETE; invalidar = marcar `invalid_at`/`expired_at`. Linaje en `supersedes`.
- **HITL estructural:** nada se invalida sin pasar por la confirmación del owner (commitFact sobre un pending real).
- **ports/adapters-lite:** la detección/invalidación vive en el adapter tras el puerto; el core no toca SQL.
