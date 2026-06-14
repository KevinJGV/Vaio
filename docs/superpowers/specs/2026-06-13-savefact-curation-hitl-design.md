# Diseño técnico — `saveFact` (curación agéntica) + HITL persistido + tabla `facts` bi-temporal

> **Fecha:** 2026-06-13 · **Tema:** `savefact-curation-hitl` · **Tipo:** diseño técnico (bajo nivel).
> **Par:** plan de alto nivel en [`2026-06-13-savefact-curation-hitl-plan.md`](2026-06-13-savefact-curation-hitl-plan.md).
> **Cimiento:** el **harness de tools** (registry + gating 2 capas + seam HITL delgado) ya mergeado
> ([`2026-06-13-tools-harness-registry-design.md`](2026-06-13-tools-harness-registry-design.md)). Esta es la
> **1ª write-action** que lo ejercita.
> **Norte:** "Vaio se nutre solo" (`SPEC.md` §correspondiente) — la curación agéntica es "el corazón del vivo".
> Cierra el followup #5 de grounding ("alimentar info real a la MEMORIA, no al prompt").

## Objetivo y alcance (lo que ESTA iteración entrega)

La **primera acción con efecto** del agente: charlando con el **owner** (Kevin) por Telegram, Vaio detecta un
hecho nuevo sobre Kevin, **propone guardarlo**, Kevin **confirma**, y el hecho se escribe en una **memoria
durable** (`facts`) que `searchMemory` ya recupera. La confirmación es **conversacional pero respaldada por
persistencia**: si la charla se corta antes de confirmar, la propuesta **queda viva** y Vaio la retoma el
próximo contacto.

**Decisiones cerradas con Kevin (2026-06-13):**
1. **1ª write-action = `saveFact` (curación), owner-only.** No `escalate` (Fase 2, queda para después).
2. **HITL Nivel B = confirmación conversacional + propuesta persistida.** No async cross-canal, **no** scheduler
   ni push proactivo (eso es Nivel C, su propia iteración). No se usa el HITL nativo del AI SDK v6.
3. **Storage = tabla `facts` propia, bi-temporal desde el día 1, motor mínimo.** No reusar `documents`.
4. **Forma = 2 tools `proposeFact` + `commitFact`** (no una sola con fases): `commitFact` exige el **id de una
   propuesta previa** → un fact no se fabrica inline → el HITL es **garantía estructural**, no solo convención.

**Fuera de alcance (su propia iteración, su par design+plan):** Nivel C (scheduler + push proactivo + turnos
proactivos); `escalate` + cola `unknown_questions`; dedup/adjudicación avanzada de facts; extracción automática
post-conversación (LLM); `feedback_type` del panel de conversaciones; facts desde el canal web; rerank.

## Estado actual (punto de partida, citado)

- `apps/agent/src/core/actions/types.ts` — `ActionDescriptor{name,sideEffecting,clearance,build(ctx)}`,
  `ActionContext{caps,principal,memory,emit,ids,logger,compressor?,ragIntensity?}`, `Clearance="anyone"|"owner"`.
- `apps/agent/src/core/actions/registry.ts:49-61` — `buildTools(ctx, actions=ACTIONS)` con gating de 2 capas;
  `deniedTool` (`:26-45`) es el deny path del seam.
- `apps/agent/src/core/capabilities.ts:9` — `ToolName="searchMemory"`; `:72-93` `createCapabilityResolver`
  (perfiles web / telegram-owner / telegram-visitor).
- `apps/agent/src/adapters/db/schema.ts:26` — `EMBEDDING_DIM=1536`; `:28-45` patrón `documents`
  (vector + HNSW `vector_cosine_ops`).
- `apps/agent/src/ports/memory.ts:10-22` — `Embedder.embed(texts)`, `MemoryStore.{searchMemory,upsertDocuments,clearSource}`.
- `apps/agent/src/adapters/neon-memory.ts:15-32` — `searchMemory` = `orderBy(cosineDistance(...)).limit(k)`.
- `apps/agent/src/core/agent.ts:146-158` — computa `principal`+`audience`; `:244-252` arma `buildTools(...)`.
- `apps/agent/src/core/prompt.ts` — `buildSystemPrompt({locale,audience,policyText,summary})`.

**Verificado con context7 (Drizzle pgvector):** `vector("col",{dimensions})` admite **NULL** (sin `.notNull()`);
HNSW `vector_cosine_ops`; `cosineDistance` + WHERE (`and`/`isNull`/`eq`); **partial index** vía `.where(sql\`…\`)`;
`unionAll` para combinar dos selects ordenados por distancia.

## Modelo de datos: tabla `facts` (migración `0004`)

Una sola tabla. Una propuesta y un hecho confirmado son la **misma fila** en distinto `status` (evita una tabla
`pending` aparte). Bi-temporal completo desde el día 1; el motor mínimo solo ejerce `pending→confirmed` + `invalidAt`.

