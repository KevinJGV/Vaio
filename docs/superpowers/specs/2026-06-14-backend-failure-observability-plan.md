# Observabilidad de fallos silenciosos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que todo fallo/degradación del backend deje rastro de su causa (log estructurado siempre + TraceEvent
`degraded` persistido donde afecte la respuesta), sin cambiar el comportamiento degradado.

**Architecture:** Nuevo TraceEvent `degraded {component, reason, detail?}` + helper `reportDegraded` (log + emit).
El núcleo puro `modality.ts` recibe un callback `onDegrade` (lo cablea `agent.ts` vía `reportDegraded`); los
adapters con logger loguean la causa técnica antes de lanzar/degradar. Barrido de los ~17 fallos del inventario.

**Tech Stack:** TypeScript estricto · zod · pino (Logger) · TraceSink/TraceEvent · Vitest.

> **Reqs completos (causa raíz, inventario, edge-cases):** ver el design
> [`2026-06-14-backend-failure-observability-design.md`](2026-06-14-backend-failure-observability-design.md).

---

## Estrategia de ejecución (obligatoria)

**Recomendación: subagent-driven secuencial** (fresco por tarea, review en las que importan: contrato y el wiring
core media). Razón: 6 tareas, varios archivos; el núcleo (Task 1-3) es **secuencialmente acoplado** (contrato →
helper → modality+agent), y el barrido de adapters (Task 4) son cambios chicos e independientes pero comparten el
patrón recién definido → conviene hacerlos tras el núcleo. No hay paralelismo que rinda (cambios chicos, estado
compartido en el contrato). **Punto de vista:** es mayormente mecánico (agregar logs siguiendo un patrón) → si se
prefiere **inline** (executing-plans) es perfectamente válido y más rápido; la diferencia es contexto fresco vs
continuo, no paralelismo.

---

## File Structure

- **Modify** `packages/contracts/src/trace.ts` — TraceEvent `degraded`.
- **Create** `apps/agent/src/core/observability.ts` — `DegradeReport`, `reportDegraded`.
- **Modify** `apps/agent/src/core/modality.ts` — `onDegrade` callback + `safe()` reporta.
- **Modify** `apps/agent/src/core/agent.ts:201` — cablear `onDegrade`.
- **Modify** adapters: `media-openrouter.ts`, `embeddings.ts`, `neon-memory.ts`, `sources/{util,github,lastfm}.ts`,
  `speech-openrouter.ts`, `trace-composite.ts` — log de la causa.
- **Modify** `adapters/telegram/routes.ts` — verificar/completar los `catch {}`.
- **Create/Modify** tests: `observability.test.ts`, extender `modality.test.ts`, `media-openrouter.test.ts`.

---

### Task 1: TraceEvent `degraded` (contrato)

**Files:** Modify `packages/contracts/src/trace.ts`

- [ ] **Step 1: Agregar el evento a la unión discriminada**

En `traceEventSchema`, sumar (antes del cierre `])`):
```ts
  z.object({
    ...base,
    type: z.literal("degraded"),
    /** Qué se degradó: "transcribe" | "vision" | "embeddings" | "tts" | "source" | … */
    component: z.string(),
    /** Causa corta, legible. SIEMPRE visible. */
    reason: z.string(),
    /** Detalle técnico (status/excepción). Se redacta según LOG_PROMPTS. */
    detail: z.string().optional(),
  }),
```

- [ ] **Step 2: Typecheck + build de contracts**

Run: `pnpm --filter @vaio/contracts typecheck && pnpm --filter @vaio/contracts build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/src/trace.ts
git commit -m "feat(contracts): TraceEvent degraded (fallo no-fatal con causa)"
```

---

### Task 2: Helper `reportDegraded`

**Files:** Create `apps/agent/src/core/observability.ts`; Test `apps/agent/test/observability.test.ts`

- [ ] **Step 1: Escribir el test (falla primero)**

`apps/agent/test/observability.test.ts`:
```ts
import type { TraceEvent } from "@vaio/contracts"
import { describe, expect, it, vi } from "vitest"
import { reportDegraded } from "../src/core/observability.js"
import type { LogFields, Logger } from "../src/ports/logger.js"

function spyLogger(): Logger & { warns: LogFields[] } {
  const warns: LogFields[] = []
  const noop = (_a: LogFields | string, _b?: string): void => {}
  const l = { trace: noop, debug: noop, info: noop, error: noop, child: () => l,
    warn: (a: LogFields | string) => { if (typeof a === "object") warns.push(a) }, warns } as Logger & { warns: LogFields[] }
  return l
}

describe("reportDegraded", () => {
  it("loguea warn y emite un TraceEvent degraded con los campos", () => {
    const events: TraceEvent[] = []
    const logger = spyLogger()
    reportDegraded(
      { emit: (e) => events.push(e), ids: { requestId: "r", turnId: "t" }, logger },
      { component: "transcribe", reason: "transcribe falló", detail: "transcriptions 400" }
    )
    expect(logger.warns[0]).toMatchObject({ component: "transcribe", detail: "transcriptions 400" })
    expect(events[0]).toMatchObject({ type: "degraded", component: "transcribe", reason: "transcribe falló", detail: "transcriptions 400" })
  })
})
```

