# Diseño técnico — Observabilidad de fallos silenciosos del backend

> **Fecha:** 2026-06-14 · **Tema:** `backend-failure-observability` · **Tipo:** diseño técnico (bajo nivel).
> **Par:** plan en [`2026-06-14-backend-failure-observability-plan.md`](2026-06-14-backend-failure-observability-plan.md).
> **Disparador:** un audio de un visitante por Telegram falló la transcripción y respondió `[audio no procesable]`
> **sin dejar ningún log de la causa** → imposible depurar. Kevin: "¿no hace falta ser más explícito en los
> errores del backend?". Causa raíz diagnosticada (systematic-debugging) abajo.

## Objetivo y alcance

Que **todo fallo o degradación del backend deje rastro de su causa** — hoy hay ~17 puntos donde el código captura
un error o degrada sin loguear/emitir nada, y el agente "siempre responde" pero **a ciegas**. Esto NO cambia el
comportamiento degradado (el turno sigue respondiendo igual); solo agrega **por qué** falló.

**Decisiones cerradas con Kevin (2026-06-14):**
1. **Dos niveles de registro:** (1) **SIEMPRE** log estructurado (pino/stdout) con la causa — resuelve "depurar
   mirando los logs de Railway". (2) Los fallos que **afectan la respuesta al usuario** (media no procesable, RAG
   ciego, tool falla) ADEMÁS emiten un **TraceEvent persistido** en `trace_events` → consultable en el panel futuro.
2. **Evento nuevo genérico `degraded`** `{ component, reason, detail? }` — semánticamente distinto de `turn.error`
   (turno roto) y `tool.result` (resultado de tool): *el turno siguió, pero un componente accesorio se degradó*.
3. **Barrido amplio:** auditar y arreglar TODOS los fallos silenciosos del inventario (no solo el de audio) +
   dejar un **patrón reusable** (`reportDegraded` + el evento) para los futuros.

**Fuera de alcance (futuro):** alertas/notificaciones de fallos (avisar a Kevin), métricas/dashboards agregados,
retries automáticos. Solo "que la causa quede registrada".

## Causa raíz (systematic-debugging, Fase 1 — ya hecha)

El path de media degrada **a ciegas**:
- `core/modality.ts:108-118` — `safe()` tiene `catch { return null }` (vacío): la excepción del transcriber/visión
  se descarta **sin loguear ni emitir**; línea 74 pone `[audio no procesable]`.
- `adapters/media-openrouter.ts:57-59` — el Transcriber, ante `!res.ok`, hace `throw new Error("transcriptions
  ${res.status}")` **sin loguear** el status/body. Ese error muere en el `catch {}` de `safe`.
- Por eso **no aparece `media.transcribe`** en el log (solo se emite tras el éxito) → fallo invisible.
- `core/modality.ts` es **núcleo PURO sin logger ni emit** (por diseño) → no tiene cómo reportar.

El patrón CORRECTO ya existe en `core/actions/search-memory.ts:92-104` (`catch (err) { logger.error(...); emit(
tool.result {ok:false}) }`) — falta replicarlo en el resto.

## Inventario (auditoría completa — ~17 fallos)

**ALTO** (fallo invisible que ya mordió o ciega capacidades):
- `core/modality.ts:115-117` — `catch {}` de `safe()` (transcribe/visión). **Core puro.**
- `core/modality.ts:73-74,95` — degradación a marcador `[audio/imagen no procesable]` sin causa. **Core puro.**
- `adapters/embeddings.ts:38` — `res.json().catch(()=>({}))` pierde el error de parsing.
- `adapters/neon-memory.ts:17` — `if (!qEmb) return []` (embeddings de la query falló) sin log → RAG ciego.

**MEDIO** (detalle técnico perdido al lanzar):
- `adapters/media-openrouter.ts:58` — `throw transcriptions ${status}` sin loguear body.
- `adapters/sources/util.ts:6`, `adapters/sources/github.ts:34` — `throw url → status` sin body.
- `adapters/speech-openrouter.ts:24,50` — `return null` / `byteLength 0 → continue` sin log.
- `adapters/trace-composite.ts:12-14` — un sink roto se traga el error (riesgo: huecos en la traza).

