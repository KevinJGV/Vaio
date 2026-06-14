# Diseño técnico — Framework de tools/acciones (el "harness") · solo infra + seam HITL delgado

> **Fecha:** 2026-06-13 · **Tema:** `tools-harness-registry` · **Tipo:** diseño técnico (bajo nivel).
> **Par:** plan de alto nivel en [`2026-06-13-tools-harness-registry-plan.md`](2026-06-13-tools-harness-registry-plan.md).
> **Norte / encaje:** eje 2 del "próximo paso mayor" (`NEXT-STEPS.md` §"Próximo paso mayor"); cimiento de la
> curación agéntica de "Vaio se nutre solo" (`SPEC.md`) y del `escalate` de Fase 2.

## Objetivo y alcance (lo que ESTA iteración entrega)

Generalizar el sistema de tools de una **unión cerrada de una tool read-only** (`searchMemory`) a un **registry
de acciones** con descriptores extensibles y gating de 2 capas (capacidad de canal **y** principal), dejando
**cableado el seam de confirmación/HITL** en su versión **delgada** (tipos + punto de decisión en runtime), sin
maquinaria async.

**Decisiones de alcance (cerradas con Kevin, 2026-06-13):**
1. **Solo infra + seam HITL.** No se agrega ninguna acción *side-effecting* en esta iteración. `searchMemory`
   migra al nuevo registry como prueba viva (sin cambio de comportamiento). Las write-actions vienen en su
   propia iteración (su propio par design+plan).
2. **Seam HITL delgado.** El descriptor declara su política (`sideEffecting`, `clearance`) y el loop tiene **un
   punto de decisión** que deniega limpio en `execute` en vez de ejecutar. **Sin** mecanismo async de
   pausa/notificar/reanudar (eso llega con la 1ª write-action).
3. **Gating de 2 capas.** Capa de **canal** (`allowedTools[]`) **oculta** la tool (el modelo no la ve si el canal
   no la tiene). Capa de **principal** (`clearance` del descriptor) **deniega en runtime con traza** si el
   principal no califica. `trusted` binario se mantiene (NO RBAC por roles — YAGNI para solo-dev con un owner).

**Fuera de alcance (explícito):** write-actions reales; flujo async de confirmación; `escalate`; RBAC por roles;
ventana por tokens; persona como dato; rerank. Todo eso queda referenciado en `NEXT-STEPS.md` con su fase.

## Estado actual (punto de partida, citado)

- `apps/agent/src/core/capabilities.ts:9` — `export type ToolName = "searchMemory"` (unión cerrada).
- `apps/agent/src/core/capabilities.ts:11-20` — `CapabilityProfile { channel, allowedTools, memoryScope, policyText }`.
- `apps/agent/src/core/capabilities.ts:23-29` — `Principal { channel, id, trusted }` (seam RBAC declarado, no usado).
- `apps/agent/src/core/tools.ts:21-30` — `ToolDeps { caps, memory, emit, ids, logger, compressor?, ragIntensity? }`.
- `apps/agent/src/core/tools.ts:33-127` — `searchMemoryTool(deps)`: `tool({description, inputSchema, execute})`
  con compresión Tier 1 + trazas `tool.result`.
- `apps/agent/src/core/tools.ts:130-136` — `buildTools(deps)`: un `if (allowedTools.includes("searchMemory"))`.
- `apps/agent/src/core/agent.ts:~145-157` — computa `principal` y `audience`; `:234-252` pasa `buildTools(...)` a `streamText`.
- `packages/contracts/src/trace.ts:56-67` — evento `tool.result { toolCallId, toolName, output?, hits?, latencyMs?, ok? }`.

**Verificado con context7 (AI SDK v6, `ai@6.0.0-beta.128`):** `tool({description, inputSchema, execute})`;
`ToolSet` es un record `{ [name]: Tool }` construible en runtime; `execute` puede devolver `string`. Patrón
**HITL nativo**: una tool **sin** `execute` (con `outputSchema`) → el SDK no la ejecuta y requiere confirmación.
No se usa ahora; es el camino de upgrade del seam async futuro.

## Arquitectura: módulo `core/actions/`

Reemplaza `core/tools.ts` (que hoy mezcla contrato, registry y la tool concreta). Tres archivos enfocados,
respetando ports/adapters-lite (todo en `core/`, depende de puertos, nunca de adapters):

```
apps/agent/src/core/actions/
  types.ts          # ActionDescriptor, ActionContext, Clearance (contratos del harness)
  registry.ts       # ACTIONS (array de descriptores) + buildTools(ctx) (gating de 2 capas + deny wrapper)
  search-memory.ts  # searchMemory migrado a ActionDescriptor (lógica idéntica)
```

`ToolName` permanece en `core/capabilities.ts` (unión cerrada, extensible) — es la clave de gating compartida con
`CapabilityProfile.allowedTools`. No se mueve para no tocar `capabilities.ts` más de lo necesario.

### `types.ts` — contratos