- [ ] **Step 2: Correr → FAIL** (`pnpm --filter @vaio/agent test observability` → "Cannot find module observability.js").

- [ ] **Step 3: Implementar `apps/agent/src/core/observability.ts`**

```ts
// Reporte UNIFORME de degradaciones (fallo no-fatal: el turno sigue, pero un componente accesorio falló).
// Dos niveles: log estructurado (siempre) + TraceEvent `degraded` persistido (queda en trace_events).

import type { TraceEvent } from "@vaio/contracts"
import type { Logger } from "../ports/logger.js"
import type { TraceIds } from "./actions/types.js"

export interface DegradeReport {
  component: string
  reason: string
  detail?: string
}

export function reportDegraded(
  deps: { emit: (e: TraceEvent) => void; ids: TraceIds; logger: Logger },
  d: DegradeReport
): void {
  deps.logger.warn(
    { component: d.component, reason: d.reason, detail: d.detail },
    "degraded"
  )
  deps.emit({
    ...deps.ids,
    type: "degraded",
    component: d.component,
    reason: d.reason,
    detail: d.detail,
  })
}
```

- [ ] **Step 4: Correr → PASS.** Commit:
```bash
git add apps/agent/src/core/observability.ts apps/agent/test/observability.test.ts
git commit -m "feat(observability): helper reportDegraded (log + TraceEvent degraded)"
```

---

### Task 3: `modality.safe` reporta + wiring en `agent.ts`

**Files:** Modify `apps/agent/src/core/modality.ts`, `apps/agent/src/core/agent.ts`; extend `apps/agent/test/modality.test.ts`

- [ ] **Step 1: Test (extender `modality.test.ts`)**

Agregar (mirá los imports/helpers existentes del archivo; `buildUserContent` ya se importa):
```ts
it("reporta degraded cuando el transcriber lanza, y cae al marcador", async () => {
  const reports: { component: string; detail?: string }[] = []
  const transcriber = { transcribe: async () => { throw new Error("transcriptions 400") } }
  const { content } = await buildUserContent({
    userText: "", media: [{ kind: "audio", data: new Uint8Array([1]), mediaType: "audio/ogg" }],
    transcriber, understanding: null, nativeImages: false, locale: "es",
    onDegrade: (d) => reports.push(d),
  })
  expect(String(content)).toContain("[audio no procesable]")
  expect(reports[0]).toMatchObject({ component: "transcribe" })
  expect(reports[0]?.detail).toBeTruthy()
})

it("NO reporta degraded si el puerto es null (off por config)", async () => {
  const reports: unknown[] = []
  await buildUserContent({
    userText: "", media: [{ kind: "audio", data: new Uint8Array([1]), mediaType: "audio/ogg" }],
    transcriber: null, understanding: null, nativeImages: false, locale: "es",
    onDegrade: () => reports.push(1),
  })
  expect(reports).toHaveLength(0)
})
```

- [ ] **Step 2: Correr → FAIL** (onDegrade no existe en la firma).

- [ ] **Step 3: Modificar `modality.ts`**

(a) Importar el tipo: `import type { DegradeReport } from "./observability.js"` y `import { errMsg } from "./util.js"`.
(b) Agregar a los args de `buildUserContent`: `onDegrade?: (d: DegradeReport) => void` (y desestructurarlo).
(c) Reescribir `safe` para recibir component + onDegrade y NO tragar el error:
```ts
async function safe(
  component: string,
  onDegrade: ((d: DegradeReport) => void) | undefined,
  fn: () => Promise<string> | undefined
): Promise<string | null> {
  try {
    const r = await fn()
    return r && r.trim().length > 0 ? r.trim() : null
  } catch (err) {
    onDegrade?.({ component, reason: `${component} falló`, detail: errMsg(err) })
    return null
  }
}
```
(d) Actualizar las dos llamadas:
- audio: `const text = await safe("transcribe", onDegrade, () => transcriber?.transcribe({ data: item.data, mediaType: item.mediaType, locale }))`
- imagen (no nativa): `const desc = await safe("vision", onDegrade, () => understanding?.describe({ data: item.data, mediaType: item.mediaType, caption: item.caption, locale }))`

