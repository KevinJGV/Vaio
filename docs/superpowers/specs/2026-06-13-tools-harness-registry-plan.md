# Harness de tools (registry + seam HITL delgado) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalizar el sistema de tools de una unión cerrada de una tool read-only a un registry de
`ActionDescriptor`s con gating de 2 capas (canal oculta / principal deniega) y seam HITL delgado, migrando
`searchMemory` sin cambiar su comportamiento.

**Architecture:** Módulo nuevo `core/actions/` (reemplaza `core/tools.ts`): `types.ts` (contratos),
`registry.ts` (array de descriptores + `buildTools` con gating), `search-memory.ts` (migración). El core sigue
dependiendo solo de puertos; `agent.ts` cablea pasando el `principal` (ya computado) en el `ActionContext`.

**Tech Stack:** TypeScript estricto · AI SDK v6 (`tool`, `ToolSet`, `Tool`) · zod · Vitest · pnpm workspaces.

> **Reqs técnicos completos (firmas, DDL, edge-cases):** ver el design
> [`2026-06-13-tools-harness-registry-design.md`](2026-06-13-tools-harness-registry-design.md). Este plan NO los
> repite; secuencia las tareas verificables.

---

## Estrategia de ejecución (obligatoria)

**Recomendación: ejecución DIRECTA (orquestador inline, vos), NO subagentes en paralelo.**

Razón (tamaño + acoplamiento): es una feature **chica y secuencialmente acoplada**. Las 5 tareas comparten un
único contrato (`core/actions/types.ts`) y cada una construye sobre la anterior (contrato → migración → registry
→ wiring → verificación). No hay subtareas independientes que se beneficien del fan-out: paralelizar agentes
sobre estado compartido (`types.ts`, `agent.ts`, el suite de tests) solo agrega coordinación y riesgo de
pisadas, sin ganancia de wall-clock. El default del proyecto para "secuencial/acoplado/chico" es directo (más
barato, "pocos $/mes"). **Punto de vista:** el panel de agentes de diseño ya rindió en la fase de
brainstorming (exploración del código en paralelo); la implementación, en cambio, es lineal y cabe en una sola
cabeza de contexto → directo es lo correcto. Si se elige subagent-driven igual, que sea **un subagente por
tarea en secuencia** (no paralelo), con review entre tareas.

---

## File Structure

- **Create** `apps/agent/src/core/actions/types.ts` — `Clearance`, `ActionContext`, `ActionDescriptor`, `TraceIds`.
- **Create** `apps/agent/src/core/actions/search-memory.ts` — `searchMemory: ActionDescriptor` (lógica migrada).
- **Create** `apps/agent/src/core/actions/registry.ts` — `ACTIONS`, `buildTools`, `deniedTool`, `meetsClearance`.
- **Create** `apps/agent/test/actions-registry.test.ts` — tests de gating + deny path.
- **Modify** `packages/contracts/src/trace.ts:56-67` — campo opcional `denied?` en `tool.result`.
- **Modify** `apps/agent/src/core/agent.ts:41,244-252` — import + `ActionContext` con `principal`.
- **Modify** `apps/agent/test/tools.test.ts` → renombrar a `apps/agent/test/search-memory.test.ts`, actualizar imports + agregar `principal`.
- **Delete** `apps/agent/src/core/tools.ts`.

---

### Task 1: Contrato — `denied?` en `tool.result`

**Files:**
- Modify: `packages/contracts/src/trace.ts:56-67`
- Test: `packages/contracts` no tiene suite propia → se valida con `pnpm -r typecheck` (el schema es zod puro).

- [ ] **Step 1: Agregar el campo opcional al evento `tool.result`**

En `packages/contracts/src/trace.ts`, dentro del objeto `z.literal("tool.result")`, sumar tras `ok`:

```ts
    ok: z.boolean().optional(),
    /** true si la tool se denegó por clearance (seam HITL). ok:false + denied:true = denegación;
     *  ok:false sin denied = fallo de ejecución. */
    denied: z.boolean().optional(),
```

- [ ] **Step 2: Typecheck del paquete**

