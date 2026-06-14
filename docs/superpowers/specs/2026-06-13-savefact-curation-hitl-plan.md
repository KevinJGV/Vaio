# saveFact (curación) + HITL persistido + facts bi-temporal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La 1ª write-action del agente: charlando con el owner, Vaio propone guardar un hecho nuevo
(`proposeFact`), lo confirmás, y se escribe en una tabla `facts` bi-temporal que `searchMemory` recupera —
con la propuesta **persistida** (sobrevive al corte de la charla, Nivel B).

**Architecture:** Tabla `facts` (status + bi-temporal) + puerto `FactStore`/adapter Neon (propose/commit/reject/
listPending, encapsula el Embedder). `searchMemory` mergea `documents`+`facts` confirmados vía `unionAll`. Dos
acciones `proposeFact`/`commitFact` sobre el harness (owner-only, gating 2 capas). `agent.ts` carga pendientes y
los inyecta al system prompt para retomarlos. Todo en `core/` (ports/adapters-lite); `index.ts` cablea.

**Tech Stack:** TypeScript estricto · Drizzle ORM + pgvector (Neon) · AI SDK v6 (`tool`) · zod · Vitest · pnpm.

> **Reqs técnicos completos (DDL, firmas, edge-cases):** ver el design
> [`2026-06-13-savefact-curation-hitl-design.md`](2026-06-13-savefact-curation-hitl-design.md). Este plan NO los
> repite; secuencia tareas verificables.

---

## Estrategia de ejecución (obligatoria)

**Recomendación: subagent-driven (un subagente fresco por tarea, EN SECUENCIA, con review entre tareas).** No
paralelo.

Razón (tamaño + acoplamiento): es una feature **mediana-grande** (8 tareas, varios archivos nuevos: schema,
puerto, adapter, 2 acciones, wiring) pero **secuencialmente acoplada** — cada tarea depende de tipos que define la
anterior (`facts` schema → `FactStore` → adapter → acciones → `agent.ts`). No hay subtareas independientes para
fan-out **paralelo** (paralelizar sobre el schema/`ActionContext`/suite compartida = pisadas sin ganancia de
wall-clock). Pero el tamaño **sí** justifica **contexto fresco por tarea + checkpoints de review** → el modo
subagent-driven (secuencial, no paralelo) rinde acá: mantiene cada tarea en un contexto limpio y revisable.
**Punto de vista:** es el escalón siguiente al harness (que fue chico → inline); acá el volumen pide la
disciplina de review por tarea. Si preferís inline (executing-plans, batch con checkpoints) también es válido por
el fuerte acoplamiento — la diferencia es contexto fresco vs continuo, no paralelismo (no lo hay).

---

## File Structure

- **Modify** `apps/agent/src/adapters/db/schema.ts` — tabla `facts` + import `sql`.
- **Create** `apps/agent/migrations/0004_*.sql` — generada por `drizzle-kit` (ajustar índice parcial si hace falta).
- **Create** `apps/agent/src/ports/facts.ts` — `FactStore`, `PendingFact`.
- **Create** `apps/agent/src/adapters/neon-facts.ts` — `createFactStore(db, embedder)`.
- **Modify** `apps/agent/src/adapters/neon-memory.ts:15-32` — `searchMemory` con `unionAll` (documents+facts).
- **Create** `apps/agent/src/core/actions/propose-fact.ts`, `commit-fact.ts` — los dos `ActionDescriptor`.
- **Modify** `apps/agent/src/core/actions/types.ts` — `ActionContext.factStore?`.
- **Modify** `apps/agent/src/core/actions/registry.ts:11` — `ACTIONS` suma las dos acciones.
- **Modify** `apps/agent/src/core/capabilities.ts:9,72-93` — `ToolName` +2; perfil owner las habilita.
- **Modify** `apps/agent/src/core/prompt.ts:68-91` — `buildSystemPrompt` acepta `pendingFacts?`.
- **Modify** `apps/agent/src/core/agent.ts` — `AgentDeps.factStore?`; cargar pendientes; pasar a prompt + ActionContext.
- **Modify** `apps/agent/src/index.ts:78-101,135-139` — crear `factStore`, pasarlo a `createAgent`, boot log.
- **Create** tests: `apps/agent/test/neon-facts.test.ts` (fake), `facts-actions.test.ts`; extender
  `actions-registry.test.ts`, `prompt.test.ts`.

---

### Task 1: Schema `facts` + migración

**Files:**
- Modify: `apps/agent/src/adapters/db/schema.ts`
- Create: `apps/agent/migrations/0004_*.sql` (generada)

