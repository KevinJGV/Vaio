# Ciclo de vida del fact (Inc 1) — Diseño técnico

> Bajo nivel (firmas, DDL, edge-cases). Alto nivel (fases/secuencia/estrategia) → `2026-06-17-fact-lifecycle-plan.md`.
> Cluster cohesivo; este doc cubre **Incremento 1** (juez de contradicción + atomicidad + desaprender). El
> **Incremento 2** (hilo-puntero) tiene su propio par design+plan cuando se retome — acá solo se dejan las costuras.

## Problema

Dos caminos de curación de facts juzgan la contradicción de forma **inconsistente**:
- **Conversacional** (`core/actions/remember-fact.ts` / `resolve-fact.ts`): el modelo del loop ve los conflictos
  cercanos numerados y decide `resolveFact(replaces)`. Funciona.
- **Determinístico** (`adapters/telegram/escalation-inbound.ts:67-123`, `curate`): trata `conflicts.length>0`
  (mera **cercanía coseno**, `FACT_CONFLICT_DISTANCE=0.45`) como **contradicción ciega** → deja el fact en
  `pending` colgado. **Bug P2 (e2e pasta/fútbol):** «le gusta la pasta» se marcó en conflicto con «le gusta el
  fútbol» (vecino vectorial por el patrón "le gusta X") → facts colgados en `pending`.

Además: (a) no hay forma de **desaprender** un fact confirmado (la memoria rancia sobrevive a un cambio de
opinión); (b) statements **compuestos** ("la piscina daba miedo, me gustaba explorar, …") se embeben en un vector
difuso → el juicio por-idea es imposible; (c) el `LIMIT` de candidatos **trunca el juicio** → cabos sueltos.

## Principio rector

La **cercanía coseno acota ruido lejano; el juicio de contradicción lo hace un LLM** (opción B de `LEARNINGS.md`
"cercanía vectorial ≠ contradicción"). Un solo **juez compartido** por ambos caminos. Facts **atómicos** (1 idea =
1 fact) como unidad. Desaprender = **invalidar bi-temporal** (reversible, no borrar).

---

## 1. `ConflictJudge` (puerto + adapter)

**`ports/conflict-judge.ts`** (nuevo):
```ts
export type ConflictVerdict = "contradicts" | "duplicate" | "coexists" | "unsure"
export interface JudgeCandidate { ordinal: number; statement: string }   // ordinal = índice estable, NO uuid (#8)
export interface ConflictJudgeInput {
  rawText: string          // texto CRUDO del usuario/owner — preserva el "ya no…" que la redacción pierde
  statement: string        // el statement redactado en 3ª persona (el átomo)
  candidates: JudgeCandidate[]
  locale: "es" | "en"
}
export interface JudgeDecision { ordinal: number; verdict: ConflictVerdict }
export interface ConflictJudgeResult {
  decisions: JudgeDecision[]   // 1 por candidato; faltantes/error → "coexists" (conservador)
  suggestion?: string          // recomendación accionable al owner (costura cross-fuente; ver §Costuras)
}
export interface ConflictJudge { judge(input: ConflictJudgeInput): Promise<ConflictJudgeResult> }
```

**`adapters/conflict-judge.ts`** (espejo de `adapters/fact-drafter.ts`): `generateObject` (AI SDK v6) con el
**modelo de CHAT** (el de summary falla `generateObject` — comentario `index.ts:220-221`). Schema zod:
```ts
const SCHEMA = z.object({
  decisions: z.array(z.object({
    ordinal: z.number().int().nonnegative().describe("el número del candidato que te di"),
    verdict: z.enum(["contradicts", "duplicate", "coexists", "unsure"]).describe(
      "contradicts = no pueden ser ambos ciertos a la vez (cambió de stack/ciudad, 'ya no le gusta X'); " +
      "duplicate = dicen lo MISMO; coexists = ambos ciertos (aditivo); unsure = no estás seguro"),
  })),
  suggestion: z.string().describe("vacío salvo que tengas una recomendación útil para el owner"),
})
```
**Prompt (ES/EN):** "Te doy un hecho NUEVO sobre Kevin + una lista numerada de hechos VIGENTES cercanos. Para CADA
número decidí la relación. **Cercanía de tema NO es contradicción** — distinguí dimensiones: **preferencia ≠
atributo ≠ anécdota/evento** ('no le gusta el fútbol' + 'una anécdota de fútbol' COEXISTEN; 'le gusta la pasta' +
'le gusta el fútbol' COEXISTEN). Solo `contradicts` cuando no pueden ser ambos ciertos a la vez."