```ts
// apps/agent/src/adapters/db/schema.ts
export const facts = pgTable(
  "facts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    statement: text("statement").notNull(),         // el hecho en lenguaje natural
    status: text("status").notNull().default("pending"), // 'pending'|'confirmed'|'rejected'
    embedding: vector("embedding", { dimensions: EMBEDDING_DIM }), // NULLABLE: se llena al confirmar
    principalId: text("principal_id").notNull(),     // quién propuso/confirma (owner)
    channel: text("channel").notNull(),              // 'telegram' (origen)
    conversationId: uuid("conversation_id"),         // origen; sin FK dura (no acoplar)
    turnId: text("turn_id"),
    // valid time (cuándo el hecho es verdad en el mundo): null mientras pending; set al confirmar; invalidar = set invalidAt
    validAt: timestamp("valid_at", { withTimezone: true }),
    invalidAt: timestamp("invalid_at", { withTimezone: true }), // null = vigente; NO se borra
    // transaction time (cuándo el sistema lo supo / baja lógica de la versión)
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }), // cuándo se confirmó/rechazó
  },
  (t) => [
    // HNSW solo sobre lo recuperable (confirmado): índice PARCIAL.
    index("facts_embedding_idx")
      .using("hnsw", t.embedding.op("vector_cosine_ops"))
      .where(sql`${t.status} = 'confirmed' and ${t.invalidAt} is null`),
    index("facts_pending_idx").on(t.principalId, t.status), // listPending
  ]
)
```

**Bi-temporal, motor mínimo:**
- `propose` → fila `{status:'pending', validAt:null, embedding:null}`.
- `commit(id)` → `{status:'confirmed', validAt:now, decidedAt:now, embedding:<embed(statement)>}`.
- `reject(id)` → `{status:'rejected', decidedAt:now}`.
- **Invalidar** un hecho (futuro/corrección) → `set invalidAt=now` (+ `expiredAt=now`), **nunca DELETE** (paper
  STALE / Graphiti-Zep). Hoy no hay una acción de invalidación (no está en alcance), pero el esquema lo soporta.

> Nota DDL: la migración la genera `drizzle-kit` (`db:generate`). El índice parcial puede requerir ajuste manual
> del SQL si `drizzle-kit` no emite el `WHERE` — verificar el `.sql` generado (ver plan, Task migración).

## Puerto `FactStore` + adapter `neon-facts`

Escritura/listado de facts. Separado de `MemoryStore` (responsabilidad única). El adapter encapsula el `Embedder`
(igual que `neon-memory`) → el core no toca embeddings.

```ts
// apps/agent/src/ports/facts.ts
export interface PendingFact {
  id: string
  statement: string
  createdAt: Date | null
}

export interface FactStore {
  /** Registra una propuesta (status pending, sin embedding). Devuelve su id. */
  propose(input: {
    statement: string
    principalId: string
    channel: string
    conversationId?: string
    turnId?: string
  }): Promise<{ id: string }>
  /** Confirma una propuesta pendiente: embebe statement → confirmed, validAt=now.
   *  Devuelve false si el id no existe o no está pending (idempotente / a prueba de alucinación). */
  commit(id: string): Promise<boolean>
  /** Rechaza una propuesta pendiente. false si no existe/no pending. */
  reject(id: string): Promise<boolean>
  /** Propuestas pendientes de un principal (para retomarlas en el prompt). */
  listPending(principalId: string, limit?: number): Promise<PendingFact[]>
}
```

`commit`/`reject` validan `status='pending'` antes de actuar (un `commitFact` con id inventado o ya resuelto
devuelve `false`, no rompe nada). `commit` embebe `statement` vía `Embedder` y hace el `UPDATE`.

## Retrieval unificado (`MemoryStore.searchMemory`)

El **puerto no cambia**. El adapter `neon-memory.searchMemory` pasa a combinar `documents` + `facts` vigentes con
`unionAll`, ordenado por `cosineDistance`, top-k. El modelo ve **una sola memoria** (un fact entra como
`{source:"fact", url:"", chunk:statement}`); la tool `searchMemory` y el core **no cambian**.

```ts
async searchMemory(query, k = 6) {
  const [qEmb] = await embedder.embed([query]); if (!qEmb) return []
  const docs = db.select({ source: documents.source, url: documents.url, chunk: documents.chunk,
                           dist: cosineDistance(documents.embedding, qEmb).as("dist") }).from(documents)
  const facs = db.select({ source: sql<string>`'fact'`, url: sql<string|null>`null`, chunk: facts.statement,
                           dist: cosineDistance(facts.embedding, qEmb).as("dist") })
                 .from(facts).where(and(eq(facts.status, "confirmed"), isNull(facts.invalidAt)))
  const rows = await db.select().from(docs.unionAll(facs).as("m")).orderBy(asc(sql`dist`)).limit(k)
  return rows.map(r => ({ source: r.source, url: r.url ?? "", chunk: r.chunk }))
}
```