**BAJO** (catch deliberados "ya logueado aguas arriba" — verificar y completar):
- `adapters/telegram/routes.ts:67-69,154-156,168-169` — `catch {}` con comentario; verificar que el log exista
  realmente aguas arriba; si no, agregarlo.
- `adapters/sources/lastfm.ts:22` — `[] ` sin log (borderline; puede ser legítimo).

**Patrón bueno (referencia, no tocar):** `search-memory.ts`, `trace-pg.ts` (best-effort), `speech-openrouter.ts`
(catch→warn→continue), `telegram/client.ts` (catch→warn→false), `agent.ts:368-376` (catch→error→emit turn.error).

## Arquitectura

### 1. TraceEvent `degraded` (`packages/contracts/src/trace.ts`)

Sumar a la unión discriminada:
```ts
z.object({
  ...base,
  type: z.literal("degraded"),
  /** Qué se degradó: "transcribe" | "vision" | "embeddings" | "tts" | "source" | … */
  component: z.string(),
  /** Causa corta, legible. SIEMPRE visible (no se redacta). */
  reason: z.string(),
  /** Detalle técnico (status HTTP, mensaje de excepción). Se redacta según LOG_PROMPTS. */
  detail: z.string().optional(),
}),
```
El sink existente ya persiste todo `TraceEvent` → `degraded` queda en `trace_events` sin tocar el sink. La
redacción (`core/logging.ts`) trata `detail` como contenido sensible (igual que `output`/`args`).

### 2. Helper `reportDegraded` (núcleo)

Un solo lugar que define el patrón (log + emit). Vive en `core` (junto a la observabilidad del turno):
```ts
// core/observability.ts (o util.ts)
export interface DegradeReport { component: string; reason: string; detail?: string }
export function reportDegraded(
  deps: { emit: (e: TraceEvent) => void; ids: TraceIds; logger: Logger },
  d: DegradeReport
): void {
  deps.logger.warn({ component: d.component, reason: d.reason, detail: d.detail }, "degraded")
  deps.emit({ ...deps.ids, type: "degraded", component: d.component, reason: d.reason, detail: d.detail })
}
```

### 3. Callback `onDegrade` para el núcleo puro (`core/modality.ts`)

`modality.ts` sigue **puro** (no conoce Logger/Sink): `buildUserContent` recibe un callback opcional
`onDegrade?: (d: DegradeReport) => void`. `safe()` deja de tragar el error:
```ts
async function safe(component: string, onDegrade: ((d: DegradeReport) => void) | undefined,
                    fn: () => Promise<string> | undefined): Promise<string | null> {
  try {
    const r = await fn()
    return r && r.trim().length > 0 ? r.trim() : null
  } catch (err) {
    onDegrade?.({ component, reason: `${component} falló`, detail: errMsg(err) })
    return null
  }
}
```
Las llamadas pasan el component: `safe("transcribe", onDegrade, () => transcriber?.transcribe(...))` y
`safe("vision", onDegrade, () => understanding?.describe(...))`. Si el puerto es `null` (no lanza, devuelve
undefined → null) **no** se reporta degradación (es "off por config", no un fallo) — distinción honesta.

`agent.ts` arma el `onDegrade` cerrando sobre `emit`+`ids`+`logger` (vía `reportDegraded`) y lo pasa a
`buildUserContent`. Así el log+traza se centraliza en el wiring; el core queda agnóstico.

### 4. Log técnico en los adapters

Donde el adapter **tiene logger** y lanza/degrada, loguear la causa ANTES (el `detail` técnico):
- `media-openrouter.ts`: en `!res.ok`, `logger.warn({status, body})` antes del `throw` (leer `res.text()` para el body, con cuidado de no romper si no hay body).
- `embeddings.ts`: loguear el error de parsing en vez de `catch(()=>({}))` ciego.
- `sources/{util,github}.ts`: loguear status+body antes del throw.
- `speech-openrouter.ts`, `trace-composite.ts`: loguear la causa del fallback/sink roto.
- `neon-memory.ts`: `if (!qEmb)` → loguear "embeddings de la query vacío → RAG sin resultados".

