# Escalate v2 — Diseño técnico (Incremento 1)

> Bajo nivel (firmas, DDL, edge-cases). Alto nivel (fases/secuencia/estrategia) → `…-escalate-v2-plan.md`.
> Construye sobre `2026-06-16-escalate-owner-notifier-design.md` (v1). Pruebas en vivo de Kevin (2026-06-16).

## Problema

El `escalate` v1 funciona e2e, pero las pruebas en vivo destaparon tres gaps (y un 4º diferido al Inc 2):

1. **Sin hilo por escalada** → el aviso y la respuesta caen en el "lobby" (DM plano). Un 2º mensaje del
   owner ("guardá ese fact") no tiene contexto → Vaio desorientado.
2. **Curación**: Kevin quiere default-por-tipo (gap-de-dato → aprende; contacto → no), gated por él
   (veto/override), 3ª persona, nunca lo sensible, y ver qué se guardó.
3. **"Se lo transmití" debe ser real** (hoy el retomo y la confirmación son fire-and-forget).
4. *(Diferido Inc 2)* guard transversal "dice pero no hace".

## A. Hilo por escalada (Telegram Threaded Mode, Bot API 9.3)

**Hallazgo (context7):** `createForumTopic` vale **en chat privado** con Threaded Mode activo (sin admin;
admin solo en supergrupos). Devuelve `ForumTopic` con `message_thread_id`. Postear en el hilo = `sendMessage`
con `message_thread_id`. Los entrantes traen `message_thread_id` → el bot sabe el hilo. El código ya extrae
`message_thread_id` (`normalize.ts`) y `conversationKeyFor(chatId, threadId)` ya aísla por hilo.

### Cliente — `adapters/telegram/client.ts`
```ts
// En la interfaz TelegramClient:
createForumTopic(chatId: number, name: string): Promise<number | undefined>
// Impl: request("createForumTopic", { chat_id, name: name.slice(0,128) })
//   → lee result.message_thread_id (extender `request` para devolverlo, o un parse local).
//   undefined si !ok (best-effort, Inv #1). name 1–128 chars (límite Bot API).
```
`request()` hoy devuelve `{ ok, messageId }` (lee `result.message_id`). Extender a
`{ ok, messageId?, threadId? }` (leer también `result.message_thread_id`) — aditivo, no rompe callers.

### Puerto — `ports/owner-notifier.ts`
```ts
interface OwnerNotifyInput  { kind; text; locale?; payload?; title?: string }   // + title (nombre del hilo)
interface OwnerNotifyResult { delivered; channel; ref?; topicId?: string; channelChatId? }  // + topicId
```
`title` es el texto del hilo (el consumidor lo pasa; escalate → la pregunta truncada a ~80). El adapter cae
a un default por kind si falta.