Run: `pnpm --filter @vaio/contracts typecheck` (o `pnpm -r typecheck`)
Expected: PASS (sin errores).

- [ ] **Step 3: Build de contracts (lo consume el agente)**

Run: `pnpm --filter @vaio/contracts build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/trace.ts
git commit -m "feat(contracts): campo denied? en tool.result (seam HITL)"
```

---

### Task 2: Contratos del harness + migración de `searchMemory`

**Files:**
- Create: `apps/agent/src/core/actions/types.ts`
- Create: `apps/agent/src/core/actions/search-memory.ts`
- Test: `apps/agent/test/search-memory.test.ts` (portado desde `tools.test.ts`)

- [ ] **Step 1: Crear `core/actions/types.ts`**

```ts
import type { TraceEvent } from "@vaio/contracts"
import type { Tool } from "ai"
import type { Compressor, Intensity } from "../../ports/compress.js"
import type { Logger } from "../../ports/logger.js"
import type { MemoryStore } from "../../ports/memory.js"
import type { CapabilityProfile, Principal, ToolName } from "../capabilities.js"

/** Ids base de traza del turno (se esparcen en cada evento emitido por una acción). */
export interface TraceIds {
  requestId: string
  turnId: string
  conversationId?: string
}

/** Quién (principal) puede invocar la acción. Hoy binario, alineado con `Principal.trusted`. */
export type Clearance = "anyone" | "owner"

/** Contexto del turno inyectado a cada acción (= ToolDeps de hoy + `principal`). */
export interface ActionContext {
  caps: CapabilityProfile
  principal: Principal
  memory: MemoryStore | null
  emit: (e: TraceEvent) => void
  ids: TraceIds
  logger: Logger
  compressor?: Compressor | null
  ragIntensity?: Intensity
}

export interface ActionDescriptor {
  name: ToolName
  /** Marca write-actions (efecto fuera de la conversación). Hoy todas false. */
  sideEffecting: boolean
  /** Principal mínimo que puede invocarla. searchMemory = "anyone". */
  clearance: Clearance
  /** Construye la tool() del AI SDK con el contexto del turno (typing por-tool intacto adentro). */
  build(ctx: ActionContext): Tool
}
```

- [ ] **Step 2: Crear `core/actions/search-memory.ts` (lógica IDÉNTICA a `tools.ts:33-127`)**

```ts
import { tool } from "ai"
import { z } from "zod"
import { compressOrRaw, errMsg } from "../util.js"
import type { ActionContext, ActionDescriptor } from "./types.js"

/** searchMemory: RAG sobre la memoria del producto, con `k` acotado por el perfil del canal. */
export const searchMemory: ActionDescriptor = {
  name: "searchMemory",
  sideEffecting: false,
  clearance: "anyone",
  build(ctx: ActionContext) {
    const { memory, emit, ids, logger, compressor = null, ragIntensity = "full" } = ctx
    const k = ctx.caps.memoryScope.maxK
    return tool({
      description:
        "Memoria de Kevin (sus datos reales): bio/origen, stack, proyectos (GitHub), gustos (música), contacto. Úsala cuando la respuesta dependa de un hecho concreto de Kevin; no para saludos ni charla.",
      inputSchema: z.object({
        query: z.string().describe("Consulta de búsqueda semántica, en lenguaje natural."),
      }),
      execute: async ({ query }, { toolCallId }) => {
        const t0 = Date.now()
        if (!memory) {
          const output = "La memoria todavía no está configurada."
          emit({ ...ids, type: "tool.result", toolCallId, toolName: "searchMemory", ok: false, hits: 0, latencyMs: Date.now() - t0, output })
          return output
        }
        try {
          const docs = await memory.searchMemory(query, k)
          const output =
            docs.length === 0
              ? "Sin resultados relevantes en memoria."
              : docs
                  .map((d) => `[${d.source}${d.url ? ` · ${d.url}` : ""}]\n${compressOrRaw(compressor, d.chunk, ragIntensity)}`)
                  .join("\n\n")
          if (compressor && docs.length > 0) {
            const before = docs.reduce((n, d) => n + compressor.countTokens(d.chunk), 0)
            const after = docs.reduce((n, d) => n + compressor.countTokens(compressor.compress(d.chunk, ragIntensity)), 0)
            if (before > 0) {
              logger.debug({ before, after, saved: before - after, chunks: docs.length }, "rag compressed")
            }
          }
          emit({ ...ids, type: "tool.result", toolCallId, toolName: "searchMemory", ok: true, hits: docs.length, latencyMs: Date.now() - t0, output })
          return output
        } catch (err) {
          logger.error({ err: errMsg(err) }, "searchMemory falló")
          emit({ ...ids, type: "tool.result", toolCallId, toolName: "searchMemory", ok: false, hits: 0, latencyMs: Date.now() - t0, output: errMsg(err) })
          return "La memoria no está disponible ahora mismo."
        }
      },
    })
  },
}
```

