# Diseño técnico — `updateVisitor` (owner → visitante) + gating contextual de tools

> Par: [`-plan.md`](2026-06-18-update-visitor-plan.md). Sigue a Inc 2 (hilo consciente de su razón),
> mismo branch `feat/fact-lifecycle-inc2`. Cierra el bucle de escalación con el camino de vuelta.

## Problema

Tras una escalada, el visitante recibe la respuesta de Kevin (retomo de `escalate`). Si después Kevin
**corrige** ese hecho en el hilo (Inc 2: `unlearnFact(thisThread)` + `rememberFact`), el visitante
queda con info vieja — y hoy no hay forma de avisarle. Falta el camino **owner → visitante** para
**actualizaciones posteriores** (el inbound solo retoma UNA vez, en notified→answered).

## Objetivo

Una tool `updateVisitor` (owner-only), **hermana de `escalate`** (que es visitante→owner): el owner,
en un hilo de escalada resuelta, corrige un dato → Vaio le avisa la actualización al visitante en su
voz. **Automática** (sin pedir permiso, coherente con `escalate`), con **veto del owner en 2 capas**
(la petición del owner siempre gana). Como esta tool solo tiene sentido EN el hilo, se introduce un
**eje de gating contextual** reusable: la tool ni se instancia fuera de su circunstancia.

## Componentes

### 1. Gating contextual (nuevo eje del harness, reusable)
`core/actions/types.ts` + `core/actions/registry.ts`.
- `ActionDescriptor` gana `available?(ctx: ActionContext): boolean` (default: siempre disponible).
- En `buildTools`, por cada acción el orden es: **(a) canal** (`∈ caps.allowedTools`) → **(b) contexto**
  (`available(ctx) !== false`) → **(c) clearance** (owner). Si falla (a) o (b): la tool se **OMITE por
  completo** (el modelo NO la ve, ni como `deniedTool`). Si pasa (a)+(b) pero falla (c): `deniedTool`
  (seam HITL existente).
- Es la "lógica de instanciación según circunstancia" pedida; `updateVisitor` es su 1er consumidor.
  *(El refactor mayor — prosa de policy coherente con el toolset — es followup aparte en NEXT-STEPS.)*