Para `neon-memory` poder leer `facts` necesita el import del schema (ya tiene `db`). **Decisión:** mantener la
lectura unificada acá (un fact recién confirmado es usable de inmediato, cerrando "se nutre"); la escritura va
por `FactStore`.

## Acciones nuevas (`core/actions/`)

Dos `ActionDescriptor`, ambas `sideEffecting:true`, `clearance:"owner"`. Necesitan `FactStore` → se agrega a
`ActionContext` (campo nuevo `factStore?: FactStore | null`).

```ts
// core/actions/propose-fact.ts
export const proposeFact: ActionDescriptor = {
  name: "proposeFact", sideEffecting: true, clearance: "owner",
  build(ctx) {
    return tool({
      description:
        "Propone guardar un HECHO nuevo y durable sobre Kevin (preferencia, dato de vida, cambio de stack, etc.) " +
        "que surgió en la charla. NO lo guarda: registra la propuesta y debés pedirle confirmación al usuario " +
        "antes de commitear. Usala solo con datos que valga la pena recordar a futuro; no para charla pasajera.",
      inputSchema: z.object({
        statement: z.string().describe("El hecho, en una frase clara y autocontenida (en 3ª persona sobre Kevin)."),
      }),
      execute: async ({ statement }, { toolCallId }) => {
        if (!ctx.factStore) { /* emit tool.result ok:false; return cortesía */ }
        const { id } = await ctx.factStore.propose({
          statement, principalId: ctx.principal.id, channel: ctx.principal.channel,
          conversationId: ctx.ids.conversationId, turnId: ctx.ids.turnId,
        })
        // emit tool.result ok:true (output incluye el id)
        return `Propuesta registrada (id ${id}). Pedile confirmación al usuario; si dice que sí, llamá commitFact con ese id.`
      },
    })
  },
}

// core/actions/commit-fact.ts
export const commitFact: ActionDescriptor = {
  name: "commitFact", sideEffecting: true, clearance: "owner",
  build(ctx) {
    return tool({
      description:
        "Confirma (guarda definitivamente) o rechaza una propuesta de hecho YA registrada con proposeFact. " +
        "Llamala SOLO después de que el usuario confirme/rechace explícitamente. Requiere el id de la propuesta.",
      inputSchema: z.object({
        id: z.string().describe("El id que devolvió proposeFact."),
        decision: z.enum(["confirm", "reject"]).describe("confirm = guardar; reject = descartar."),
      }),
      execute: async ({ id, decision }, { toolCallId }) => {
        if (!ctx.factStore) { /* cortesía */ }
        const ok = decision === "confirm" ? await ctx.factStore.commit(id) : await ctx.factStore.reject(id)
        // emit tool.result ok:<ok>
        return ok
          ? (decision === "confirm" ? "Listo, lo guardé en mi memoria." : "Ok, lo descarté.")
          : "No encontré esa propuesta pendiente (quizá ya se resolvió)."
      },
    })
  },
}
```

`ToolName` (en `capabilities.ts`) se extiende: `"searchMemory" | "proposeFact" | "commitFact"`. En
`createCapabilityResolver`, las dos nuevas se agregan a `allowedTools` **solo en el perfil telegram-owner**.
Resultado del gating de 2 capas: web y telegram-visitor **no las ven** (capa canal); el owner (trusted) pasa el
`clearance:"owner"`. Doble seguro: aunque por error quedaran en `allowedTools` de un no-owner, el `deniedTool`
las bloquea.

## Retomar pendientes (el corazón del Nivel B)

En `core/agent.ts`, tras resolver `caps`: si el perfil incluye `proposeFact` (owner) y hay `factStore`, cargar
`listPending(principal.id)` e inyectar un bloque al system prompt vía `buildSystemPrompt`. `prompt.ts` suma un
parámetro opcional `pendingFacts?: PendingFact[]` y, si hay, agrega:

> *"Propuestas de memoria pendientes de tu confirmación:\n- [<id>] «<statement>»\nSi el usuario confirma una,
> llamá `commitFact` con su id; si la rechaza, `commitFact` con decision:reject."*

Así, aunque la charla original se haya cortado tras `proposeFact`, el modelo ve la propuesta viva el próximo
turno del owner y puede cerrarla. `listPending` se acota (`limit`, p.ej. 10) para no inflar el prompt.

## Wiring (`index.ts`)

- Crear `factStore = db ? createFactStore(db, embedder) : null` (junto a `memory`).
- Inyectarlo en el `ActionContext` que arma `agent.ts` (pasa por `AgentDeps` → `respond`). `agent.ts` lo recibe y
  lo pone en el objeto que va a `buildTools`.