> NOTA: copiar el cuerpo de `execute` **byte-a-byte** desde `apps/agent/src/core/tools.ts:51-125` para garantizar
> comportamiento idéntico. Lo de arriba es ese mismo cuerpo reformateado.

- [ ] **Step 3: Portar el test → `apps/agent/test/search-memory.test.ts`**

Renombrar `apps/agent/test/tools.test.ts` a `search-memory.test.ts` y adaptarlo al nuevo registry. Reemplazar la
construcción para pasar por `buildTools` con `principal` (lo crea Task 3) — pero como Task 3 aún no existe, este
test prueba el descriptor **directo** vía `searchMemory.build(ctx)`:

```ts
import type { TraceEvent } from "@vaio/contracts"
import { describe, expect, it } from "vitest"
import type { CapabilityProfile, Principal } from "../src/core/capabilities.js"
import { searchMemory } from "../src/core/actions/search-memory.js"
import type { ActionContext, TraceIds } from "../src/core/actions/types.js"
import type { LogFields, Logger } from "../src/ports/logger.js"
import type { DocChunk, MemoryStore } from "../src/ports/memory.js"

function noopLogger(): Logger {
  const noop = (_a: LogFields | string, _b?: string): void => {}
  const logger: Logger = { trace: noop, debug: noop, info: noop, warn: noop, error: noop, child: () => logger }
  return logger
}
const ids: TraceIds = { requestId: "req", turnId: "turn" }
const principal: Principal = { channel: "telegram", id: "1", trusted: true }
function caps(maxK: number): CapabilityProfile {
  return { channel: "telegram", allowedTools: ["searchMemory"], memoryScope: { maxK }, policyText: "" }
}
function ctx(partial: Partial<ActionContext>): ActionContext {
  return { caps: caps(6), principal, memory: null, emit: () => {}, ids, logger: noopLogger(), ...partial }
}

describe("searchMemory (descriptor migrado)", () => {
  it("la descripción ancla categorías y NO sobre-impera ('SIEMPRE')", () => {
    const t = searchMemory.build(ctx({})) as { description?: string }
    expect(t.description ?? "").toContain("proyectos")
    expect(t.description ?? "").toContain("contacto")
    expect(t.description ?? "").not.toContain("SIEMPRE")
  })

  it("usa el maxK del perfil y emite tool.result con los hits", async () => {
    let calledWithK = -1
    const docs: DocChunk[] = [{ source: "cv", url: "u", chunk: "c1" }, { source: "github", url: "", chunk: "c2" }]
    const memory: MemoryStore = {
      searchMemory: async (_q, k) => { calledWithK = k ?? -1; return docs },
      upsertDocuments: async () => {}, clearSource: async () => {},
    }
    const events: TraceEvent[] = []
    const t = searchMemory.build(ctx({ caps: caps(8), memory, emit: (e) => events.push(e) }))
    const out = await t.execute?.({ query: "kevin" }, { toolCallId: "tc1", messages: [] })
    expect(calledWithK).toBe(8)
    expect(String(out)).toContain("c1")
    expect(events.find((e) => e.type === "tool.result")).toMatchObject({ type: "tool.result", ok: true, hits: 2 })
  })

  it("comprime los chunks de RAG si hay compresor", async () => {
    const memory: MemoryStore = {
      searchMemory: async () => [{ source: "cv", url: "", chunk: "chunk-uno" }],
      upsertDocuments: async () => {}, clearSource: async () => {},
    }
    const compressor = { compress: (t: string) => `[C]${t}`, expand: (t: string) => t, countTokens: (t: string) => t.length }
    const t = searchMemory.build(ctx({ memory, compressor }))
    const out = await t.execute?.({ query: "x" }, { toolCallId: "tc", messages: [] })
    expect(String(out)).toContain("[C]chunk-uno")
  })

  it("degrada a cortesía si memory es null", async () => {
    const t = searchMemory.build(ctx({ memory: null }))
    const out = await t.execute?.({ query: "x" }, { toolCallId: "tc", messages: [] })
    expect(String(out)).toContain("memoria")
  })
})
```