> NOTA: el puerto `null` hace que `fn()` devuelva `undefined` (no lanza) → `safe` devuelve `null` SIN llamar
> `onDegrade`. Eso preserva la distinción "off por config ≠ fallo" (test del Step 1).

- [ ] **Step 4: Correr `modality` → PASS.**

- [ ] **Step 5: Wiring en `agent.ts:201`**

Importar: `import { reportDegraded } from "./observability.js"`. En la llamada a `buildUserContent` (línea ~201)
agregar el callback (cierra sobre `emit`/`ids`/`ctx.logger`, ya definidos en líneas 190-193):
```ts
      const { content: userContent, derivedText } = await buildUserContent({
        userText: req.userText,
        media,
        transcriber,
        understanding: mediaUnderstanding,
        nativeImages,
        locale,
        onDegrade: (d) => reportDegraded({ emit, ids, logger: ctx.logger }, d),
      })
```

- [ ] **Step 6: Typecheck + tests del agente.** Run: `pnpm --filter @vaio/agent typecheck && pnpm --filter @vaio/agent test modality agent-loop` → PASS. Commit:
```bash
git add apps/agent/src/core/modality.ts apps/agent/src/core/agent.ts apps/agent/test/modality.test.ts
git commit -m "feat(observability): modality reporta degradaciones de media (onDegrade) + wiring en agent"
```

---

### Task 4: Barrido de adapters (log de la causa)

**Files:** Modify `media-openrouter.ts`, `embeddings.ts`, `neon-memory.ts`, `sources/{util,github,lastfm}.ts`, `speech-openrouter.ts`, `trace-composite.ts`; Test `media-openrouter.test.ts`

- [ ] **Step 1: `media-openrouter.ts` — loguear status+body antes de throw**

En `transcribe`, reemplazar el `if (!res.ok)` (línea ~57):
```ts
      if (!res.ok) {
        const body = await res.text().catch(() => "")
        logger.warn({ status: res.status, body: body.slice(0, 500) }, "transcribe failed")
        throw new Error(`transcriptions ${res.status}`)
      }
```
(El `logger` ya está en el closure de `createTranscriber`.)

- [ ] **Step 2: `neon-memory.ts` — loguear query embedding vacío**

`searchMemory`, reemplazar `if (!qEmb) return []`:
```ts
      if (!qEmb) {
        logger.warn({}, "searchMemory: embedding de la query vacío → sin resultados")
        return []
      }
```
⚠️ `createMemoryStore(db, embedder)` hoy NO recibe `logger`. Agregar `logger: Logger` como 3er parámetro (import
`type { Logger } from "../ports/logger.js"`) y actualizar el llamador en `index.ts:92`
(`createMemoryStore(db, embedder, logger)`).

- [ ] **Step 3: `embeddings.ts` — no tragar el parse error**

Reemplazar `res.json().catch(() => ({}))` (línea ~38) por una lectura que loguee:
```ts
      const json = await res.json().catch((err) => {
        logger.warn({ err: String(err) }, "embeddings: respuesta no-JSON")
        return {} as Record<string, unknown>
      })
```
⚠️ Si `createEmbedder` no tiene `logger`, agregarlo igual que en Step 2 (param + llamador en `index.ts:86`). Si
ya lo tiene, usarlo. (Verificar la firma actual de `createEmbedder` antes de editar.)

- [ ] **Step 4: `sources/{util,github}.ts` — body antes de throw**

En `sources/util.ts:6` y `sources/github.ts:34`, antes del `throw`, leer y loguear el body:
```ts
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    // si hay logger en scope: logger.warn({ url, status: res.status, body: body.slice(0, 300) }, "fetch source failed")
    throw new Error(`${url} → ${res.status}${body ? ` · ${body.slice(0, 200)}` : ""}`)
  }
```
> NOTA: las fuentes corren en INGESTA (batch, fuera de turno) y quizá sin `logger` inyectado. Si no hay logger en
> el scope, basta con **incluir el body en el mensaje del Error** (que sí se loguea aguas arriba en `ingest.ts`).
> Verificar si esos módulos reciben logger; si no, NO inventar uno — el body en el mensaje del Error es suficiente.

- [ ] **Step 5: `speech-openrouter.ts` y `trace-composite.ts`**