**Edge-cases / degradación (Inv #1, conservador):**
- `candidates: []` → cortocircuito, `{ decisions: [] }` **sin llamar al LLM** (ahorro).
- error / timeout / ordinal fuera de rango / `decisions` incompletas → el adapter **reconstruye un veredicto por
  cada candidato de entrada, default `coexists`** (NUNCA invalida por error).
- `suggestion` vacío/ausente → se ignora.

## 2. `FactDecomposer` (atomicidad — evolución de `FactDrafter`)

La capa de redacción de hoy (`ports/fact-drafter.ts` / `adapters/fact-drafter.ts`, emite **un** `statement`) se
generaliza a emitir una **lista de facts atómicos mono-idea**:
```ts
// ports/fact-decomposer.ts
export interface DecomposeInput { rawText: string; question?: string; locale: "es" | "en" }
export interface DecomposeResult { statements: string[] }   // cada uno: 1 idea, 3ª persona; [] si nada factual/sensible
export interface FactDecomposer { decompose(input: DecomposeInput): Promise<DecomposeResult> }
```
**Adapter:** `generateObject`, modelo de chat. Schema `{ statements: string[] }`. Prompt: "descomponé en hechos
ATÓMICOS (una idea por hecho), 3ª persona; NO mezclar ideas; **descartá lo sensible/no-factual** (no lo incluyas —
números/direcciones/credenciales/'no le pases…')". El filtro sensible/no-factual que tenía el drafter se conserva
acá (= statements vacío para esos fragmentos).
- Ejemplo: "la piscina daba miedo, me gustaba explorar, los viajes eran en familia" → `["A Kevin le daban miedo
  las piscinas", "A Kevin le gustaba explorar", "Los viajes de Kevin eran en familia"]`.
- **Compat:** `fact-drafter.{ts}` se renombra/absorbe (`git mv`); call-sites (`index.ts`, `escalation-inbound.ts`)
  actualizados. El antiguo `FactDraftResult { statement: string|null }` → `DecomposeResult { statements: [] | [s] | [s…] }`.
- **Degradación:** error → `{ statements: [] }` (curate: no aprende ante duda). En `rememberFact` el caller usa el
  `statement` crudo como **único átomo** si el decomposer falla (no romper el flujo probado).

## 3. `FactStore`: `invalidate` + `findConfirmedNear` + juicio completo

**`ports/facts.ts`** (extender la interfaz):
```ts
/** Desaprende un fact CONFIRMADO vigente: invalidAt=now, expiredAt=now, decidedAt=now; SIN supersede.
 *  Reversible/auditable (la fila queda). false si no existe o no está confirmed-vigente (idempotente). */
invalidate(id: string): Promise<boolean>
/** Facts CONFIRMADOS vigentes de un principal, los más cercanos por coseno a `query` (para desaprender por
 *  similitud → el owner los ve por ordinal, Inv #8). best-effort: embed falla → []. */
findConfirmedNear(query: string, principalId: string, limit?: number): Promise<ConflictCandidate[]>
```

**`adapters/neon-facts.ts`:**
```ts
async invalidate(id) {
  const res = await db.update(facts)
    .set({ invalidAt: sql`now()`, expiredAt: sql`now()`, decidedAt: sql`now()` })
    .where(and(eq(facts.id, id), eq(facts.status, "confirmed"), isNull(facts.invalidAt)))
    .returning({ id: facts.id })
  return res.length > 0   // idempotente: 2ª llamada → 0 filas → false
}
```
- `findConfirmedNear`: embebe `query` (best-effort) y reusa `findNearConfirmed` (refactorizado para aceptar
  `excludeId?: string`; con `""` no excluye nada).
- **`findNearConfirmed` — juicio COMPLETO (sin cabos sueltos):** quitar el `LIMIT` chico. Traer **todos** los
  confirmados vigentes `WHERE status='confirmed' AND invalidAt IS NULL AND principalId=$ AND id != $exclude AND
  cosineDistance(embedding, $emb) < FACT_CONFLICT_DISTANCE ORDER BY dist ASC`, con **`LIMIT FACT_CONFLICT_MAX`**
  (cap de seguridad ~50). Si las filas devueltas == `FACT_CONFLICT_MAX` → **`logger.warn`** (no silent cap). El juez
  recibe la lista entera; `FACT_CONFLICT_CANDIDATES` ya NO trunca el juicio (pasa a presentación).

**DDL: NINGUNA migración.** El modelo bi-temporal (`schema.ts:170-198`) ya tiene `invalidAt`/`expiredAt`/
`decidedAt`/`supersedes`. El índice HNSW (`WHERE status='confirmed' AND invalidAt IS NULL`) excluye lo invalidado
del retrieval solo.

## 4. Camino determinístico `curate` (`escalation-inbound.ts`)

Reemplazar el bloque buggy (`conflicts.length>0 → pending`, ~líneas 103-115). Nuevo flujo:
1. **`decompose(ownerText)` SIEMPRE** (no gated por `shouldLearn`) → lista de átomos. `shouldLearn` decide si se
   **persisten**; los átomos sirven para el middleware de invalidación aunque no se aprenda.
2. **Bucle por átomo** (`statement`):
   - `propose(statement)` → `{ id, conflicts }`.
   - `conflicts.length === 0` → `commit(id)`.
   - `> 0` → `judge({ rawText: ownerText, statement, candidates: conflicts↦ordinal, locale })`:
     - ≥1 `contradicts` → `commit(id, { supersedes: [ids contradichos] })` → auto-invalida los rancios. **Aviso
       VISIBLE** en el hilo ("guardé «X», di de baja «Y»").
     - 0 `contradicts` y ≥1 `duplicate` → `reject(id)` (redundante, "ya lo sabía").
     - todo `coexists`/`unsure` → `commit(id)` sin supersedes (aditivo). **← fix pasta/fútbol: nada pending.**
3. **Middleware-siempre** (`shouldLearn=false` pero contradice): cuando NO se persiste pero un átomo redactado
   marca `contradicts` de alta confianza contra un vigente → `invalidate(id_viejo)` + aviso visible. (Sin átomo
   redactado → no se puede juzgar; fuga residual aceptada.) Evitar doble-invalidación: cuando `shouldLearn`, el
   `commit({supersedes})` ya invalida — el middleware extra solo aplica al camino que NO persiste.
4. `markAnswered` corre **antes** del bucle (idempotencia ante retry de webhook; ver §Costuras #4).
5. Simplificar `ownerConfirmation` (`escalation-inbound.ts:127-142`): desaparece la rama "choca, decime con cuál";
   nombra el reemplazo (invalidación visible) y surface el `suggestion` del juez si hay.

**Mapeo ordinal→uuid (Inv #8):** `supersedes` se arma con `conflicts[decision.ordinal].id` de las decisiones
`contradicts`. El juez emitió ordinales; el sistema mapea.

## 5. Camino conversacional `rememberFact`

`decompose(statement)` → átomos (si ya es atómico, lista de 1 → sin cambio de UX). Por cada átomo (`remember-fact.ts:51-72`):
- `propose` → `conflicts.length===0` → `commit(id)` ("guardado").
- `>0` → `judge` (solo si hay candidatos):
  - solo `duplicate` (sin contradicts) → `reject(id)` ("ya lo tenía guardado").
  - todo `coexists` → `commit(id)` ("guardado"). **← el juez limpia el ruido: pasta/fútbol ya no molesta.**
  - `contradicts`/`unsure` → **dejar PENDING** listando SOLO los contradichos → `resolveFact` (HITL presente; **no
    auto-invalidar acá** — el owner está en el loop). La lista pending viene **pre-filtrada por el juez** → menos ruido.
- **No cambia** la firma de `rememberFact`/`resolveFact` ni el `pendingBlock` (`prompt.ts:83-143`). `resolveFact`
  sigue siendo el canal HITL del caso dudoso (no es código muerto).
- **Presentación:** la lista de contradichos se muestra hasta `FACT_CONFLICT_CANDIDATES` con **"+N más"** si excede
  (el juicio ya cubrió todos; el "+N más" es solo visual y rara vez se gatilla porque viene pre-filtrado).

**Riesgo continuidad de ordinales** (entre el turno que lista y el que resuelve): `listPending` recomputa los
conflicts; el desajuste es **pre-existente** (no regresión nueva) → se difiere a Inc 2 (el hilo-puntero ancla el id).

## 6. Tool nueva `unlearnFact` (`core/actions/unlearn-fact.ts`)

Owner-only, `sideEffecting:true`. Intención distinta de `resolveFact` (que adjudica *pendientes*); `unlearnFact`
olvida *confirmados vigentes* → tool propia y extensible (Inv #10), no param. Patrón 2-fases (Inv #8, sin uuids):
```ts
inputSchema: z.object({
  about: z.string().min(1).describe("qué desaprender en lenguaje natural ('que le gusta la pasta'). Yo busco los candidatos."),
  which: z.number().int().nonnegative().optional().describe("si te mostré una lista, el número a olvidar. Omitilo en la 1ª llamada."),
})
```
`execute`: `findConfirmedNear(about, principal.id, N)`:
- 0 candidatos → "no encontré nada parecido guardado".
- 1 candidato bajo **umbral estricto** (más estricto que el de retrieval) → **auto-invalida in-turn**
  (`vaio-chain-to-resolve-in-turn`): `invalidate(c[0].id)` → "listo, lo olvidé: «X»".
- ≥2 (o 1 no tan cercano) → listar por ordinal → el modelo re-llama con `which` → `invalidate(c[which].id)`.
Fallo VISIBLE (nombra el statement olvidado) + reversible. Registrar en `core/actions/registry.ts`.
**Continuidad:** `findConfirmedNear(about)` es determinístico (mismo embed, mismo orden) → el ordinal es estable
entre los dos turnos salvo cambio concurrente; el resultado dice QUÉ se olvidó (fallo visible) + es reversible.

## 7. Wiring (`index.ts`) + config + `ActionContext`

- `index.ts` (~222): `conflictJudge = createConflictJudge({ model, logger })` + `factDecomposer =
  createFactDecomposer({ model, logger })` (ambos modelo de chat). Reemplaza `factDrafter`.
- `ActionContext` (`core/actions/types.ts`): `conflictJudge?: ConflictJudge | null` + `factDecomposer?:
  FactDecomposer | null`, inyectados junto a `factStore`.
- `curate` deps (`escalation-inbound.ts:31-39`): añadir `conflictJudge` + `factDecomposer`. Wiring en el objeto
  `telegram` (`index.ts` ~320-342).
- `config.ts`: `FACT_CONFLICT_DISTANCE` 0.45 → ~0.55 (umbral de juicio más generoso, deja que el juez filtre);
  nuevo `FACT_CONFLICT_MAX` (~50, cap de seguridad logueado); `FACT_CONFLICT_CANDIDATES` (2→5) = **solo
  presentación**. Documentar en `.env.example` los nuevos/cambiados.
- Degradación: `conflictJudge`/`factDecomposer` null → conservador (commit sin supersedes / statement crudo como
  único átomo) — son mejora, no requisito (Inv #1).

## Costuras para Inc 2 (hilo-puntero)
1. **`invalidate(id)` standalone** acepta un id de CUALQUIER fuente (hoy: similitud/supersede; Inc 2:
   `escalations.factId` anclado por el hilo). No acoplarlo a "el id viene de un propose reciente".
2. **Juez por ordinales** → Inc 2 reusa el mapeo (ordinal 0 = el fact anclado por el hilo).
3. **`linkFact` SIEMPRE que se cura** (incl. caso conflicto/pending), no solo al commitear sin conflicto
   (`escalation-inbound.ts:117`) → el hilo→fact ancla bien después. **Costura clave.**
4. **Idempotencia de la curación por `escalationId`**: guard "no curar si `escalations.factId` ya seteado".
5. **`suggestion` del juez** → puente del feedback cross-fuente (portfolio↔facts) cuando se active.

## Tests (Vitest, fakes — sin LLM real)
- `fact-decomposer`: compuesto → N átomos; atómico → 1; sensible/no-factual → `[]`.
- `conflict-judge` (adapter, generateObject fake): normalización (3 candidatos, 2 decisions → 3º `coexists`);
  ordinal fuera de rango descartado; error → todos `coexists`; `candidates:[]` → sin llamada; N-vs-1; preferencia≠
  anécdota; **todos los del umbral juzgados sin truncar** + warn al cap.
- `FactStore.invalidate`: confirmed-vigente → true; 2ª → false (idempotente); sobre pending → false; inexistente →
  false; la fila NO se borra (sigue seleccionable con `invalidAt` no-null).
- `curate`: **regresión pasta/fútbol** (coexiste → commit, NADA pending); contradice → `commit({supersedes})`;
  dup → `reject`; middleware-siempre (`shouldLearn=false` + contradice → `invalidate`); **compuesto → átomos separados**.
- `rememberFact`: coexiste → auto-commit sin pending; dup → reject "ya lo tenía"; contradice → pending con solo el contradicho.
- `unlearnFact`: 0/1(auto)/≥2(lista) candidatos; `which` invalida el ordinal correcto; sin uuids en el output.

## Riesgos
1. **Costo LLM:** juez = 1 `generateObject` extra **solo si hay candidatos cercanos** (caso común gratis). Bajo (owner-only).
2. **Falso `contradicts` → invalidación indebida:** mitigado por prompt conservador + en conversacional el
   contradicts queda PENDING (HITL, no auto-invalida) + reversibilidad bi-temporal + invalidación VISIBLE. En
   `curate` sí auto-invalida (sin HITL en vivo) — aceptable: alta confianza + reversible + aviso a Kevin.
3. **Continuidad de ordinales** entre turnos: determinístico salvo cambio concurrente; fallo visible/reversible →
   fix robusto difiere a Inc 2.
4. **Decomposer parte de más:** si sobre-descompone, varios facts atómicos casi-idénticos → el dedup del juez
   (`duplicate`) los absorbe en la próxima curación; aceptable.
