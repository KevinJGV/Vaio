# Diseño técnico — Streaming/typing en Telegram

> **Altitud:** spec técnico (firmas, flujo, edge-cases). Plan de alto nivel + estrategia →
> [`2026-06-15-telegram-streaming-plan.md`](2026-06-15-telegram-streaming-plan.md). Construye sobre el canal
> Telegram ([`2026-06-12-stateful-channels-telegram-design.md`](2026-06-12-stateful-channels-telegram-design.md)).

## Objetivo
Que Vaio **streamee** su respuesta por Telegram en vez de mandarla de golpe al final. Hoy `handleTurn`
(`telegram/routes.ts:72`) hace `sendChatAction("typing")` UNA vez → `await text` → `sendMessage(completo)`. El
`respond()` del core ya devuelve `{ stream: ReadableStream<Uint8Array>, text: Promise<string> }` (el web lo
streamea; Telegram lo ignora).

## API de Telegram (verificada con context7, doc oficial)
- `sendChatAction("typing")`: estado **≤5 s**, se borra al llegar un mensaje → para mantenerlo hay que
  re-enviarlo cada ~4 s.
- **`sendMessageDraft`**: stremea texto **parcial en vivo** (preview efímero ~30 s, animado por `draft_id`; text
  vacío = "Thinking…"). **Solo chats PRIVADOS.** Al terminar **HAY QUE** `sendMessage(completo)` para persistir.
  Soporta `parse_mode`. Método nuevo/posible-beta → tratar como best-effort (degradar si el bot no lo soporta).

## Cambios

### `telegram/client.ts`
`TelegramClient` += método (reusa el helper `call` que ya devuelve boolean):
```ts
sendMessageDraft(
  chatId: number,
  draftId: number,
  text: string,           // PLANO (sin parse_mode); capeado a ≤4096 por el llamador
  opts?: SendOpts
): Promise<boolean>        // false en no-2xx → el llamador degrada a typing
// body: { chat_id, draft_id: draftId, text } (sin message_thread_id — draft es privado). Token nunca logueado.
```

### `telegram/normalize.ts`
- `TelegramUpdate.message.chat` += `type?: string`.
- El resultado `kind:"turn"` += `isPrivate: boolean` (= `msg.chat.type === "private"`).

### `telegram/stream-draft.ts` (nuevo — pump+throttle, testeable)
```ts
// Consume el ReadableStream del core, acumula texto (UTF-8) y llama onUpdate(parcial) THROTTLEADO. Devuelve el
// texto final. `now` inyectable para testear la cadencia sin reloj real.
export async function pumpStream(
  stream: ReadableStream<Uint8Array>,
  onUpdate: (partial: string) => void | Promise<void>,
  opts?: { throttleMs?: number; now?: () => number }
): Promise<string>
```
- Lee con `getReader()` + `TextDecoder`. Acumula. Llama `onUpdate` la 1ª vez y luego a lo sumo cada `throttleMs`
  (default 700). SIEMPRE llama `onUpdate` con el texto final al cerrar (último parcial). `onUpdate` best-effort
  (un fallo no corta el pump).

### `telegram/routes.ts` (`handleTurn`)
Reestructura (degradando siempre):
```
download media → req → { stream, text } = respond(...)
wantsVoice = …(como hoy, conocido por la entrada)
draft = deps.draftStreaming && norm.isPrivate && !wantsVoice
reply: string
if (draft) {
  const draftId = norm.updateId                 // entero no-cero por turno
  const ok0 = await client.sendMessageDraft(chatId, draftId, "")   // probe + "Thinking…"
  if (ok0) {
    let alive = true
    reply = await pumpStream(stream, async (p) => {
      if (!alive) return
      const sent = await client.sendMessageDraft(chatId, draftId, p.slice(0, 4096))
      if (!sent) alive = false                   // dejó de soportar → no más drafts (no rompe)
    })
  } else {
    reply = await withTypingKeepalive(() => text)   // probe falló → typing
  }
} else {
  reply = await withTypingKeepalive(() => text)     // grupos/topics o voz → typing keepalive
}
// voz: si wantsVoice → synthesize + sendAudio (si ok return)  [igual que hoy]
await client.sendMessage(chatId, reply, send)        // persiste el final (HTML+fallback, split 4096)
```
- `withTypingKeepalive(fn)`: `sendChatAction("typing")` inmediato + `setInterval` cada 4 s; corre `fn`; en
  `finally` limpia el intervalo. Helper local en `routes.ts`.
- El `pumpStream` consume el `stream` → el `text` Promise del core resuelve igual (lo maneja el pump); usamos el
  retorno del pump como `reply`.

### `config.ts` + `.env.example`
`TELEGRAM_DRAFT_STREAMING` (`z.string().optional().transform(v => v !== "false" && v !== "0")`, default ON).
Wiring (`index.ts`): pasar a `TelegramDeps.draftStreaming` (boolean) → `handleTurn`.

## Edge-cases
- **Draft no soportado** (probe false) → typing keepalive + mensaje final. Resultado ≥ hoy.
- **Draft falla a mitad** (sent false) → se dejan de mandar drafts; el pump sigue acumulando; mensaje final sale igual.
- **Grupos/topics** (`!isPrivate`) → typing keepalive (draft es privado-only).
- **Reply de voz** → sin draft (la salida es audio); typing keepalive + `sendAudio`.
- **Texto > 4096** → draft muestra los primeros 4096 (preview); el `sendMessage` final trocea completo (ya existe).
- **HTML** → drafts en PLANO (un HTML a medias rompe el parseo); el final en HTML con fallback (ya existe).
- **Sin `deps.agent`** (sin OpenRouter) → cortesía directa (rama actual, antes del stream).
- **Error en el turno** → catch → cortesía (rama actual). El draft efímero desaparece solo (~30 s).

## Tests
- `client.sendMessageDraft`: body `{chat_id, draft_id, text}`; false en no-2xx.
- `normalize`: `isPrivate` true/false según `chat.type`.
- `pumpStream` (puro, `now` inyectable): chunks → onUpdate 1ª vez + throttle + final; devuelve texto concatenado;
  onUpdate que tira no corta el pump.
- `handleTurn`: (a) privado+texto+probe-ok → ≥1 `sendMessageDraft` + `sendMessage` final; (b) no-privado → typing
  (`sendChatAction`) + `sendMessage`, **0** drafts; (c) probe-false → typing + `sendMessage`; (d) voz → `sendAudio`
  sin drafts. (Mock del `respond` con un `stream` fabricado + `text`.)

## Invariantes
Siempre responde (degrada a typing/cortesía ante cualquier fallo del draft). Token nunca en logs. No cambia el
fallback de modelo/voz/HTML. ports/adapters-lite (el pump es puro; el I/O en el client).
