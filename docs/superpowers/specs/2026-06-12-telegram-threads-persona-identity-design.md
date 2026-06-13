# Diseño técnico — Telegram: hilos, persona, identidad/owner (2026-06-12)

Spec **técnico** (bajo nivel) del refinamiento del canal Telegram. Plan de alto nivel + estrategia de
ejecución → [`…-telegram-threads-persona-identity-plan.md`](2026-06-12-telegram-threads-persona-identity-plan.md).
Extiende el canal de [`…-stateful-channels-telegram-design.md`](2026-06-12-stateful-channels-telegram-design.md).

## 1. Hilos (forum topics) → conversación + ventana de contexto por hilo
Telegram soporta **forum topics en chats privados de bots** (`message_thread_id`, `has_topics_enabled`,
`is_topic_message` "…or a private chat with the bot"; confirmado en context7/doc oficial). `sendMessage`
y `sendChatAction` aceptan `message_thread_id`.

- `adapters/telegram/normalize.ts`:
  - `TelegramUpdate.message.message_thread_id?: number`.
  - `NormalizeResult` (`kind:"turn"`) gana `threadId?: number` (sólo si vino en un topic).
  - `conversationKeyFor(chatId, threadId?) → threadId === undefined ? String(chatId) : `${chatId}:${threadId}``.
- `adapters/telegram/routes.ts`: `conversationKey = conversationKeyFor(norm.chatId, norm.threadId)`;
  pasa `{ messageThreadId: norm.threadId }` a `sendChatAction`/`sendMessage` (responder DENTRO del topic).
- `adapters/telegram/client.ts`: `SendOpts { messageThreadId?: number }`; `sendMessage`/`sendChatAction`
  agregan `message_thread_id` al body si está.
- **Sin cambios en core/db**: la unique `(channel, threadKey)` (`schema.ts`) ya distingue cada
  `chatId:threadId` → conversación propia → su `summary`+`recent` → **ventana de contexto por hilo gratis**.
- **Edge/backward-compat**: DM sin topics → `threadId` undefined → clave = `chatId` (igual que antes).

## 2. Persona (nombre + voseo valluno)
- `core/prompt.ts`: la primera línea pasó de `"Sos Vaio, …"` (el modelo leía "Sos" como apellido) a
  **`"Tu nombre es Vaio. Sos el agente personal…"`**. Se agregó origen: **caleño, oriundo de Palmira
  (palmireño) → voseo valluno + muletillas (mirá, ve, ¿sí o qué?, bacano, qué nota) MEDIDAS**. EN: fija
  `"Your name is Vaio."` + nota de voseo al hablar español.

## 3. Formato HTML (con fallback)
- Política de formato (channel-specific) en `core/capabilities.ts` (`TELEGRAM_FORMAT`, anexado a AMBAS
  policies de Telegram): responder en **HTML de Telegram** sólo con `<b> <i> <u> <s> <code> <pre> <a href>`,
  escapando `< > &`. (Web NO lleva HTML de TG.)
- `client.ts`: `sendMessage` manda `parse_mode: "HTML"`. El helper `call` ahora devuelve `boolean` (ok).
  Si el envío HTML da **no-2xx** → **se reenvía la misma parte sin `parse_mode`** (texto plano). Nunca rompe.
- **Edge conocido**: el corte a 4096 puede partir un tag → 400 → cae a plano (aceptable; mejora futura).

## 4. Identidad de usuario + gating por owner
- `config.ts`: `OWNER_TELEGRAM_ID: z.coerce.number().int().optional()`.
- `adapters/telegram/normalize.ts`: `isOwnerId(ownerId, fromId) = ownerId !== undefined && fromId === ownerId`.
- `adapters/telegram/routes.ts`: `TelegramDeps.ownerId?: number`; `trusted = isOwnerId(deps.ownerId, norm.fromId)`
  (antes era `true` fijo). `index.ts` inyecta `ownerId: env.OWNER_TELEGRAM_ID` (+ warn si falta).
- `core/agent.ts`: deriva `audience: "owner" | "visitor" | "public"` (telegram+trusted→owner,
  telegram+!trusted→visitor, web→public) y lo pasa a `buildSystemPrompt`.
- `core/prompt.ts`: `type Audience`; `buildSystemPrompt` gana `audience` (requerido) → `identityBlock`
  localizado: owner = "hablás con Kevin en persona"; visitor = "NO es Kevin → presentá a Kevin, sin
  acciones reservadas"; public = "" (lo cubre `WEB_POLICY`). Orden final: persona · identidad · policy · resumen.
- `core/capabilities.ts`: el perfil **no-owner de Telegram** dejó de ser defensivo-mudo → ahora
  **`allowedTools: ["searchMemory"]`, `sources: PUBLIC_SOURCES`, `maxK: 6`** + policy "carta de
  presentación" (puede contar de Kevin con info pública). El owner mantiene `maxK: 8` + tono agéntico.
- Esto **prepara el terreno** del RBAC por-usuario: el `CapabilityResolver` ya gatea tools/scope por
  `trusted` (seam documentado en `capabilities.ts`).

## Tests (TDD)
`test/telegram.test.ts`: `threadId` presente/ausente; `conversationKeyFor`; `isOwnerId`; cliente
(parse_mode HTML + fallback a plano ante 400; `message_thread_id` en el body). `test/prompt.test.ts`:
persona ES con nombre desambiguado + Palmira; `buildSystemPrompt({audience})` (owner/visitor/public,
ES/EN). `test/capabilities.test.ts`: no-owner = searchMemory público + "NO es Kevin"; ambas policies TG
piden HTML. **Total: 75 tests del agente + 20 del paquete compress, verdes.**

## Seam futuro (no implementado)
`sendMessageDraft` (descubierto en la doc): **streaming nativo efímero** (preview de 30s; al finalizar
hay que llamar `sendMessage` con el texto completo). Opción a futuro para respuestas en vivo en Telegram.