- [ ] **Step 4: Correr los tests del descriptor**

Run: `pnpm --filter @vaio/agent test search-memory`
Expected: PASS (4 tests). El test "incluye searchMemory solo si está en allowedTools" se migra a Task 3 (es del registry).

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/core/actions/types.ts apps/agent/src/core/actions/search-memory.ts apps/agent/test/search-memory.test.ts
git rm apps/agent/test/tools.test.ts
git commit -m "feat(actions): contratos del harness + migrar searchMemory a descriptor"
```

---

### Task 3: Registry + gating de 2 capas + deny path (seam HITL)

**Files:**
- Create: `apps/agent/src/core/actions/registry.ts`
- Test: `apps/agent/test/actions-registry.test.ts`

- [ ] **Step 1: Escribir el test del registry (falla primero)**

`apps/agent/test/actions-registry.test.ts`:

```ts
import type { TraceEvent } from "@vaio/contracts"
import { tool } from "ai"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { ACTIONS, buildTools } from "../src/core/actions/registry.js"
import type { ActionContext, ActionDescriptor, TraceIds } from "../src/core/actions/types.js"
import type { CapabilityProfile, Principal } from "../src/core/capabilities.js"
import type { LogFields, Logger } from "../src/ports/logger.js"

function noopLogger(): Logger {
  const noop = (_a: LogFields | string, _b?: string): void => {}
  const logger: Logger = { trace: noop, debug: noop, info: noop, warn: noop, error: noop, child: () => logger }
  return logger
}
const ids: TraceIds = { requestId: "req", turnId: "turn" }
function ctx(allowedTools: CapabilityProfile["allowedTools"], trusted: boolean, emit: (e: TraceEvent) => void = () => {}): ActionContext {
  const principal: Principal = { channel: "telegram", id: "1", trusted }
  return {
    caps: { channel: "telegram", allowedTools, memoryScope: { maxK: 6 }, policyText: "" },
    principal,
    memory: { searchMemory: async () => [], upsertDocuments: async () => {}, clearSource: async () => {} },
    emit, ids, logger: noopLogger(),
  }
}

describe("buildTools — gating de 2 capas", () => {
  it("capa canal: oculta la tool si no está en allowedTools", () => {
    expect(buildTools(ctx([], true)).searchMemory).toBeUndefined()
    expect(buildTools(ctx(["searchMemory"], true)).searchMemory).toBeDefined()
  })

  it("clearance 'anyone' (searchMemory): visible para principal no-trusted", () => {
    expect(buildTools(ctx(["searchMemory"], false)).searchMemory).toBeDefined()
  })
})

