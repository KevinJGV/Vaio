# Diseño técnico — Inc 2: hilo consciente de su razón

> Par: [`-plan.md`](2026-06-18-fact-lifecycle-inc2-thread-aware-plan.md) (alto nivel + estrategia de ejecución).
> Cluster: "ciclo de vida del fact". Precede: Inc 1 (juez + atomicidad + desaprender, en `main`).

## Problema

`escalate` abre un hilo nativo (forum topic) en el chat del owner y persiste la escalada en
`escalations`. Kevin responde en el hilo → `tryHandleEscalationReply`
(`adapters/telegram/escalation-inbound.ts`) correlaciona por `notifyTopicId`, marca `answered`, retoma
al visitante y **cura facts** (decompose → juez → commit/supersede), anclando el 1er fact con
`linkFact(escId, factId)` (`neon-escalation.ts:135`).

Dos hechos del código actual definen el gap:
1. `findByNotifyTopic`/`findByNotifyMessage` filtran `status='notified'` → apenas la escalada pasa a
   `answered`, dejan de correlacionar. Los siguientes mensajes del owner en el hilo caen a `handleTurn`
   como turno normal.
2. **El intercambio de la escalada nunca toca `conversations`**: `tryHandleEscalationReply` no llama
   `conversations.ensure/append`; la confirmación al owner sale por `client.sendMessage` directo. Por
   eso el historial del hilo (`conversationKey = "chatId:threadId"`) está **vacío** del origen.

⇒ Si el owner dice "ajustá/olvidá eso" en el hilo, Vaio no tiene el contexto ni sabe a qué fact se
refiere.

## Objetivo

1. **Conciencia del motivo** (objetivo): nota de sistema con el origen del hilo (pregunta del visitante,
   respuesta del owner, fact curado), inyectada **cada turno** del owner en el hilo (stateless).