- Boot log: incluir `facts: <on/off>` en el resumen de capacidades (sin secrets).

## Manejo de errores e invariantes

- **"Siempre responde":** `proposeFact`/`commitFact` nunca throw al loop — `factStore:null`, id inexistente o
  fallo de DB → texto de cortesía + `tool.result {ok:false}`. (Best-effort, como las demás tools.)
- **HITL estructural:** nada entra a la memoria recuperable hasta `commitFact(id)` sobre una fila `pending`
  real. `commitFact` no puede crear un fact desde cero.
- **Bi-temporal:** nunca DELETE; invalidar = marcar. Se preserva la historia.
- **Sin secrets en logs:** `statement` es contenido del usuario → respeta la redacción `LOG_PROMPTS` existente.
- **ports/adapters-lite:** `FactStore` es un puerto; el core depende de él, no del adapter Neon.

## Edge-cases

- **`factStore:null`** (sin DB): las tools degradan a cortesía; `listPending` devuelve `[]` → sin bloque de pendientes.
- **`commitFact` sobre id ya confirmado/rechazado:** `commit/reject` devuelven `false` (validan `status='pending'`)
  → "no encontré esa propuesta pendiente". Idempotente.
- **Propuesta sin confirmar nunca:** queda `pending` para siempre (no se recupera por `searchMemory`); reaparece
  en el bloque de pendientes. (Una limpieza/TTL de pendientes viejos = futuro, no urge.)
- **`statement` vacío/trivial:** el modelo no debería proponerlo (lo dice la descripción); no se valida en código
  más allá de `z.string()` no vacío (`min(1)`).
- **Embedding al confirmar falla:** `commit` propaga el fallo como `false` (la fila queda `pending`, reintentable).

## Estrategia de testing (TDD)

`FactStore` (con fake in-memory + el adapter contra schema):
1. `propose` crea fila `pending` sin embedding y devuelve id.
2. `commit(id)` → `confirmed`, `validAt` seteado, embedding presente; segundo `commit(id)` → `false` (idempotente).
3. `reject(id)` → `rejected`; `commit` posterior → `false`.
4. `commit`/`reject` sobre id inexistente → `false`.
5. `listPending(principalId)` devuelve solo `pending` de ese principal.

Gating (`registry.test`):
6. `proposeFact`/`commitFact` presentes en perfil owner; **ausentes** en web y telegram-visitor (capa canal).
7. Con un principal no-trusted que (forzado) tuviera la tool, `deniedTool` la bloquea (capa principal).

Retrieval (`neon-memory` o test de la query con fake):
8. `searchMemory` mergea `documents` + facts `confirmed` vigentes; **ignora** `pending`/`rejected`/`invalidAt!=null`.

Acciones (con fake `FactStore`):
9. `proposeFact.execute` llama `factStore.propose` con principal/origen correctos y devuelve el id en el texto.
10. `commitFact.execute` con `confirm`/`reject` llama `commit`/`reject`; id inexistente → texto de "no encontré".

Prompt:
11. `buildSystemPrompt` con `pendingFacts` agrega el bloque con los ids; sin pendientes, no lo agrega.

## Verificación (antes de "listo")

- `pnpm -r typecheck` + `pnpm exec biome check .` + `pnpm -r test` limpios + `pnpm -r build`.
- `db:push` a un **branch de Neon** (dev) o `db:generate`+`db:migrate`; verificar la tabla `facts` y el índice parcial.
- e2e real (Telegram owner o `/chat` simulando owner): "che, anotá que no me gusta el fútbol" → `proposeFact` →
  Vaio pide confirmación → "sí" → `commitFact` → luego "¿a Kevin le gusta el fútbol?" → `searchMemory` trae el
  fact. Verificar en trazas `proposeFact`/`commitFact` (`ok:true`) y que un visitante **no** ve las tools.
- Fallback intacto (no tocamos la cadena de modelos).

## Camino de upgrade (futuro — registrado, NO se implementa)

- **Nivel C:** un `Notifier` (puerto; adapter Telegram ya tiene `sendMessage`+`ownerId`) + un scheduler/cron en
  Railway que lea `listPending` y haga **turnos proactivos** (Vaio escribe primero para cerrar dudas). La
  persistencia de esta iteración es su cimiento exacto.
- **`escalate`** (Fase 2) + cola `unknown_questions`: misma maquinaria de propuesta persistida, distinto disparador.
- **Adjudicación/dedup:** al confirmar un fact que contradice uno vigente, invalidar el viejo (`invalidAt=now`) —
  el esquema bi-temporal ya lo soporta; la lógica de detección de conflicto es futura.
- **`feedback_type`** (confirmed/corrected/rejected) del panel de conversaciones, pesando el ranking.