```ts
import type { Tool } from "ai"
import type { TraceEvent } from "@vaio/contracts"
import type { Compressor, Intensity } from "../../ports/compress.js"
import type { Logger } from "../../ports/logger.js"
import type { MemoryStore } from "../../ports/memory.js"
import type { CapabilityProfile, Principal, ToolName } from "../capabilities.js"

export interface TraceIds {
  requestId: string
  turnId: string
  conversationId?: string
}

/** Quién (principal) puede invocar la acción. Hoy binario; alineado con `Principal.trusted`. */
export type Clearance = "anyone" | "owner"

/** Contexto del turno inyectado a cada acción. = ToolDeps de hoy + `principal`. */
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
  /** Marca write-actions (efecto fuera de la conversación). Hoy todas `false`. */
  sideEffecting: boolean
  /** Principal mínimo que puede invocarla. `searchMemory` = "anyone". */
  clearance: Clearance
  /** Construye la `tool()` del AI SDK con el contexto del turno. Encapsula
   *  description + inputSchema + execute (typing por-tool intacto adentro). */
  build(ctx: ActionContext): Tool
}
```

**Por qué `build(ctx): Tool` y no exponer `inputSchema`/`execute` planos en el descriptor:** el helper `tool()`
del AI SDK liga el `inputSchema` (zod) al tipo del input de `execute` por inferencia. Un descriptor genérico con
schema `unknown` perdería ese typing. Encapsulando la construcción dentro de `build`, **cada acción conserva su
typing** y el registry queda agnóstico (solo necesita `name` + metadata de gating + `build`).

### `registry.ts` — el registry y el gating

```ts
import { type ToolSet, tool } from "ai"
import { z } from "zod"
import type { ActionContext, ActionDescriptor } from "./types.js"
import { searchMemory } from "./search-memory.js"

/** Único lugar donde se listan las acciones que el harness sabe construir. */
const ACTIONS: ActionDescriptor[] = [searchMemory]

/** ¿El principal cumple el clearance de la acción? */
function meetsClearance(clearance: ActionDescriptor["clearance"], principal: ActionContext["principal"]): boolean {
  if (clearance === "anyone") return true
  return principal.trusted // "owner"
}

/** Tool de denegación: el punto de decisión del seam HITL (delgado). NO ejecuta la acción;
 *  emite traza `tool.result {ok:false, denied:true}` y devuelve cortesía. Nunca throw. */
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
 *  (1) canal OCULTA  → si name ∉ caps.allowedTools, la tool ni se expone.
 *  (2) principal DENIEGA → si no cumple clearance, se expone pero su execute deniega (seam HITL). */
export function buildTools(ctx: ActionContext): ToolSet {
  const tools: ToolSet = {}
  for (const d of ACTIONS) {
    if (!ctx.caps.allowedTools.includes(d.name)) continue // capa 1: canal oculta
    tools[d.name] = meetsClearance(d.clearance, ctx.principal)
      ? d.build(ctx)            // permitido
      : deniedTool(d, ctx)      // capa 2: principal deniega en runtime (seam HITL delgado)
  }
  return tools
}
```

**Nota:** `deniedTool` usa una descripción **genérica** (no expone detalle de clearance al modelo/usuario). Si más
adelante conviene que el modelo "sepa" que la acción existe pero está restringida, se podría sumar un
`descriptionForModel` opcional al descriptor — **no se incluye hoy** (YAGNI). **Decisión de diseño:** dado que en esta iteración **ninguna**
acción tiene `clearance:"owner"`, el `deniedTool` no se ejerce en prod; se valida solo por tests (descriptor
owner-only de prueba). Es el stub del seam, no código muerto: la 1ª write-action lo activa sin tocar el registry.

### `search-memory.ts` — migración (comportamiento idéntico)

`searchMemory` pasa de función-builder a `ActionDescriptor`:

```ts
export const searchMemory: ActionDescriptor = {
  name: "searchMemory",
  sideEffecting: false,
  clearance: "anyone",
  build(ctx) {
    const k = ctx.caps.memoryScope.maxK
    return tool({
      description: "Memoria de Kevin (sus datos reales): bio/origen, stack, proyectos (GitHub), gustos (música), contacto. Úsala cuando la respuesta dependa de un hecho concreto de Kevin; no para saludos ni charla.",
      inputSchema: z.object({ query: z.string().describe("Consulta de búsqueda semántica, en lenguaje natural.") }),
      execute: async ({ query }, { toolCallId }) => { /* lógica IDÉNTICA a tools.ts:51-125:
        degradación memory:null, búsqueda, compresión Tier 1 + log "rag compressed", trazas tool.result */ },
    })
  },
}
```

La `description`, el `inputSchema`, la compresión Tier 1 (`compressOrRaw` + log `"rag compressed"`) y las trazas
`tool.result` se preservan **byte-a-byte** (es la prueba de que la migración no cambia comportamiento).

## Cambios al contrato compartido (`@vaio/contracts`)

