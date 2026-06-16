# Design (TÉCNICO) — `escalate` + infra de notificación proactiva genérica (Fase 2), v1

> **Plan de alto nivel + estrategia de ejecución:** [`2026-06-16-escalate-owner-notifier-plan.md`](2026-06-16-escalate-owner-notifier-plan.md).
> Este doc = **diseño técnico de bajo nivel** (firmas, DDL, flujo, edge-cases). Norte: `SPEC.md` §Fase 2 +
> memorias `proactive-turns-vision`, `prod-activation-gated-on-portfolio-integration`.

## Problema / norte
Si un visitante (web/Telegram) pregunta algo que Vaio NO sabe de Kevin, hoy degrada o (peor) podría inventar.
`escalate` abre el **canal humano**: Vaio escala la duda a Kevin, Kevin responde, y (a) Vaio **retoma al
visitante** donde haya push, (b) **Kevin —y solo Kevin— decide** si eso se vuelve memoria durable.

Reencuadre (brainstorming Kevin): no es una tool estrecha, es una **capacidad transversal y maleable** — que
Vaio pueda **escribirle proactivamente a Kevin** por el canal que sea (Telegram hoy; WhatsApp/correo mañana)
para CUALQUIER disparador (duda escalada, resultado de rutina/cron, respuesta de webhook). `escalate` es el
**1er consumidor**. Es el 1er consumidor `user-waiting` PERSISTIDO del seam proactivo (≠ `learnRepo` in-process).

## Invariante del feature (de Kevin — pesa sobre el diseño)
**Vaio NUNCA aprende facts por su cuenta de los visitantes.** Todo input de un visitante sobre Kevin guía a
**notificar a Kevin**, único gate de la memoria. 3 matices: (1) duda de conocimiento → *potencial* fact (Kevin
cura), (2) pedido de contacto → puro pasamanos, no cura, (3) afirmación del visitante ("yo sé que él…") → Kevin
**valida** antes de almacenar.