describe("seam HITL — clearance 'owner' deniega en runtime", () => {
  // Descriptor owner-only SOLO de test: ejercita el deny path sin enviar una write-action real.
  const ownerOnly: ActionDescriptor = {
    name: "searchMemory", // reusa el nombre para entrar por allowedTools; el test inyecta este descriptor
    sideEffecting: true,
    clearance: "owner",
    build: () => { throw new Error("no debería construirse para un principal no-trusted") },
  }

  it("principal no-trusted: la tool se expone pero su execute deniega (ok:false, denied:true) sin ejecutar", async () => {
    const events: TraceEvent[] = []
    const c = ctx(["searchMemory"], false, (e) => events.push(e))
    const tools = buildTools(c, [ownerOnly]) // segundo arg opcional: registry inyectado para el test
    const out = await tools.searchMemory?.execute?.({}, { toolCallId: "tc", messages: [] })
    expect(String(out)).toMatch(/no puedo/i)
    expect(events.find((e) => e.type === "tool.result")).toMatchObject({ ok: false, denied: true })
  })

  it("principal trusted: clearance 'owner' permite construir la tool real", () => {
    const built: ActionDescriptor = {
      ...ownerOnly,
      build: () => tool({ description: "x", inputSchema: z.object({}), execute: async () => "ok" }),
    }
    const tools = buildTools(ctx(["searchMemory"], true, () => {}), [built])
    expect(tools.searchMemory).toBeDefined()
  })

  it("ACTIONS contiene searchMemory por defecto", () => {
    expect(ACTIONS.some((a) => a.name === "searchMemory")).toBe(true)
  })
})
```

> NOTA: `buildTools` toma un **segundo parámetro opcional** `actions: ActionDescriptor[] = ACTIONS` para poder
> inyectar un registry de prueba (testabilidad del deny path sin write-actions reales). En prod siempre usa `ACTIONS`.

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `pnpm --filter @vaio/agent test actions-registry`
Expected: FAIL ("Cannot find module ./registry.js" o `buildTools is not a function`).

- [ ] **Step 3: Implementar `core/actions/registry.ts`**

```ts
import { type Tool, type ToolSet, tool } from "ai"
import { z } from "zod"
import { searchMemory } from "./search-memory.js"
import type { ActionContext, ActionDescriptor } from "./types.js"

/** Único lugar donde se listan las acciones que el harness sabe construir. */
export const ACTIONS: ActionDescriptor[] = [searchMemory]

/** ¿El principal cumple el clearance de la acción? */
function meetsClearance(clearance: ActionDescriptor["clearance"], principal: ActionContext["principal"]): boolean {
  if (clearance === "anyone") return true
  return principal.trusted // "owner"
}

/** Punto de decisión del seam HITL (delgado): NO ejecuta la acción; emite traza de denegación
 *  y devuelve cortesía. Nunca throw (invariante "siempre responde"). */
function deniedTool(d: ActionDescriptor, ctx: ActionContext): Tool {
  return tool({
    description: "Acción no disponible en este contexto.",
    inputSchema: z.object({}).passthrough(),
    execute: async (_input, { toolCallId }) => {
      const output = "No puedo ejecutar esa acción en este canal o para este interlocutor."
      ctx.emit({ ...ctx.ids, type: "tool.result", toolCallId, toolName: d.name, ok: false, denied: true, output })
      return output
    },
  })
}

/** Arma el ToolSet para streamText con gating de 2 capas:
 *  (1) canal OCULTA  → name ∉ caps.allowedTools ⇒ no se expone.
 *  (2) principal DENIEGA → no cumple clearance ⇒ se expone pero su execute deniega (seam HITL). */