2. **Ancla determinística por pronombre** (mecanismo, Inv #8): el `factId` ya anclado en la escalada
   habilita "desaprendé ESO" sin que el modelo toque uuids.

## Arquitectura (vertical slice)

`port (lookup) → adapter (JOIN) → TurnContext (threading) → buildSystemPrompt (nota) →
ActionContext + unlearnFact (ancla)`. La nota es texto del sistema (sin ids); el `factId` vive solo
server-side en `ActionContext`.

### Tipo compartido `ThreadOrigin`
En `ports/escalation.ts` (core depende de ports; reutilizado por `agent.ts`, `prompt.ts`,
`actions/types.ts`):
```ts
export interface ThreadOrigin {
  question: string      // la duda del visitante que originó la escalada
  answer: string        // lo que respondió el owner
  statement?: string    // statement del fact curado (linkFact) — para la nota y el ancla
  factId?: string       // uuid del fact anclado — SOLO server-side, NUNCA al modelo (Inv #8)
}
```

### Puerto + adapter
`ports/escalation.ts`:
```ts
/** Inc 2 — conciencia del hilo: la escalada YA RESUELTA (status 'answered') cuyo topic coincide, con su
 *  respuesta y el fact curado. null = el topic no es de una escalada resuelta. NO muta. */
findResolvedByTopic(notifyChannel: string, notifyTopicId: string): Promise<ThreadOrigin | null>
```
`adapters/neon-escalation.ts`: SELECT `escalations` `WHERE notify_channel=? AND notify_topic_id=? AND
status='answered'`, **LEFT JOIN `facts` ON facts.id = escalations.fact_id** para `facts.statement`.
Devuelve `{ question, answer, statement: factStatement ?? undefined, factId: factId ?? undefined }` o
null. Una query, índice `escalations_notify_topic_idx`. Sin migración (todas las columnas existen:
`escalations.fact_id` y `facts.statement`).

### Threading server-side — `TurnContext` (no `TurnRequest`)
`core/agent.ts`: `TurnContext` gana `threadOrigin?: ThreadOrigin | null` (junto a `resume`/`toolDenylist`).
**`TurnRequest` (contrato de wire web↔agent en `@vaio/contracts`) NO se toca** — esto es interno,
derivado por el adapter. En `respond()`:
- a `buildSystemPrompt(...)` → `threadOrigin: ctx.threadOrigin ?? undefined`.
- a `buildTools({...})` → `threadOrigin: ctx.threadOrigin ?? null`.

### Lookup en Telegram — `handleTurn`
`adapters/telegram/routes.ts`: antes de armar el `TurnContext`, si `norm.threadId !== undefined` **y**
`isOwnerId(deps.ownerId, norm.fromId)` **y** `deps.escalations`:
```ts
let threadOrigin: ThreadOrigin | null = null
if (deps.escalations && norm.threadId !== undefined && isOwnerId(deps.ownerId, norm.fromId)) {
  try { threadOrigin = await deps.escalations.findResolvedByTopic("telegram", String(norm.threadId)) }
  catch (err) { log.warn({ err }, "tg: findResolvedByTopic falló (best-effort)") }
}
```
Pasarlo en el `TurnContext` de `deps.agent.respond(req, { ..., threadOrigin })`. Solo corre para el
owner en un hilo (Inv #1 best-effort; cero costo para visitantes).

### Nota de sistema — `buildSystemPrompt`
`core/prompt.ts`: nuevo param `threadOrigin?: ThreadOrigin`. Bloque localizado, framing de **fondo**
(como la nota de frescura, sin dramatizar), sin sujetos hardcodeados (Inv #2: solo interpolación +
scaffolding abstracto), **sin el uuid**. Se agrega al array final (`.filter(Boolean).join("\n\n")`).
Forma (ES; EN análogo):
```
[nota del sistema (contexto de fondo, no lo menciones salvo que el owner lo retome): este hilo nació de
una escalada. Un visitante preguntó «{question}»; le respondiste «{answer}».{ statement ? " De eso
guardé como dato de Kevin: «{statement}». Si el owner pide ajustarlo o desaprenderlo por deixis ("eso",
"lo que aprendiste acá"), se refiere a ESE dato: desaprendé con unlearnFact(thisThread:true) o corregí
con rememberFact." : "" }]
```

### Ancla determinística — `unlearnFact`
`core/actions/types.ts`: `ActionContext` gana `threadOrigin?: ThreadOrigin | null`.
`core/actions/unlearn-fact.ts`: nuevo input `thisThread?: boolean` (Inv #10: param de tool existente).
- `.describe()` abstracto (Inv #2): "true si el owner se refiere por deixis/pronombre ('eso', 'lo que
  se aprendió acá') al dato curado EN ESTE hilo de escalada. El sistema sabe cuál es; no pases ids."
- En `execute`, **antes del recall total**: si `thisThread === true` y `ctx.threadOrigin?.factId`:
  ```ts
  const ok = await factStore.invalidate(ctx.threadOrigin.factId)
  return emit(ok, ok ? `Listo, lo olvidé: «${ctx.threadOrigin.statement ?? "ese dato"}».`
                     : "No pude darlo de baja (quizá ya estaba olvidado).")
  ```
  Inv #8: el modelo pasó un booleano (intención); el sistema mapeó al uuid. El matcher NO se invoca.
- Si `thisThread === true` pero no hay ancla → cae al flujo normal por `about` (fallo visible).

## Edge cases
- Curación con >1 fact → `linkFact` ancla solo el 1º (costura Inc 1). Limitación v1 (linaje multi-fact →
  Fase 3 grafo).
- Curación sin facts (kind contact/claim, veto) → `factId/statement` ausentes: la nota igual da
  conciencia (question/answer); `thisThread` degrada a `about`.
- Sin `escalations` / hilo no-escalada → null → no-op (Inv #1).
- La nota nunca incluye el uuid (solo statement en NL).
- Visitante o turno sin `threadId` → no se hace lookup.
- `findByNotifyTopic` (notified, inbound) y `findResolvedByTopic` (answered, conciencia) son
  ortogonales: un turno entrante ya answered NO matchea el inbound (sigue a `handleTurn`), donde recién
  corre el lookup de conciencia.

## "ajustá eso" (update) — fuera de alcance del ancla
Lo cubre `rememberFact` existente: la nota le da el statement exacto al modelo, lo reformula, el juez ve
la contradicción (mismo tema → coseno la trae) y hace supersede. No se toca el hot path del streaming.
Refinamiento futuro (si un e2e muestra al juez fallando el target): extender el ancla a `rememberFact`.

## Archivos
- `apps/agent/src/ports/escalation.ts` — `ThreadOrigin` + `findResolvedByTopic`.
- `apps/agent/src/adapters/neon-escalation.ts` — impl LEFT JOIN a `facts`.
- `apps/agent/src/core/agent.ts` — `TurnContext.threadOrigin`; pasar a prompt + tools.
- `apps/agent/src/core/prompt.ts` — param + bloque de nota.
- `apps/agent/src/core/actions/types.ts` — `ActionContext.threadOrigin`.
- `apps/agent/src/core/actions/unlearn-fact.ts` — `thisThread` + rama de ancla.
- `apps/agent/src/adapters/telegram/routes.ts` — lookup en `handleTurn`.

## Tests (TDD)
- `prompt.test.ts`: render con/sin `statement`; sin `threadOrigin` no agrega nada; es/en; no contiene el
  factId.
- `facts-actions.test.ts` (unlearnFact): `thisThread:true` + ancla → invalida ESE factId (matcher no
  llamado), confirma con el statement; `thisThread:true` sin ancla → flujo por `about`.
- `neon-escalation` o fake del store: `findResolvedByTopic` devuelve question/answer/statement de una
  answered; null si notified/inexistente (patrón de los tests de escalación existentes).
- Wiring Telegram (estilo tests de `routes`/inbound): owner en hilo answered → `threadOrigin` llega al
  `respond`; visitante o sin `threadId` → no lookup.