## Decisiones (brainstorming Kevin, 2026-06-16)
- Infra `OwnerNotifier` outbound **genérica primero** (kind + payload); 1 adapter (Telegram DM) + 1 consumidor hoy.
- **Persistir desde ya** (tabla `escalations`): la espera humana tarda horas/días, Railway reinicia.
- Correlación **reply-to determinística** (Kevin cita el DM; el sistema casa por `message_id`, Inv #8).
- Retomar al visitante **donde haya push** (Telegram); web cierra vía fact gated. Web sin push = no-op limpio.
- **Curación gated** (corrección post-adversarial): el reply se **entrega**; la curación es acto explícito de
  Kevin por el flujo de facts existente (`rememberFact`/`resolveFact`, 3ª persona, PENDING→commit). Cero auto-cura.

## Seam / infra existente reusada (verificado por Explore)
- Harness de acciones (`core/actions/`): `ActionDescriptor { name, sideEffecting, clearance, build(ctx) }` en
  `registry.ts`; gating 2 capas (`caps.allowedTools` + `clearance`); perfiles en `capabilities.ts`.
- `agent.respond(req, ctx, media?)` (`core/agent.ts`) admite `TurnRequest` sintético (rehidrata por
  `conversationKey` vía `conversations.ensure/loadContext`, persiste solo). `TurnContext = {logger,sink,requestId,resume?}`.
- `ProactiveResume` (`ports/proactive.ts`) + `createTelegramResume` (`adapters/telegram/proactive.ts`): re-entra
  el loop al completar una Promise. **Atado al `req`/`chatId` del turno actual** → hay que generalizar a otra conversación.
- `FactStore.propose/commit/reject/listPending` (`ports/facts.ts`, adapter `neon-facts.ts`); acción `rememberFact` (owner).
- DB Drizzle (`adapters/db/schema.ts`): `conversations` (uniq `(channel,threadKey)`), `messages`, `facts` (bi-temporal),
  `tracked_repos`, `trace_events`. Migraciones `0000..0008`. Patrón puerto+adapter por tabla; wiring en `index.ts`.
- Telegram: webhook `/tg` (`routes.ts`, valida secret, ACK 200, `void handleTurn`), `isOwnerId(ownerId,fromId)`,
  `conversationKeyFor(chatId,threadId)`, `client.sendMessage(chatId,text,{messageThreadId?})` (HTML + fallback),
  `sanitizeTelegramHtml`/`stripTelegramHtml` (`telegram/html.ts`).
- **Gaps:** `normalize.ts` NO lee `reply_to_message`; `sendMessage` devuelve `void` (descarta `message_id`); no hay
  `OwnerNotifier` ni cola de preguntas; el dedupe `seen` de `/tg` es in-memory (se pierde al restart).

## Contratos / firmas

### 1. Puerto `OwnerNotifier` — `ports/owner-notifier.ts` (nuevo)
```ts
// Canal de SALIDA directo: "mandale ESTO a Kevin (owner) por su canal de notificación, proactivamente".
// NO re-entra el agente (eso es ProactiveResume) ni depende de un turno → invocable desde cualquier disparador
// (action, cron, worker, webhook). Devuelve una REFERENCIA opaca para anclar el reply-to. best-effort (Inv #1).
export type OwnerNotifyKind = "escalation" | "routine-result" | "task-done" | "webhook" | "system"
export interface OwnerNotifyInput  { kind: OwnerNotifyKind; text: string; locale?: string; payload?: Record<string, unknown> }
export interface OwnerNotifyResult { delivered: boolean; ref?: string; channelChatId?: string }
export interface OwnerNotifier { notify(input: OwnerNotifyInput): Promise<OwnerNotifyResult> }
```
- 1 sola op (atomicidad mandá+ancla, Inv #9). `ref` opaco string (Telegram `message_id`; WhatsApp `wamid`; correo
  `Message-ID`). Sin owner configurado → `{ delivered:false }`. **Singleton de proceso** (no per-turn).
- Adapter `adapters/telegram/owner-notifier.ts`: `createTelegramOwnerNotifier({ client, ownerChatId, logger })`.
  `notify` → `client.sendMessage(ownerChatId, prefix(kind)+text)` (DM, sin thread) → `{delivered:true, ref:String(message_id), channelChatId:String(ownerChatId)}`.
- Multi-canal futuro (Kevin en WhatsApp **y** Telegram) = `CompositeOwnerNotifier` (patrón de `createCompositeTraceSink`); no cambia la interfaz.

### 2. Tabla `escalations` + `EscalationStore`
DDL (Drizzle en `schema.ts`; migración `0009_*` vía `db:generate`):
```ts
export const escalations = pgTable("escalations", {
  id: uuid("id").defaultRandom().primaryKey(),
  // ORIGEN (para curar + retomar)
  originChannel: text("origin_channel").notNull(),                 // 'web' | 'telegram'
  originConversationId: uuid("origin_conversation_id"),            // FK lógica a conversations.id (nullable: stateless)
  originThreadKey: text("origin_thread_key"),                      // conversationKeyFor → reconstruye chatId/threadId
  askerPrincipalId: text("asker_principal_id").notNull(),          // visitante (telegram user id | "web")
  locale: text("locale").notNull().default("es"),
  // CONTENIDO
  question: text("question").notNull(),                            // duda en NL (saneada al ir al DM)
  answer: text("answer"),                                          // reply de Kevin (nullable hasta answered)
  // CORRELACIÓN (Inv #8)
  notifyChannel: text("notify_channel").notNull(),                 // 'telegram' hoy
  notifyMessageId: text("notify_message_id"),                      // message_id del DM → clave de reply-to
  // ESTADO
  status: text("status").notNull().default("pending"),            // pending|notified|answered|dismissed|failed
  factId: uuid("fact_id"),                                         // linaje si Kevin curó (auditoría)
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
}, (t) => [
  index("escalations_notify_msg_idx").on(t.notifyChannel, t.notifyMessageId),  // correlación O(1)
  index("escalations_status_idx").on(t.status, t.createdAt),                   // pendientes / dedup / huérfanas
])
```
Máquina de estados: `pending` (creada) → `notified` (DM enviado + `notifyMessageId`) → `answered` | `dismissed` |
`failed` (DM no salió; el visitante igual recibió cortesía). Transiciones solo desde el estado previo válido.

Puerto `ports/escalation.ts` (nuevo):
```ts
export interface EscalationOrigin { channel: string; conversationId?: string; threadKey?: string; askerPrincipalId: string; locale: string }
export interface AnsweredEscalation { id: string; question: string; origin: EscalationOrigin }
export interface EscalationStore {
  create(input: { question: string; origin: EscalationOrigin }): Promise<{ id: string }>
  markNotified(id: string, notifyChannel: string, notifyMessageId: string): Promise<void>
  markFailed(id: string): Promise<void>
  findByNotifyMessage(notifyChannel: string, notifyMessageId: string): Promise<AnsweredEscalation | null>  // solo status='notified'
  markAnswered(id: string, answer: string, factId?: string): Promise<boolean>  // UPDATE ... WHERE status='notified' → idempotente
  // anti-spam (v1): dedup + rate-limit
  countPendingByPrincipal(principalId: string): Promise<number>
  findOpenSimilar(principalId: string, question: string): Promise<{ id: string } | null>  // dedup simple (normalizado/substring); semántico = followup
}
```
Adapter `adapters/neon-escalation.ts` (patrón `neon-facts.ts`): inserts/updates condicionales; `markAnswered`
devuelve `rowCount>0` (idempotencia ante reintento de webhook).

### 3. Acción `escalate` — `core/actions/escalate.ts` (nuevo)
```ts
name: "escalate"            // sumar al union ToolName en capabilities.ts
sideEffecting: true
clearance: "anyone"        // la dispara el VISITANTE
inputSchema: z.object({ question: z.string().min(1).describe(
  "La duda concreta del visitante sobre Kevin que NO pudiste responder con tu memoria, reformulada clara y " +
  "autocontenida (3ª persona). SOLO cuando searchMemory no trajo nada útil y es algo que solo Kevin sabe.") })
```
- Perfiles (`capabilities.ts`): exponer en **web** y **untrustedTelegram**; **NO** en `trusted` (Kevin no se escala).
- `execute` (todo lo determinístico del `ctx`, Inv #8):
  1. Guard deps: sin `escalations`/`notifier` → cortesía honesta (Inv #1), no tira.
  2. **Anti-spam:** `countPendingByPrincipal` > `ESCALATE_MAX_PENDING` (def 3) o rate global/hora superado → no
     notificar, degradar cortés. `findOpenSimilar` → adjuntar al existente, no re-crear ni re-notificar.
  3. `create({ question, origin: { channel: ctx.principal.channel, conversationId: ctx.ids.conversationId,
     threadKey: ctx.conversationKey, askerPrincipalId: ctx.principal.id, locale: ctx.locale ?? "es" } })`.
  4. `notify({ kind:"escalation", text: buildDM(question, ctx.principal, locale) })` — `buildDM` **sanea**
     (`sanitizeTelegramHtml`) + delimita visible ("Pregunta de un visitante (texto sin verificar): «…»") + trunca.
  5. `res.ok && res.ref` → `markNotified(id, res.channel, res.ref)` → cortesía al visitante (promete retomo si
     el canal tiene push; honesto si no). `!res.ok` → `markFailed(id)` → cortesía sin prometer.
  - Auto-contenida (Inv #9): un call persiste + notifica + reporta. La cura/retomo los dispara el sistema (inbound).
- Threading: `ActionContext` += `escalations?`, `notifier?`, `conversationKey?`, `locale?`; `buildTools` los pasa.

### 4. Retomo cross-conversation — `adapters/telegram/resume.ts` (nuevo)
NO refactorizar `createTelegramResume` (intenciones distintas, preserva sus tests). Puerto en `ports/proactive.ts`:
```ts
export interface ResumeConversationInput {
  conversationKey: string; channel: Channel; locale?: string
  originalQuestion: string; injectedAnswer: string
  routing?: { chatId?: number; threadId?: number }   // Telegram; web no lo usa (no-op)
}
export interface ConversationResumer { resumeConversation(input: ResumeConversationInput): void }
```
`createTelegramConversationResumer({ agent, client, logger, sink, newRequestId })`:
- Turno sintético dirigido a la conversación del **visitante**: `{ channel, conversationKey, userText: framing(input),
  attachments:[], locale, principalId:"system:escalate-resume", trusted:false }`. Rehidrata sola por `conversationKey`.
- `framing` = nota del sistema en `userText`: *"El visitante había preguntado: «{originalQuestion}». Kevin (owner)
  respondió: «{injectedAnswer}». Transmitiselo en TU voz, sin inventar nada más. No menciones que escalaste."*
- `agent.respond(synthetic, { logger, sink, requestId, resume:null, toolDenylist:["escalate"] })` → **anti-loop**
  (no re-escala). `await text` → `client.sendMessage(routing.chatId, answer, { messageThreadId? })`.
- Web (sin `routing.chatId`) → no-op limpio (cierra vía fact gated).
- `TurnContext` += `toolDenylist?: ToolName[]`; en `buildTools` se resta de `caps.allowedTools` (gating de 2 capas).

### 5. Inbound — correlación del reply de Kevin
- `normalize.ts`: declarar `reply_to_message?: { message_id: number }` en el tipo del update; exponer
  `replyToMessageId?: number` en el resultado `turn` (aditivo, backward-compatible).
- `adapters/telegram/escalation-inbound.ts` (nuevo) `tryHandleEscalationReply(deps, norm): Promise<boolean>`:
  matchea SOLO si `isOwnerId` + `replyToMessageId` + `findByNotifyMessage("telegram", String(replyToMessageId))`.
  Si matchea (consume el update, no es turno nuevo): `markAnswered(id, norm.text)` (idempotente; si false → ya
  procesado, return) → `resumeConversation({ ...esc.origin → routing, originalQuestion: esc.question,
  injectedAnswer: norm.text })` → confirma a Kevin (corto "✅") + **invita a curar** ("si querés que recuerde algo
  de esto, decímelo"). Si NO matchea → `false` (sigue `handleTurn` normal).
- `routes.ts` `/tg`: tras el dedupe por `update_id`, antes de `void handleTurn(...)`:
  `if (await tryHandleEscalationReply(...)) { return ack }`.
- **Curación = camino conversacional existente.** El inbound NO cura. Si Kevin decide recordar, su próximo mensaje
  (turno normal del owner) usa `rememberFact`/`resolveFact` (ya en main). Cero auto-cura. Refinamiento futuro: que
  Vaio proponga el statement reescrito proactivamente.

### Cambio de soporte — `adapters/telegram/client.ts`
`sendMessage` devuelve `Promise<number | undefined>` (message_id del **1er** chunk enviado; el ancla del reply-to)
y `call()` retorna el JSON parseado (`result.message_id`). Backward-compatible (los callers ignoran el retorno →
verificar con `pnpm -r typecheck`). Evita duplicar una 2ª ruta de envío.

### Wiring — `index.ts`
Reusar un único `TelegramClient`. Si DB + `TELEGRAM_BOT_TOKEN` + `OWNER_TELEGRAM_ID`: construir `ownerNotifier`,
`escalations` (`createEscalationStore(db)`), `conversationResumer` singletons; inyectar a `createAgent({…, ownerNotifier})`
y a `TelegramDeps` (`escalations`, `conversationResumer`). Log boot `escalate: <bool>`. Sin envs nuevas (reusa
`OWNER_TELEGRAM_ID`/`TELEGRAM_BOT_TOKEN`/`DATABASE_URL`); `ESCALATE_MAX_PENDING` opcional con default. `AgentDeps` += `ownerNotifier?`.

## Edge cases / invariantes (del análisis adversarial)
- **Auto-curar el reply = corrupción/fuga (resuelto):** entrega ≠ curación; nada entra a memoria sin el gate de
  Kevin (3ª persona, PENDING→commit por el flujo existente). Inv #5 + invariante del feature.
- **Reply sin cita / a id desconocido / a escalada ya resuelta:** `findByNotifyMessage` (solo `notified`) → null →
  se trata como turno normal de Kevin. Fallback visible (Inv #8), nunca adivinar.
- **Idempotencia:** Telegram reintenta webhooks y `seen` es in-memory → `markAnswered` por UPDATE condicional
  (`WHERE status='notified'`) es el guard real (no `seen`). Evita doble fact / doble retomo.
- **Spam al DM (público):** rate-limit por `principalId` + global + dedup `findOpenSimilar`. Superado → cortesía sin notificar.
- **Prompt-injection en `question`:** dato, no instrucción → sanear + delimitar + truncar antes del DM. Al curar, el
  statement lo redacta Kevin, no se copia el texto del visitante.
- **Degradación (Inv #1):** sin owner/notifier/DB o DM caído → el visitante siempre recibe cortesía honesta; estado
  `failed`/solo-persistido (no mentir "le avisé"). Nunca 500.
- **Retomo tardío / visitante ausente / topic:** framing autoexplicativo ("Sobre lo que preguntaste antes — «…» —
  ya lo averigüé: …"); `conversationKey` con threadId si nació en topic. best-effort, no tira.
- **Huérfanas:** `pending`/`notified` sin respuesta viven en DB; reconciliación al boot = no destructiva (siguen
  correlacionables por `notifyMessageId`). Recordatorio/expiración (cron) = followup (el schema ya lo soporta).

## Testing (TDD)
- `neon-escalation`: CRUD; `markAnswered` idempotente (2ª llamada → false); `findByNotifyMessage` solo `notified`.
- `telegram-owner-notifier`: `notify` → sendMessage al ownerChatId + `ref` = message_id; sin owner → `{delivered:false}`.
- `escalate` action: gating (aparece en web/untrusted, no en owner; deny path); execute (create→notify→markNotified→
  cortesía; rama `failed`; deps ausentes → cortesía); anti-spam (max pending / dedup → no re-notifica); saneo del DM.
- `resume` cross-conversation: synthetic dirigido a `conversationKey` del visitante + `resume:null` +
  `toolDenylist:["escalate"]` + sendMessage al chat del visitante; web (sin routing) → no-op.
- `normalize`: reply → `replyToMessageId`. `escalation-inbound`: match→answered+resume; no-match→false (handleTurn);
  idempotencia (2º reply → no re-procesa).

## Activación en prod (gated)
Migración a prod por `db:migrate` (release step), NO `db:push`. Activación gated por la integración del portafolio
(memoria `prod-activation-gated-on-portfolio-integration`): local + branch Neon dev primero.