### Adapter — `adapters/telegram/owner-notifier.ts`
`notify()`:
1. `const topicId = await client.createForumTopic(ownerChatId, title ?? defaultTitle(kind))`.
2. `sendMessage(ownerChatId, frameOwnerNotification(kind, text), topicId !== undefined ? { messageThreadId: topicId } : {})`.
3. Si `topicId === undefined` (creación falló) → DM plano (sin thread) — degradación (Inv #1).
4. `return { delivered, channel:"telegram", ref:String(messageId), topicId: topicId?String(topicId):undefined, channelChatId }`.

`frameOwnerNotification` se mantiene (el encabezado da contexto al abrir el hilo); con título de hilo nativo
puede simplificarse el cuerpo, pero NO es necesario para v2.

### Schema — `adapters/db/schema.ts`
```ts
// tabla escalations, nueva columna:
notifyTopicId: text("notify_topic_id"),
// nuevo índice:
index("escalations_notify_topic_idx").on(t.notifyChannel, t.notifyTopicId),
```
Migración `0010_*` por `db:generate` → `ALTER TABLE escalations ADD COLUMN notify_topic_id text;` + índice.

### Store — `ports/escalation.ts` + `adapters/neon-escalation.ts`
```ts
markNotified(id, notifyChannel, notifyMessageId, notifyTopicId?): Promise<void>   // persiste topic
findByNotifyTopic(notifyChannel, notifyTopicId): Promise<AnsweredEscalation | null>  // correlación por hilo
```
`findByNotifyTopic` = igual que `findByNotifyMessage` pero `WHERE notify_topic_id = $` (status in
notified|answered). `markNotified` set `notifyTopicId: notifyTopicId ?? null`.

### Inbound — `adapters/telegram/escalation-inbound.ts` + `routes.ts`
Correlación nueva (prioridad): **por topic**. Si el mensaje del owner trae `threadId` →
`findByNotifyTopic("telegram", String(threadId))`. **Fallback**: por reply-to (`findByNotifyMessage`) como hoy.
```ts
const esc =
  (norm.threadId !== undefined && await escalations.findByNotifyTopic("telegram", String(norm.threadId)))
  || (norm.replyToMessageId !== undefined && await escalations.findByNotifyMessage("telegram", String(norm.replyToMessageId)))
  || null
```
`routes.ts`: la rama del inbound se dispara si `isOwnerId(deps.ownerId, fromId)` **y** (`norm.threadId !== undefined`
**o** `norm.replyToMessageId !== undefined`). Kevin responde **dentro del hilo, sin citar** → matchea por topic.

**Edge:** un mensaje del owner en un topic que NO es de escalada (otra conversación con contexto propio) →
`findByNotifyTopic` null → cae al reply-to → null → `false` → turno normal (el topic ya tiene su conversationKey
aislado por `conversationKeyFor`). Sin colisión.

## B. "Se lo transmití real" (retomo verificado)

### Puerto — `ports/proactive.ts`
```ts
interface ConversationResumer {
  resumeConversation(input: ResumeConversationInput): Promise<{ delivered: boolean }>  // era void
}
```
`delivered=false` si web (sin `routing.chatId`) o si el `sendMessage` al visitante falló.

### Adapter — `adapters/telegram/resume.ts`
Hoy lanza el trabajo fire-and-forget. Cambio: `await` el `agent.respond` sintético + el `sendMessage` al
visitante; devolver `{ delivered: ok }`. Web (sin chatId) → `{ delivered: false }` (no-op). Best-effort: un
throw interno → log + `{ delivered: false }` (NUNCA propaga, Inv #1).

### Inbound — `escalation-inbound.ts`
```ts
const { delivered } = await deps.resumer.resumeConversation({ ... })   // await (era void)
// confirmación a Kevin según el resultado REAL:
await client.sendMessage(norm.chatId, ownerConfirmation(delivered, learned), { messageThreadId: norm.threadId })
```
**Orden del webhook (`routes.ts`):** el handler responde **200 primero** y el procesamiento del reply del owner
corre **en background** (`void (async () => { await tryHandleEscalationReply(...) })()`), para que el `await` del
resume no bloquee el ACK ni dispare reintentos de Telegram. (Hoy el inbound se awaitea inline antes del 200 →
cambiar a background tras el ACK.)

## C. Curación default-por-tipo

### Acción — `core/actions/escalate.ts`
```ts
inputSchema: z.object({
  question: z.string().min(1)…,
  kind: z.enum(["knowledge","contact","claim"])   // Inv #8: enum baja cardinalidad
    .describe("knowledge=duda sobre un dato de Kevin · contact=pedido de contacto/recado · claim=afirmación del visitante a validar"),
})
```
El sistema deriva el **default de curación**: `knowledge→learn`, `contact→no`, `claim→propose-validate`.
`escalations.create` persiste `kind`. (Tabla: nueva col `kind text`, migración `0011`.)

### Puerto NUEVO — `ports/fact-drafter.ts`
```ts
interface FactDraftInput  { question: string; ownerAnswer: string; locale: "es" | "en" }
interface FactDraftResult { statement: string | null; reason?: string }
interface FactDrafter { draft(input: FactDraftInput): Promise<FactDraftResult> }
```
`statement` = el fact en **3ª persona** ("A Kevin le gusta la pasta"). `null` si: no-factual (la respuesta no
afirma un dato durable), o **sensible/privado** (números, direcciones, "no le pases…", credenciales) — la
salvaguarda anti-fuga del adversarial. `reason` para log.

### Adapter NUEVO — `adapters/fact-drafter.ts`
`generateObject` (AI SDK v6, structured output) con la cadena de modelos OpenRouter. Prompt: system fija las
reglas (3ª persona, durable, NUNCA lo sensible → null); user = `pregunta + respuesta de Kevin`. Schema zod
`{ shouldLearn: boolean, statement: string|null, reason: string }`. Degrada: si el modelo falla →
`{ statement: null, reason: "drafter-error" }` (Inv #1 — no guarda ante duda). Inv #8: el LLM solo redacta
lenguaje natural; el sistema persiste vía `FactStore`.

### Curación determinística — `escalation-inbound.ts`
Tras el retomo (await), si corresponde aprender:
```ts
const ownerVetoed = /no\s+(lo\s+)?(aprend|guard|recuerd)|no\s+lo\s+guardes/i.test(norm.text)  // heurística ACOTADA de owner
const ownerForced = /guarda(lo)?|agrega(lo)?|record[áa](lo)?|almacen/i.test(norm.text)
const shouldLearn =
  (esc.kind === "knowledge" && !ownerVetoed) || ((esc.kind === "contact" || esc.kind === "claim") && ownerForced)
let factId: string | undefined
if (shouldLearn) {
  const { statement } = await factDrafter.draft({ question: esc.question, ownerAnswer: norm.text, locale })
  if (statement) {
    const { id, conflicts } = await factStore.propose(statement, OWNER_PRINCIPAL_ID, "telegram", esc.origin.conversationId, undefined)
    if (conflicts.length === 0) { await factStore.commit(id); factId = id }   // auto-commit sin conflicto
    else { /* dejar PENDING + flag para avisar a Kevin que resuelva con resolveFact */ }
  }
}
await escalations.markAnswered(esc.id, norm.text, factId)   // ya soporta factId
```
**Ejecución DETERMINÍSTICA del sistema** (no una tool que el modelo decida llamar) → no reintroduce el
"dice pero no hace" (por eso esta pieza no necesita el guard del Inc 2). `OWNER_PRINCIPAL_ID` = el principal id
de facts del owner (reusar el de `rememberFact`).

### Confirmación — `ownerConfirmation(delivered, learned)`
- `delivered + learned(statement)` → "✅ Se lo transmití. Guardé «<statement>»."
- `delivered + !learned` → "✅ Se lo transmití (no guardé nada)."
- `delivered + conflict` → "✅ Se lo transmití. Choca con algo que ya sabía — decime con cuál te quedás." (→ resolveFact)
- `!delivered` → "✅ Anotado (el visitante no está en línea). …" (+ learned igual aplica).
NO promete "borralo" (desaprender = followup).

### Reusos
`FactStore.propose/commit/listPending` (`ports/facts.ts`), `rememberFact`/`resolveFact` para el camino de
conflictos. `markAnswered(id, answer, factId?)` ya existe.

## Wiring — `index.ts`
Construir `factDrafter = createFactDrafter({ model, logger })`; inyectarlo a `TelegramDeps` (que el inbound lo
use). `config.ts`: sin envs nuevas obligatorias. Log boot: `escalateThreaded: <ownerChatId != null>`.

## Edge-cases / invariantes
- **createForumTopic falla** → DM plano (degradación, Inv #1); la escalada queda sin `notifyTopicId` →
  correlación cae al reply-to (sigue funcionando).
- **Idempotencia** (retry de webhook): `markAnswered` (UPDATE WHERE status='notified') ya es el guard. El
  drafter/propose corren **después** del markAnswered exitoso → un retry no re-cura (markAnswered=false → return).
  ⇒ **Orden**: markAnswered primero; solo si devolvió true, retomo + curación.
- **Privacidad (#5)**: el drafter devuelve `null` ante lo sensible; nada del visitante entra a memoria; el dato
  lo aporta el owner.
- **#8**: el modelo solo pasa `kind` (enum) + `question`; topic/correlación/factId los gestiona el sistema.
- **#10**: `escalate` crece por `kind` (param), no hay tool nueva.
- **#4**: topics/HTML/generateObject viven en adapters; el core (escalate) no importa de adapters.

## Followups (NO en este incremento)
- **Inc 2 — guard transversal "dice pero no hace"** (registro de tool calls + firma de promesa + 2º streamText
  forzado vía `prepareStep`/`toolChoice`; toca el hot path).
- **Desaprender facts** (reversibilidad: `invalidAt` vs borrar vs variantes).
- Push al visitante web; expiración de huérfanas; 2º consumidor del notifier con su hilo; WhatsApp/correo.