- `speech-openrouter.ts:24` (`return null` por sin entrada/cadena vacía) y `:50` (`byteLength 0 → continue`):
  agregar `logger.debug(...)` con la razón (es degradación esperada → `debug`, no `warn`).
- `trace-composite.ts:12-14` (sink roto): en el `catch`, `logger.debug({ err: String(err) }, "trace sink failed")`
  (debug para no ensuciar; un sink de traza roto no debe gritar). ⚠️ verificar que `trace-composite` tenga logger;
  si no, dejarlo documentado (es best-effort por diseño) — NO agregar dependencia si complica.

- [ ] **Step 6: Test de `media-openrouter` (el más verificable)**

Extender `apps/agent/test/media-openrouter.test.ts` (mirá cómo mockea fetch): un caso con `fetch` → `res.ok:false`
status 400 que verifique que `logger.warn` se llamó con `status:400` antes de lanzar.

- [ ] **Step 7: Typecheck + suite + commit**

Run: `pnpm --filter @vaio/agent typecheck && pnpm --filter @vaio/agent test` → PASS.
```bash
git add apps/agent/src
git commit -m "feat(observability): adapters loguean la causa al fallar/degradar (media/embeddings/sources/speech/sink)"
```

---

### Task 5: Telegram routes — verificar `catch {}`

**Files:** Modify `apps/agent/src/adapters/telegram/routes.ts`

- [ ] **Step 1: Revisar cada catch vacío** (`:67-69`, `:154-156`, `:168-169`)

Para cada uno, verificar si el error YA se loguea aguas arriba. Si NO:
- `:168-169` (JSON.parse del update inválido): agregar `logger.warn({ err: String(err) }, "tg: update no-JSON")` antes del `return c.json({ ok: true })`.
- `:67-69` y `:154-156`: si el comentario "ya logueado" es cierto (rastrear el path), dejarlo; si no, agregar `logger.warn` con contexto.

- [ ] **Step 2: Typecheck + tests telegram + commit**

Run: `pnpm --filter @vaio/agent typecheck && pnpm --filter @vaio/agent test telegram` → PASS.
```bash
git add apps/agent/src/adapters/telegram/routes.ts
git commit -m "feat(observability): telegram routes loguean updates inválidos / fallos de envío"
```

---

### Task 6: Verificación e2e + docs

- [ ] **Step 1: Suite + lint + build.** Run: `pnpm -r typecheck && pnpm exec biome check . && pnpm -r test && pnpm -r build` → PASS.

- [ ] **Step 2: e2e — reproducir el caso original**

Con server local + keys, mandar un audio que falle la transcripción (o forzar un STT inválido). Verificar:
- El log ahora muestra `warn` con la causa (`transcribe failed` con status, o `degraded component:transcribe`).
- La traza tiene un evento `degraded {component:"transcribe"}` (en stdout y, si `TRACE_PERSIST`, en `trace_events`).
- El usuario sigue recibiendo la respuesta degradada (sin regresión).

- [ ] **Step 3: Reconciliar docs**

- `NEXT-STEPS.md`: cerrar el WIP de observabilidad (→ `[?]`/Historial al verificar Kevin). Actualizar ESTADO ACTUAL
  (fecha 2026-06-14).
- `LEARNINGS.md`: registrar el patrón `degraded` + `reportDegraded` + `onDegrade` para el core puro (cómo reporta
  sin romper su pureza), y que "siempre responde" ahora deja rastro.

- [ ] **Step 4: Commit de reconciliación**
```bash
git add docs/
git commit -m "docs: reconciliar — observabilidad de fallos silenciosos implementada"
```

---

## Self-Review (hecho)

- **Spec coverage:** evento `degraded` (T1) · `reportDegraded` (T2) · modality `onDegrade` + agent wiring (T3) ·
  barrido de adapters con log de causa (T4) · telegram catch (T5) · e2e + docs (T6). Cobertura por capa
  (media→log+traza; adapters→log) cubierta en T3/T4. Patrón bueno (searchMemory) intacto.
- **Placeholder scan:** sin TBD/TODO; cada step trae código o comando. Los `⚠️ verificar firma` (neon-memory/
  embeddings/sources logger) son instrucciones explícitas de verificación, no placeholders — incluyen el fallback
  ("si no tiene logger, body en el mensaje del Error").
- **Type consistency:** `DegradeReport` (T2) usado igual en modality (T3) y agent (T3); `reportDegraded(deps, d)`
  firma consistente entre test (T2) y wiring (T3); `degraded` event (T1) coincide con lo que emite `reportDegraded`
  (T2); `onDegrade?: (d: DegradeReport) => void` consistente entre modality y agent.