### 2. Tool `updateVisitor`
`core/actions/update-visitor.ts` (nuevo). `clearance: "owner"`, `sideEffecting: true`,
`available: (ctx) => ctx.threadOrigin != null`.
- Input: `{ message: string }` — la actualización para el visitante en lenguaje natural (el modelo la
  compone). `.describe()` abstracto (Inv #2), instruye: "el dato ya se le había transmitido; pasá la
  actualización; NO la llames si el owner pidió no avisar".
- `execute`:
  1. **Backstop veto** (capa 2): si `ctx.userText` matchea `VISITOR_VETO_RE` (es/en) → no push, emite
     visible "No le avisé al visitante (me pediste que no)".
  2. Si no hay `ctx.threadOrigin?.visitor` o no hay `ctx.conversationResumer` → degrada honesto
     (visitante sin canal con push / no configurado).
  3. `ctx.conversationResumer.resumeConversation({ conversationKey: visitor.conversationKey,
     channel: visitor.channel, locale: visitor.locale, originalQuestion: threadOrigin.question,
     injectedAnswer: message, kind: "update" })`.
  4. Reporta `delivered` honesto ("Se lo actualicé al visitante." / "Anotado, pero el visitante no está
     accesible para avisarle en vivo.").
- **Capa 1 del veto** = el modelo no la llama si el owner pide no avisar (descripción + nota del hilo).

### 3. Origen del visitante en `ThreadOrigin`
`ports/escalation.ts` + `adapters/neon-escalation.ts`.
- `ThreadOrigin` gana `visitor?: { channel: string; conversationKey: string; locale: string }`.
- `findResolvedByTopic` agrega al SELECT `originChannel`, `originThreadKey`, `locale`; arma `visitor` si
  hay `originThreadKey` (sin él — web stateless — `visitor` queda undefined → updateVisitor degrada).

### 4. `ConversationResumer` con framing de actualización
`ports/proactive.ts` + `adapters/telegram/resume.ts`.
- `ResumeConversationInput` gana `kind?: "answer" | "update"` (default "answer").
- `framing()` ramifica: `update` → "Antes le dijiste al visitante algo sobre «{originalQuestion}». Kevin
  lo ACTUALIZÓ: «{injectedAnswer}». Avisale la corrección en TU voz, natural, sin mencionar el
  mecanismo." (es/en). Sin sujetos hardcodeados (Inv #2).
- El resumer Telegram **parsea el routing desde `conversationKey`** si no se pasa `routing` (mueve la
  lógica de `parseTelegramKey`), para que el core (updateVisitor) no toque el formato de keys. Web (key
  = uuid) → no parsea chatId → no-op limpio (delivered:false).

### 5. Threading (server-side, sin tocar el wire)
`core/agent.ts` + `adapters/telegram/routes.ts`.
- `TurnContext` gana `conversationResumer?: ConversationResumer | null` (per-turn, como `resume`/
  `threadOrigin`). Evita el circular resumer↔agent: lo crea el adapter Telegram (que tiene el `agent`).
- `ActionContext` gana `conversationResumer?: ConversationResumer | null` y `userText?: string`.
- `agent.respond`: pasa `ctx.conversationResumer` y `userText` (el `derivedText` del turno) a `buildTools`.
- `handleTurn` (Telegram): crea `createTelegramConversationResumer({agent, client, logger, sink, newRequestId})`
  y lo pasa en el `TurnContext`. (Hoy ya se crea uno igual en el inbound; mismo patrón.)

## Veto — `VISITOR_VETO_RE`
`/\bno\s+(le\s+|lo\s+|les\s+)?(avis|notif|comuniq|cuent|dig|transmit|coment)/i` +
`/\b(don'?t|do not|no need to)\s+(notify|tell|message|ping|update|inform)/i`. Aplica sobre
`ctx.userText`. Capa 2 (backstop); la capa 1 es el modelo.

## Edge cases
- No es un hilo resuelto → `available` false → la tool ni existe (el modelo no la ve).
- Visitante web / sin `threadKey` → `visitor` undefined → degrada honesto.
- Sin `conversationResumer` (canal sin push) → degrada honesto.
- Veto del owner → capa 1 (modelo no llama) + capa 2 (backstop regex).
- El turno sintético del visitante corre audience=visitor (trusted:false) → `updateVisitor` (owner-only)
  no se le instancia → sin loop. `resume:null` + `toolDenylist:["escalate"]` ya en el resumer.
- `linkFact` ancla solo el 1er fact (Inc 1) → la actualización es del tema del hilo; el `message` lo
  compone el modelo con el contexto de la charla, no atado a un único factId.

## Archivos
- `core/actions/types.ts` — `available?` en ActionDescriptor; `conversationResumer`/`userText` en ActionContext.
- `core/actions/registry.ts` — aplicar `available(ctx)` en el gating.
- `core/actions/update-visitor.ts` — NUEVA tool.
- `core/actions/<lista de ACTIONS>` — registrar updateVisitor.
- `ports/escalation.ts` — `ThreadOrigin.visitor`.
- `adapters/neon-escalation.ts` — `findResolvedByTopic` trae el origen del visitante.
- `ports/proactive.ts` — `kind` en ResumeConversationInput.
- `adapters/telegram/resume.ts` — framing `update` + parse de routing desde conversationKey.
- `core/agent.ts` — `TurnContext.conversationResumer`; pasar `conversationResumer`+`userText` a buildTools.
- `adapters/telegram/routes.ts` — crear+pasar el resumer en handleTurn.
- `core/capabilities.ts` — sumar `updateVisitor` al perfil owner (allowedTools).

## Tests (TDD)
- `registry`: una acción con `available:()=>false` NO se instancia (ni como deniedTool); `available:()=>true`
  sí; sin `available` → disponible (backward-compat).
- `update-visitor`: con threadOrigin.visitor + resumer fake → llama resumeConversation(kind:"update") y
  reporta delivered; veto en userText → no llama al resumer (visible); sin visitor/resumer → degrada.
- `prompt`/registry: updateVisitor solo aparece con threadOrigin (gating contextual).
- `resume`: framing `update` ≠ `answer`; parse de routing desde conversationKey (telegram vs web).
- wiring Telegram: handleTurn pasa el resumer en el TurnContext.