`packages/contracts/src/trace.ts` — agregar campo **opcional** al evento `tool.result`:

```ts
// dentro del objeto type:"tool.result"
denied: z.boolean().optional(), // true si la tool se denegó por clearance (seam HITL). Default ausente.
```

No rompe nada (opcional). Lo consume el panel de conversaciones futuro para distinguir un fallo de una
denegación. `ok:false` + `denied:true` = denegación; `ok:false` sin `denied` = fallo de ejecución.

## Wiring (`core/agent.ts`)

Único cambio: `buildTools` ahora recibe `ActionContext` con `principal` (ya computado en el loop, ~`:145`):

```ts
tools: buildTools({
  caps, principal, memory, emit, ids, logger: ctx.logger, compressor, ragIntensity,
}),
```

`import` pasa de `./tools.js` a `./actions/registry.js`. `core/tools.ts` se elimina. El resto del loop
(`streamText`, `stopWhen: stepCountIs(10)`, instrumentación `onChunk`/`onStepFinish`/`onError`) **no cambia**.

## Flujo (de request a tools)

```
TurnRequest → Principal{channel,id,trusted} → caps = resolver.resolve(channel, principal)
  → ActionContext{caps, principal, memory, emit, ids, logger, compressor, ragIntensity}
  → buildTools(ctx):
       por cada ActionDescriptor en ACTIONS:
         capa 1 (canal): name ∈ caps.allowedTools ? sigue : oculta
         capa 2 (principal): meetsClearance ? build(ctx) : deniedTool(ctx)
  → streamText({ ..., tools })
```

## Manejo de errores e invariantes

- **"Siempre responde":** `deniedTool.execute` y todo fallo de tool devuelven **texto de cortesía**, nunca throw
  al loop. El agente jamás tira 500/ vacío por una denegación o un error de tool.
- **Sin secrets en logs:** la traza respeta la redacción existente (`LOG_PROMPTS`); el `output` de denegación es
  genérico (no filtra clearance interno al usuario más allá de "no puedo en este canal").
- **ports/adapters-lite:** todo el harness vive en `core/`, depende solo de puertos; `index.ts`/`agent.ts` cablean.

## Edge-cases

- **`memory: null`** (sin DB): `searchMemory` ya degrada a cortesía; intacto tras la migración.
- **Acción en `allowedTools` pero ausente del registry `ACTIONS`:** `buildTools` la ignora (el `for` solo recorre
  `ACTIONS`). Como `ToolName` es unión cerrada y `ACTIONS` la cubre, no debería pasar; se cubre por construcción.
- **`clearance:"owner"` en canal web:** `principal.trusted` siempre `false` en web → siempre deniega. Correcto.
- **Descripción del `deniedTool`:** literal genérico (no expone clearance). Un `descriptionForModel` opcional
  queda como posible extensión futura del descriptor — **no se incluye hoy**.

## Estrategia de testing (TDD — lógica pura)

`apps/agent/src/core/actions/registry.test.ts`:
1. **Capa canal oculta:** caps con `allowedTools: []` → `buildTools` devuelve `{}`.
2. **Acción permitida:** caps con `["searchMemory"]` + principal cualquiera → `tools.searchMemory` presente.
3. **Clearance deniega (seam):** descriptor de prueba `clearance:"owner"` + principal `trusted:false` →
   la tool se expone, su `execute` emite `tool.result {ok:false, denied:true}` y devuelve cortesía (no ejecuta).
4. **Clearance permite:** mismo descriptor + principal `trusted:true` → ejecuta la lógica real.
5. **`searchMemory` migrado:** comportamiento idéntico (degradación `memory:null`; resultados con/sin hits;
   trazas `tool.result` con `ok`/`hits`/`latencyMs`). Reusar/portar los tests existentes de `tools.test.ts`.

El test 3 **ejercita el seam HITL completo sin enviar ninguna write-action** (descriptor owner-only solo de test).

## Verificación (antes de "listo")

- `pnpm -r typecheck` + `pnpm exec biome check .` + `pnpm -r test` limpios.
- `pnpm dev` → `/health` 200; `/chat` con `x-agent-key` responde y **usa `searchMemory`** (RAG real, p.ej.
  "¿qué tecnologías usa Kevin?" cita el CV) — prueba e2e de que la migración no rompió el camino.
- Fallback intacto (matar el primario → sigue respondiendo).

## Camino de upgrade (futuro — registrado, NO se implementa)

Cuando llegue la **1ª write-action** (su propio par design+plan):
- El seam async se construye sobre el **HITL nativo del AI SDK v6** (tool **sin** `execute` → confirmación).
- `sideEffecting` y `clearance` ya serán los disparadores; el descriptor sumará la política de confirmación.
- `escalate` (Fase 2) y `saveFact` (curación "Vaio se nutre solo") son las primeras candidatas.
- Prompt caching de tool-defs + bloque estable (gap de costo en `NEXT-STEPS.md`) cobra sentido al crecer el
  registry.
```