- [ ] **Step 1: Agregar el import `sql` y la tabla `facts`**

En `schema.ts`, agregar `sql` al import de `drizzle-orm` (hoy no se importa). Y al final del archivo:

```ts
import { sql } from "drizzle-orm"
// ...
/** Hechos curados sobre Kevin (memoria que se nutre). Una propuesta y un hecho confirmado son la MISMA
 *  fila en distinto `status`. Bi-temporal: valid_at/invalid_at = valid time; created_at/expired_at = tx time.
 *  Invalidar = marcar invalid_at (NUNCA borrar). searchMemory lee solo status='confirmed' AND invalid_at IS NULL. */
export const facts = pgTable(
  "facts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    statement: text("statement").notNull(),
    status: text("status").notNull().default("pending"), // 'pending'|'confirmed'|'rejected'
    embedding: vector("embedding", { dimensions: EMBEDDING_DIM }), // nullable: se llena al confirmar
    principalId: text("principal_id").notNull(),
    channel: text("channel").notNull(),
    conversationId: uuid("conversation_id"),
    turnId: text("turn_id"),
    validAt: timestamp("valid_at", { withTimezone: true }),
    invalidAt: timestamp("invalid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    index("facts_embedding_idx")
      .using("hnsw", t.embedding.op("vector_cosine_ops"))
      .where(sql`${t.status} = 'confirmed' and ${t.invalidAt} is null`),
    index("facts_pending_idx").on(t.principalId, t.status),
  ]
)
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @vaio/agent typecheck`
Expected: PASS.

- [ ] **Step 3: Generar la migración (offline, sin DB)**

Run: `pnpm --filter @vaio/agent db:generate`
Expected: crea `apps/agent/migrations/0004_*.sql` con `CREATE TABLE "facts"` + los dos índices.

- [ ] **Step 4: Verificar el SQL del índice parcial**

Abrir el `.sql` generado. Confirmar que `facts_embedding_idx` incluye `WHERE "status" = 'confirmed' and "invalid_at" is null`.
Si `drizzle-kit` omitió el `WHERE` (índice parcial), editar el `.sql` a mano para agregarlo:
`CREATE INDEX "facts_embedding_idx" ON "facts" USING hnsw ("embedding" vector_cosine_ops) WHERE "status" = 'confirmed' AND "invalid_at" IS NULL;`

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/adapters/db/schema.ts apps/agent/migrations/
git commit -m "feat(db): tabla facts bi-temporal (status + valid/invalid + tx time) + migración 0004"
```

---

### Task 2: Puerto `FactStore` + fake in-memory

**Files:**
- Create: `apps/agent/src/ports/facts.ts`
- Create: `apps/agent/test/fakes/in-memory-facts.ts`

- [ ] **Step 1: Crear el puerto `apps/agent/src/ports/facts.ts`**

```ts
// Puerto de la memoria de HECHOS curados (write + listado de pendientes). El core depende de esta
// interfaz; el adapter Neon (adapters/neon-facts) embebe e implementa contra pgvector.

/** Una propuesta de hecho pendiente de confirmación (para retomarla en el prompt). */
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
   *  false si el id no existe o no está pending (idempotente). */
  commit(id: string): Promise<boolean>
  /** Rechaza una propuesta pendiente. false si no existe/no pending. */
  reject(id: string): Promise<boolean>
  /** Propuestas pendientes de un principal (más recientes primero). */
  listPending(principalId: string, limit?: number): Promise<PendingFact[]>
}
```

- [ ] **Step 2: Crear el fake in-memory `apps/agent/test/fakes/in-memory-facts.ts`**

```ts
import type { FactStore, PendingFact } from "../../src/ports/facts.js"

interface Row {
  id: string
  statement: string
  status: "pending" | "confirmed" | "rejected"
  principalId: string
  createdAt: Date | null
}