export function buildTools(ctx: ActionContext, actions: ActionDescriptor[] = ACTIONS): ToolSet {
  const tools: ToolSet = {}
  for (const d of actions) {
    if (!ctx.caps.allowedTools.includes(d.name)) continue
    tools[d.name] = meetsClearance(d.clearance, ctx.principal) ? d.build(ctx) : deniedTool(d, ctx)
  }
  return tools
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `pnpm --filter @vaio/agent test actions-registry`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/core/actions/registry.ts apps/agent/test/actions-registry.test.ts
git commit -m "feat(actions): registry con gating de 2 capas + seam HITL (deny path)"
```

---

### Task 4: Wiring en `agent.ts` + eliminar `tools.ts`

**Files:**
- Modify: `apps/agent/src/core/agent.ts:41` (import) y `:244-252` (call)
- Delete: `apps/agent/src/core/tools.ts`

- [ ] **Step 1: Actualizar el import en `agent.ts:41`**

Reemplazar:
```ts
import { buildTools, type TraceIds } from "./tools.js"
```
por:
```ts
import { buildTools } from "./actions/registry.js"
import type { TraceIds } from "./actions/types.js"
```

- [ ] **Step 2: Pasar `principal` en la llamada a `buildTools` (`agent.ts:244-252`)**

`principal` ya está computado en el loop (~`:145`). Agregarlo al objeto:
```ts
        tools: buildTools({
          caps,
          principal,
          memory,
          emit,
          ids,
          logger: ctx.logger,
          compressor,
          ragIntensity,
        }),
```

- [ ] **Step 3: Eliminar `core/tools.ts`**

Run: `git rm apps/agent/src/core/tools.ts`

- [ ] **Step 4: Typecheck (detecta cualquier import colgado)**

Run: `pnpm -r typecheck`
Expected: PASS. Si falla por `ToolDeps`/`TraceIds` importado en otro lado, redirigir al nuevo `actions/types.js`.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/core/agent.ts
git commit -m "refactor(agent): cablear el registry de acciones (principal en ActionContext); eliminar tools.ts"
```

---

### Task 5: Verificación end-to-end

**Files:** ninguno (solo verificación, según `CLAUDE.md` §Verificación).

- [ ] **Step 1: Suite completa + lint + build**

Run: `pnpm -r typecheck && pnpm exec biome check . && pnpm -r test && pnpm -r build`
Expected: todo PASS. Conteo de tests del agente ≥ el de antes (los 3 de searchMemory + 5 nuevos de registry; el viejo "incluye searchMemory solo si…" quedó cubierto por la capa canal del registry).

- [ ] **Step 2: e2e real — la migración no rompió `searchMemory`**

Run (con `.env` con keys + `LOG_LEVEL=debug`):
```bash
pnpm dev   # en otra terminal
curl -s localhost:8787/health        # → 200
curl -s -X POST localhost:8787/chat -H "x-agent-key: $AGENT_API_KEY" -H 'content-type: application/json' \
  -d '{"channel":"web","conversationId":"t1","userText":"¿qué tecnologías usa Kevin?","locale":"es"}'
```
Expected: respuesta con RAG real citando el CV (la traza muestra `tool.call`/`tool.result` de `searchMemory`,
`ok:true`). Confirma que el registry expone y ejecuta la tool como antes.

- [ ] **Step 3: Fallback intacto**

Verificar (matando el primario o con key inválida del primario) que sigue respondiendo por cortesía/cadena —
invariante "siempre responde".

- [ ] **Step 4: Reconciliar docs**

- `docs/NEXT-STEPS.md`: mover el eje 2 ("framework de tools/harness") de "Próximo paso mayor" al Historial como
  **infra implementada** (registry + seam HITL delgado; searchMemory migrado; write-actions = próxima iteración).
  Actualizar el ESTADO ACTUAL y la lista WIP.
- `docs/SPEC.md`: si el "harness" estaba descrito como futuro, anotar que la infra del registry ya existe (sin
  cambiar el norte). Sincronizar la copia del portafolio solo si se tocó el diseño macro (no es el caso).
- `docs/LEARNINGS.md`: registrar el patrón "tool sin execute = HITL nativo del AI SDK v6" como camino de upgrade
  del seam async.

- [ ] **Step 5: Commit de reconciliación**

```bash
git add docs/NEXT-STEPS.md docs/SPEC.md docs/LEARNINGS.md
git commit -m "docs: reconciliar — harness de tools (infra) implementado; seam HITL delgado"
```

---

## Self-Review (hecho)

- **Spec coverage:** registry (T3) · descriptor/contratos (T2) · gating 2 capas (T3) · seam HITL deny path (T3) ·
  `denied?` en traza (T1) · migración searchMemory sin cambio (T2) · wiring + eliminar tools.ts (T4) ·
  verificación e2e + fallback + docs (T5). Camino de upgrade (futuro) queda documentado en T5/LEARNINGS.
- **Placeholder scan:** sin TBD/TODO; todo step trae código o comando concreto.
- **Type consistency:** `ActionContext`/`ActionDescriptor`/`Clearance`/`TraceIds` definidos en T2 y usados igual en
  T3/T4; `buildTools(ctx, actions = ACTIONS)` consistente entre test (T3 step 1) e impl (T3 step 3); `denied` en
  T1 coincide con el emit de `deniedTool` (T3).
```