> Cobertura por capa: **media** (en el path del turno, con `onDegrade`) → log **+** TraceEvent `degraded`
> persistido. **Adapters sin contexto de turno** (sources/ingest/embeddings/sink) → **solo log** (nivel 1) — no
> tienen `emit`/`ids` del turno y muchos corren fuera de un turno (ingesta batch). searchMemory ya cumple el patrón.

### 5. Telegram routes (catch "ya logueado")

Verificar cada `catch {}`: si el error YA se logueó aguas arriba (en `handleTurn`), dejar el comentario; si NO,
agregar `logger.warn`. El de `JSON.parse` del update inválido (`:168-169`) sí debe loguear (`logger.warn` con un
preview), porque hoy un webhook corrupto es invisible.

## Manejo de errores e invariantes

- **No cambia el comportamiento degradado:** el turno sigue respondiendo igual (marcador/cortesía/fallback). Solo
  se agrega el rastro. La invariante "siempre responde" se mantiene intacta.
- **El reporte es best-effort:** `reportDegraded`/`onDegrade` nunca deben lanzar (un fallo al loguear/emitir no
  puede tumbar el turno). `emit` ya es fire-and-forget en el sink; el `logger.warn` no lanza.
- **Sin secrets:** `detail` respeta la redacción `LOG_PROMPTS`; nunca loguear keys (el body de un `!res.ok` de
  OpenRouter puede traer info — truncar y redactar). `reason`/`component` son seguros (no llevan contenido).
- **Núcleo puro intacto:** `modality.ts` no importa Logger/TraceSink; solo el tipo `DegradeReport` + el callback.

## Edge-cases

- **Puerto null (STT/visión off por config):** NO es degradación → no se reporta `degraded` (se distingue de un
  fallo real). El boot ya loguea "STT OFF" en ese caso.
- **`onDegrade` ausente** (llamadores que no lo pasan, p.ej. tests): `safe` degrada como hoy (devuelve null) sin
  reportar — backward-compatible.
- **Body de la respuesta de error no disponible / `res.text()` lanza:** envolver la lectura del body en su propio
  try/catch → si no se puede leer, loguear solo el status.
- **Doble registro (adapter loguea + core emite):** es deliberado y útil — el adapter da el detalle técnico
  (status/body) en stdout; el core da la degradación semántica (component) en stdout + traza. No es ruido: son
  dos niveles de la misma causa.

## Estrategia de testing (TDD)

1. **contracts:** el schema `traceEventSchema` parsea un evento `degraded {component, reason, detail}`.
2. **`reportDegraded`:** loguea (`logger.warn` con component/reason/detail) **y** emite un `degraded` con esos campos.
3. **`modality.safe` (vía `buildUserContent`):** con un transcriber que **lanza**, `onDegrade` recibe
   `component:"transcribe"` + un `detail` no vacío, y el content cae al marcador `[audio no procesable]`. Con
   transcriber `null` (off), **no** se reporta degradación. Ídem visión.
4. **`media-openrouter`:** ante `fetch` `!res.ok`, loguea `warn` con el status antes de lanzar (mock de fetch).
5. **`neon-memory`:** `if (!qEmb)` loguea antes de `return []` (con un embedder que devuelve vacío).

## Verificación (antes de "listo")

- `pnpm -r typecheck` + `pnpm exec biome check .` + `pnpm -r test` + `pnpm -r build` limpios.
- e2e: reproducir el caso original (audio que falla la transcripción) → ahora el log muestra el `warn` con la
  causa (status/excepción) **y** la traza tiene un evento `degraded {component:"transcribe"}`. El usuario sigue
  recibiendo la respuesta degradada (sin regresión del comportamiento).
- Fallback de modelo intacto (no se toca la cadena).

## Camino de upgrade (futuro — registrado, NO se implementa)

- **Alertas:** un sink/observador que, ante `degraded` repetidos de un componente, notifique (Telegram/correo).
- **Métricas:** agregar `degraded` por `component` para un dashboard de salud.
- **Panel de conversaciones:** mostrar los `degraded` inline en el timeline del turno (ya quedan en `trace_events`).