/** Fake determinístico: ids "f1","f2",… (sin Date.now/random → estable en tests). */
export function inMemoryFacts(): FactStore & { rows: () => Row[] } {
  const rows: Row[] = []
  let n = 0
  return {
    rows: () => rows,
    async propose(input) {
      const id = `f${++n}`
      rows.push({ id, statement: input.statement, status: "pending", principalId: input.principalId, createdAt: null })
      return { id }
    },
    async commit(id) {
      const r = rows.find((x) => x.id === id && x.status === "pending")
      if (!r) return false
      r.status = "confirmed"
      return true
    },
    async reject(id) {
      const r = rows.find((x) => x.id === id && x.status === "pending")
      if (!r) return false
      r.status = "rejected"
      return true
    },
    async listPending(principalId, limit = 10): Promise<PendingFact[]> {
      return rows
        .filter((x) => x.status === "pending" && x.principalId === principalId)
        .slice(0, limit)
        .map((x) => ({ id: x.id, statement: x.statement, createdAt: x.createdAt }))
    },
  }
}
```

- [ ] **Step 3: Test del fake (sanidad del contrato)** — `apps/agent/test/neon-facts.test.ts`

```ts
import { describe, expect, it } from "vitest"
import { inMemoryFacts } from "./fakes/in-memory-facts.js"

describe("FactStore (contrato, vía fake)", () => {
  it("propose crea pending y devuelve id; listPending lo trae", async () => {
    const fs = inMemoryFacts()
    const { id } = await fs.propose({ statement: "A Kevin no le gusta el fútbol", principalId: "k", channel: "telegram" })
    const pend = await fs.listPending("k")
    expect(pend).toHaveLength(1)
    expect(pend[0]?.id).toBe(id)
  })

  it("commit confirma y es idempotente (2º commit → false)", async () => {
    const fs = inMemoryFacts()
    const { id } = await fs.propose({ statement: "X", principalId: "k", channel: "telegram" })
    expect(await fs.commit(id)).toBe(true)
    expect(await fs.commit(id)).toBe(false)
    expect(await fs.listPending("k")).toHaveLength(0)
  })

  it("reject descarta; commit posterior → false; commit a id inexistente → false", async () => {
    const fs = inMemoryFacts()
    const { id } = await fs.propose({ statement: "X", principalId: "k", channel: "telegram" })
    expect(await fs.reject(id)).toBe(true)
    expect(await fs.commit(id)).toBe(false)
    expect(await fs.commit("nope")).toBe(false)
  })

  it("listPending filtra por principal", async () => {
    const fs = inMemoryFacts()
    await fs.propose({ statement: "X", principalId: "k", channel: "telegram" })
    await fs.propose({ statement: "Y", principalId: "otro", channel: "telegram" })
    expect(await fs.listPending("k")).toHaveLength(1)
  })
})
```

- [ ] **Step 4: Correr**

Run: `pnpm --filter @vaio/agent test neon-facts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/ports/facts.ts apps/agent/test/fakes/in-memory-facts.ts apps/agent/test/neon-facts.test.ts
git commit -m "feat(facts): puerto FactStore + fake in-memory + tests de contrato"
```

---

### Task 3: Adapter `neon-facts` (Drizzle)

**Files:**
- Create: `apps/agent/src/adapters/neon-facts.ts`

- [ ] **Step 1: Implementar `createFactStore`**

```ts
// Adapter de la memoria de hechos: implementa FactStore con Drizzle sobre Neon. Embebe el statement al
// confirmar (no al proponer → no se gasta embedding en rechazos). Invalidar = marcar, nunca borrar.

import { and, desc, eq, isNull, sql } from "drizzle-orm"
import type { Embedder } from "../ports/memory.js"
import type { FactStore, PendingFact } from "../ports/facts.js"
import type { Database } from "./db/client.js"
import { facts } from "./db/schema.js"

export function createFactStore(db: Database, embedder: Embedder): FactStore {
  return {
    async propose(input) {
      const [row] = await db
        .insert(facts)
        .values({
          statement: input.statement,
          status: "pending",
          principalId: input.principalId,
          channel: input.channel,
          conversationId: input.conversationId,
          turnId: input.turnId,
        })
        .returning({ id: facts.id })
      if (!row) throw new Error("facts insert no devolvió id")
      return { id: row.id }
    },

    async commit(id) {
      const [existing] = await db
        .select({ statement: facts.statement })
        .from(facts)
        .where(and(eq(facts.id, id), eq(facts.status, "pending")))
        .limit(1)
      if (!existing) return false
      const [emb] = await embedder.embed([existing.statement])
      if (!emb) return false
      const res = await db
        .update(facts)
        .set({ status: "confirmed", embedding: emb, validAt: sql`now()`, decidedAt: sql`now()` })
        .where(and(eq(facts.id, id), eq(facts.status, "pending")))
        .returning({ id: facts.id })
      return res.length > 0
    },

    async reject(id) {
      const res = await db
        .update(facts)
        .set({ status: "rejected", decidedAt: sql`now()` })
        .where(and(eq(facts.id, id), eq(facts.status, "pending")))
        .returning({ id: facts.id })
      return res.length > 0
    },

    async listPending(principalId, limit = 10): Promise<PendingFact[]> {
      const rows = await db
        .select({ id: facts.id, statement: facts.statement, createdAt: facts.createdAt })
        .from(facts)
        .where(and(eq(facts.principalId, principalId), eq(facts.status, "pending"), isNull(facts.invalidAt)))
        .orderBy(desc(facts.createdAt))
        .limit(limit)
      return rows.map((r) => ({ id: r.id, statement: r.statement, createdAt: r.createdAt }))
    },
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @vaio/agent typecheck`
Expected: PASS. (El adapter no tiene test unitario propio — la lógica está cubierta por el contrato del fake en
Task 2; se valida e2e contra Neon en Task 8. Esto sigue el patrón del repo: `neon-memory`/`neon-conversation` se
prueban e2e, no con DB mockeada.)

- [ ] **Step 3: Commit**

```bash
git add apps/agent/src/adapters/neon-facts.ts
git commit -m "feat(facts): adapter neon-facts (propose/commit/reject/listPending) con Drizzle"
```

---

### Task 4: `searchMemory` unionAll (documents + facts confirmados)

**Files:**
- Modify: `apps/agent/src/adapters/neon-memory.ts:15-32`

- [ ] **Step 1: Reescribir `searchMemory` para mergear ambas tablas**

Reemplazar el cuerpo de `searchMemory` (líneas ~15-32) por:

```ts
    async searchMemory(query: string, k = 6): Promise<DocChunk[]> {
      const [qEmb] = await embedder.embed([query])
      if (!qEmb) return []
      const docs = db
        .select({
          source: documents.source,
          url: documents.url,
          chunk: documents.chunk,
          dist: cosineDistance(documents.embedding, qEmb).as("dist"),
        })
        .from(documents)
      const facs = db
        .select({
          source: sql<string>`'fact'`.as("source"),
          url: sql<string | null>`null`.as("url"),
          chunk: facts.statement,
          dist: cosineDistance(facts.embedding, qEmb).as("dist"),
        })
        .from(facts)
        .where(and(eq(facts.status, "confirmed"), isNull(facts.invalidAt)))
      const merged = docs.unionAll(facs).as("m")
      const rows = await db
        .select({ source: merged.source, url: merged.url, chunk: merged.chunk })
        .from(merged)
        .orderBy(asc(merged.dist))
        .limit(k)
      return rows.map((r) => ({ source: r.source, url: r.url ?? "", chunk: r.chunk }))
    },
```

Actualizar el import de `drizzle-orm`: `import { and, asc, cosineDistance, eq, isNull, sql } from "drizzle-orm"`
y agregar `import { documents, facts } from "./db/schema.js"`.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @vaio/agent typecheck`
Expected: PASS. Si Drizzle se queja del tipo de `merged.dist` en `orderBy`, usar `orderBy(asc(sql`dist`))`.

- [ ] **Step 3: Test del merge (con fake `Embedder` + DB)** — `apps/agent/test/neon-facts.test.ts` (append)

Este test requiere una DB real (Neon branch) → marcarlo `it.skip` por defecto y documentarlo como e2e (igual que
no hay tests de DB para `neon-memory`). La verificación funcional del merge va en Task 8 (e2e). Agregar SOLO un
comentario en el archivo de test indicando que el merge se valida e2e:

```ts
// NOTA: el merge documents+facts de searchMemory se valida e2e (Task 8 del plan), no con DB mockeada,
// siguiendo el patrón del repo (neon-memory no tiene test unitario de query).
```

- [ ] **Step 4: Commit**

```bash
git add apps/agent/src/adapters/neon-memory.ts apps/agent/test/neon-facts.test.ts
git commit -m "feat(memory): searchMemory mergea documents + facts confirmados (unionAll)"
```

---

### Task 5: Acciones `proposeFact` + `commitFact` + gating

**Files:**
- Modify: `apps/agent/src/core/actions/types.ts` (ActionContext.factStore)
- Modify: `apps/agent/src/core/capabilities.ts` (ToolName +2; perfil owner)
- Create: `apps/agent/src/core/actions/propose-fact.ts`, `commit-fact.ts`
- Modify: `apps/agent/src/core/actions/registry.ts` (ACTIONS)
- Test: `apps/agent/test/facts-actions.test.ts`; extender `apps/agent/test/actions-registry.test.ts`

- [ ] **Step 1: Extender `ToolName` y los perfiles (capabilities.ts)**

`capabilities.ts:9`:
```ts
export type ToolName = "searchMemory" | "proposeFact" | "commitFact"
```
En `createCapabilityResolver`, el perfil **telegram-owner** (el bloque `if (channel === "telegram") { if (principal.trusted) return {...} }`) cambia `allowedTools`:
```ts
allowedTools: ["searchMemory", "proposeFact", "commitFact"],
```
Web y `untrustedTelegram()` quedan **igual** (solo `["searchMemory"]`).

- [ ] **Step 2: Agregar `factStore` al `ActionContext` (types.ts)**

```ts
import type { FactStore } from "../../ports/facts.js"
// dentro de ActionContext:
  /** Memoria de hechos curados (write-actions). null = sin DB → las acciones degradan. */
  factStore?: FactStore | null
```

- [ ] **Step 3: Crear `core/actions/propose-fact.ts`**

```ts
import { tool } from "ai"
import { z } from "zod"
import type { ActionContext, ActionDescriptor } from "./types.js"

export const proposeFact: ActionDescriptor = {
  name: "proposeFact",
  sideEffecting: true,
  clearance: "owner",
  build(ctx: ActionContext) {
    return tool({
      description:
        "Propone guardar un HECHO nuevo y durable sobre Kevin (preferencia, dato de vida, cambio de stack…) " +
        "que surgió en la charla. NO lo guarda: registra la propuesta y debés pedirle confirmación al usuario " +
        "antes de commitear. Solo datos que valga la pena recordar; no para charla pasajera.",
      inputSchema: z.object({
        statement: z
          .string()
          .min(1)
          .describe("El hecho, en una frase clara y autocontenida (3ª persona sobre Kevin)."),
      }),
      execute: async ({ statement }, { toolCallId }) => {
        const t0 = Date.now()
        if (!ctx.factStore) {
          const output = "No puedo guardar hechos ahora mismo (memoria no configurada)."
          ctx.emit({ ...ctx.ids, type: "tool.result", toolCallId, toolName: "proposeFact", ok: false, latencyMs: Date.now() - t0, output })
          return output
        }
        try {
          const { id } = await ctx.factStore.propose({
            statement,
            principalId: ctx.principal.id,
            channel: ctx.principal.channel,
            conversationId: ctx.ids.conversationId,
            turnId: ctx.ids.turnId,
          })
          const output = `Propuesta registrada (id ${id}). Pedile confirmación al usuario; si dice que sí, llamá commitFact con ese id.`
          ctx.emit({ ...ctx.ids, type: "tool.result", toolCallId, toolName: "proposeFact", ok: true, latencyMs: Date.now() - t0, output })
          return output
        } catch {
          const output = "No pude registrar la propuesta ahora mismo."
          ctx.emit({ ...ctx.ids, type: "tool.result", toolCallId, toolName: "proposeFact", ok: false, latencyMs: Date.now() - t0, output })
          return output
        }
      },
    })
  },
}
```

- [ ] **Step 4: Crear `core/actions/commit-fact.ts`**

```ts
import { tool } from "ai"
import { z } from "zod"
import type { ActionContext, ActionDescriptor } from "./types.js"

export const commitFact: ActionDescriptor = {
  name: "commitFact",
  sideEffecting: true,
  clearance: "owner",
  build(ctx: ActionContext) {
    return tool({
      description:
        "Confirma (guarda) o rechaza una propuesta de hecho YA registrada con proposeFact. Llamala SOLO " +
        "después de que el usuario confirme/rechace explícitamente. Requiere el id de la propuesta.",
      inputSchema: z.object({
        id: z.string().min(1).describe("El id que devolvió proposeFact."),
        decision: z.enum(["confirm", "reject"]).describe("confirm = guardar; reject = descartar."),
      }),
      execute: async ({ id, decision }, { toolCallId }) => {
        const t0 = Date.now()
        if (!ctx.factStore) {
          const output = "No puedo guardar hechos ahora mismo (memoria no configurada)."
          ctx.emit({ ...ctx.ids, type: "tool.result", toolCallId, toolName: "commitFact", ok: false, latencyMs: Date.now() - t0, output })
          return output
        }
        try {
          const ok = decision === "confirm" ? await ctx.factStore.commit(id) : await ctx.factStore.reject(id)
          const output = ok
            ? decision === "confirm"
              ? "Listo, lo guardé en mi memoria."
              : "Ok, lo descarté."
            : "No encontré esa propuesta pendiente (quizá ya se resolvió)."
          ctx.emit({ ...ctx.ids, type: "tool.result", toolCallId, toolName: "commitFact", ok, latencyMs: Date.now() - t0, output })
          return output
        } catch {
          const output = "No pude resolver la propuesta ahora mismo."
          ctx.emit({ ...ctx.ids, type: "tool.result", toolCallId, toolName: "commitFact", ok: false, latencyMs: Date.now() - t0, output })
          return output
        }
      },
    })
  },
}
```

- [ ] **Step 5: Registrar en `registry.ts`**

```ts
import { commitFact } from "./commit-fact.js"
import { proposeFact } from "./propose-fact.js"
import { searchMemory } from "./search-memory.js"
export const ACTIONS: ActionDescriptor[] = [searchMemory, proposeFact, commitFact]
```

- [ ] **Step 6: Tests de gating (extender `actions-registry.test.ts`)**

Agregar al `describe` de gating. El helper `ctx` del archivo arma `caps` con `allowedTools` arbitrario; agregar:

```ts
it("proposeFact/commitFact visibles solo si el perfil (owner) las habilita", () => {
  const owner = buildTools(ctx(["searchMemory", "proposeFact", "commitFact"], true))
  expect(owner.proposeFact).toBeDefined()
  expect(owner.commitFact).toBeDefined()
  const web = buildTools(ctx(["searchMemory"], false))
  expect(web.proposeFact).toBeUndefined()
  expect(web.commitFact).toBeUndefined()
})
```

> NOTA: las acciones reales necesitan `factStore` en `ctx` para construirse sin romper; el helper `ctx` del test
> hoy no lo setea, pero `build` no llama a `factStore` (solo lo captura en el closure) → construir es seguro con
> `factStore` undefined. Si el helper necesita ajustarse, agregar `factStore: inMemoryFacts()` al objeto base.

- [ ] **Step 7: Tests de las acciones (`facts-actions.test.ts`)**

```ts
import type { TraceEvent } from "@vaio/contracts"
import { describe, expect, it } from "vitest"
import { commitFact } from "../src/core/actions/commit-fact.js"
import { proposeFact } from "../src/core/actions/propose-fact.js"
import type { ActionContext } from "../src/core/actions/types.js"
import type { Principal } from "../src/core/capabilities.js"
import type { LogFields, Logger } from "../src/ports/logger.js"
import { inMemoryFacts } from "./fakes/in-memory-facts.js"

function noopLogger(): Logger {
  const noop = (_a: LogFields | string, _b?: string): void => {}
  const l: Logger = { trace: noop, debug: noop, info: noop, warn: noop, error: noop, child: () => l }
  return l
}
const principal: Principal = { channel: "telegram", id: "k", trusted: true }
function ctx(factStore: ActionContext["factStore"], emit: (e: TraceEvent) => void = () => {}): ActionContext {
  return {
    caps: { channel: "telegram", allowedTools: ["proposeFact", "commitFact"], memoryScope: { maxK: 8 }, policyText: "" },
    principal, memory: null, factStore, emit, ids: { requestId: "r", turnId: "t", conversationId: "c" }, logger: noopLogger(),
  }
}

describe("proposeFact / commitFact", () => {
  it("proposeFact registra la propuesta y devuelve el id en el texto", async () => {
    const fs = inMemoryFacts()
    const out = await proposeFact.build(ctx(fs)).execute?.({ statement: "A Kevin no le gusta el fútbol" }, { toolCallId: "tc", messages: [] })
    expect(String(out)).toMatch(/id f1/)
    expect(await fs.listPending("k")).toHaveLength(1)
  })

  it("commitFact confirm guarda; un visitante no llega acá (gating), pero id inexistente → 'no encontré'", async () => {
    const fs = inMemoryFacts()
    await proposeFact.build(ctx(fs)).execute?.({ statement: "X" }, { toolCallId: "t1", messages: [] })
    const okOut = await commitFact.build(ctx(fs)).execute?.({ id: "f1", decision: "confirm" }, { toolCallId: "t2", messages: [] })
    expect(String(okOut)).toMatch(/guard/i)
    expect(await fs.listPending("k")).toHaveLength(0)
    const missOut = await commitFact.build(ctx(fs)).execute?.({ id: "nope", decision: "confirm" }, { toolCallId: "t3", messages: [] })
    expect(String(missOut)).toMatch(/no encontré/i)
  })

  it("degradan a cortesía si no hay factStore", async () => {
    const out = await proposeFact.build(ctx(null)).execute?.({ statement: "X" }, { toolCallId: "tc", messages: [] })
    expect(String(out)).toMatch(/no configurada/i)
  })
})
```

- [ ] **Step 8: Correr + commit**

Run: `pnpm --filter @vaio/agent test facts-actions actions-registry`
Expected: PASS.
```bash
git add apps/agent/src/core/actions/ apps/agent/src/core/capabilities.ts apps/agent/test/facts-actions.test.ts apps/agent/test/actions-registry.test.ts
git commit -m "feat(actions): proposeFact + commitFact (owner-only) + gating + tests"
```

---

### Task 6: Retomar pendientes (prompt + agent)

**Files:**
- Modify: `apps/agent/src/core/prompt.ts:68-91`
- Modify: `apps/agent/src/core/agent.ts`
- Test: extender `apps/agent/test/prompt.test.ts`

- [ ] **Step 1: `buildSystemPrompt` acepta `pendingFacts?` (prompt.ts)**

Agregar el import y el parámetro:
```ts
import type { PendingFact } from "../ports/facts.js"
// en la firma de buildSystemPrompt(args: { ... }):
  pendingFacts?: PendingFact[]
```
Y antes del `return`, construir el bloque y sumarlo al array (después de `summaryBlock`):
```ts
  const pend = args.pendingFacts ?? []
  const pendingBlock =
    pend.length > 0
      ? (args.locale === "en"
          ? "Memory proposals awaiting your confirmation:\n"
          : "Propuestas de memoria pendientes de tu confirmación:\n") +
        pend.map((p) => `- [${p.id}] «${p.statement}»`).join("\n") +
        (args.locale === "en"
          ? "\nIf the user confirms one, call commitFact with its id; if they reject it, commitFact with decision:reject."
          : "\nSi el usuario confirma una, llamá commitFact con su id; si la rechaza, commitFact con decision:reject.")
      : ""
  // …, summaryBlock, pendingBlock ].filter(Boolean).join("\n\n")
```

- [ ] **Step 2: Test del bloque (prompt.test.ts)**

```ts
it("inyecta el bloque de propuestas pendientes con sus ids", () => {
  const p = buildSystemPrompt({ locale: "es", audience: "owner", policyText: "", summary: "",
    pendingFacts: [{ id: "f1", statement: "A Kevin no le gusta el fútbol", createdAt: null }] })
  expect(p).toContain("pendientes de tu confirmación")
  expect(p).toContain("[f1]")
  expect(p).toContain("commitFact")
})
it("sin pendientes, no agrega el bloque", () => {
  const p = buildSystemPrompt({ locale: "es", audience: "owner", policyText: "", summary: "" })
  expect(p).not.toContain("pendientes de tu confirmación")
})
```

Run: `pnpm --filter @vaio/agent test prompt` → PASS.

- [ ] **Step 3: `AgentDeps.factStore` + cargar pendientes (agent.ts)**

En `AgentDeps`: `factStore?: import("../ports/facts.js").FactStore | null` (o import nombrado arriba).
En `createAgent` destructuring: `factStore = null,`.
Dentro de `respond`, tras resolver `caps` (~`:151`) y antes de armar el prompt:
```ts
      // Retomar propuestas de hechos pendientes (solo si el perfil puede commitear → owner).
      let pendingFacts: import("../ports/facts.js").PendingFact[] = []
      if (factStore && caps.allowedTools.includes("commitFact")) {
        pendingFacts = await factStore.listPending(principal.id)
      }
```
Pasar `pendingFacts` a `buildSystemPrompt({ ..., pendingFacts })` (línea ~236) y `factStore` al objeto de
`buildTools` (línea ~244):
```ts
        tools: buildTools({ caps, principal, memory, factStore, emit, ids, logger: ctx.logger, compressor, ragIntensity }),
```

- [ ] **Step 4: Typecheck + tests del agente**

Run: `pnpm --filter @vaio/agent typecheck && pnpm --filter @vaio/agent test agent-loop prompt`
Expected: PASS. (El `agent-loop` test no pasa `factStore` → `pendingFacts=[]`, comportamiento intacto.)

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/core/prompt.ts apps/agent/src/core/agent.ts apps/agent/test/prompt.test.ts
git commit -m "feat(agent): retomar propuestas pendientes en el prompt + factStore en ActionContext"
```

---

### Task 7: Wiring (`index.ts`)

**Files:**
- Modify: `apps/agent/src/index.ts:78-101,135-139`

- [ ] **Step 1: Crear `factStore` junto a `memory`**

Tras `import { createMemoryStore }`, agregar `import { createFactStore } from "./adapters/neon-facts.js"` y
`import type { FactStore } from "./ports/facts.js"`. Declarar `let factStore: FactStore | null = null` junto a
`let memory`. Dentro del `if (embeddingsKey)`, tras `memory = createMemoryStore(db, embedder)`:
```ts
      factStore = createFactStore(db, embedder)
```

- [ ] **Step 2: Pasar `factStore` a `createAgent`**

En el objeto de `createAgent({ model, memory, conversations, summarizer, ... })` agregar `factStore,`.

- [ ] **Step 3: Boot log de capacidades**

Donde se loguea el estado on/off (buscar `ragEnabled`/el objeto de boot), agregar `facts: factStore != null`.

- [ ] **Step 4: Typecheck + build + boot smoke**

Run: `pnpm --filter @vaio/agent typecheck && pnpm -r build`
Expected: PASS. Boot local (sin DB) debe arrancar y loguear `facts: false` sin romper.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/index.ts
git commit -m "feat(wiring): cablear FactStore (facts on/off en el boot log)"
```

---

### Task 8: Verificación end-to-end + docs

**Files:** docs.

- [ ] **Step 1: Suite + lint + build + migración aplicada**

Run: `pnpm -r typecheck && pnpm exec biome check . && pnpm -r test && pnpm -r build`
Expected: todo PASS.
Aplicar el schema a un **branch de Neon (dev)**: `pnpm --filter @vaio/agent db:push` (o `db:migrate`). Verificar
que existe la tabla `facts` y el índice parcial `facts_embedding_idx`.

- [ ] **Step 2: e2e del flujo completo (owner)**

Con server local + keys + `OWNER_TELEGRAM_ID` (o simulando owner por `/chat` con `trusted`):
1. "anotá que a Kevin no le gusta el fútbol" → la traza muestra `proposeFact` (`ok:true`) → Vaio pide confirmación.
2. "sí, dale" → `commitFact` (`ok:true`) → "lo guardé".
3. "¿a Kevin le gusta el fútbol?" → `searchMemory` trae el fact → respuesta grounded en el hecho nuevo.
4. Reiniciar/cortar entre 1 y 2 → al volver a escribir, el bloque de pendientes reaparece (Nivel B).
5. Un **visitante** (no owner) → `proposeFact`/`commitFact` **no** están en sus tools (verificar en la traza que no se exponen).

- [ ] **Step 3: Fallback intacto** (no tocamos la cadena de modelos) — una respuesta degradada sigue saliendo.

- [ ] **Step 4: Reconciliar docs**

- `NEXT-STEPS.md`: abrir/cerrar el WIP del feature; al verificarlo Kevin → Historial. Marcar `saveFact`/HITL
  persistido como hecho; el **Nivel C** (proactivo) y `escalate` quedan como próximos.
- `SPEC.md`: la tabla `facts` ahora EXISTE (Fase 2 arrancó) — anotar el avance sin cambiar el norte; ¿dispara
  OpenSpec? (evaluar el gatillo: facts activo + ¿apps/web? → todavía no).
- `LEARNINGS.md`: registrar (a) bi-temporal con motor mínimo, (b) HITL estructural vía 2 tools (commit exige
  pending id), (c) merge `unionAll` documents+facts en searchMemory.

- [ ] **Step 5: Commit de reconciliación**

```bash
git add docs/
git commit -m "docs: reconciliar — saveFact (curación) + HITL persistido + facts bi-temporal"
```

---

## Self-Review (hecho)

- **Spec coverage:** tabla facts bi-temporal (T1) · FactStore+fake (T2) · adapter (T3) · retrieval unionAll (T4) ·
  proposeFact/commitFact + gating owner (T5) · retomar pendientes prompt+agent (T6) · wiring (T7) · e2e+docs (T8).
  Camino de upgrade (Nivel C/escalate/adjudicación) documentado en el design, fuera de alcance.
- **Placeholder scan:** sin TBD/TODO; cada step trae código o comando. (Los `/* */` del design se reemplazaron por
  código real en T5.)
- **Type consistency:** `FactStore`/`PendingFact` (T2) usados igual en adapter (T3), acciones (T5), prompt (T6),
  agent/wiring (T6/T7); `ActionContext.factStore?` (T5) coincide con su uso en acciones y el objeto de `buildTools`
  (T6); `facts` schema (T1) coincide con columnas usadas en adapter (T3) y searchMemory (T4); `ToolName` (T5) +2
  coincide con `allowedTools` del perfil owner (T5) y el `commitFact`-check en agent (T6).
