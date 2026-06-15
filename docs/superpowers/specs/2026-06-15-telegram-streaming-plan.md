# Streaming/typing en Telegram — Plan de alto nivel

> **For agentic workers:** TDD, commits frecuentes. Diseño técnico (firmas, flujo, edge-cases, tests) →
> [`2026-06-15-telegram-streaming-design.md`](2026-06-15-telegram-streaming-design.md) (NO se repite acá).

**Goal:** que Vaio streamee su respuesta por Telegram — `sendMessageDraft` (texto parcial en vivo) en chats
privados, con `sendChatAction("typing")` en keepalive como fallback (grupos/topics, voz, o draft no soportado).
Degrada siempre (Invariante #1).

## Fases (secuencia con dependencias)
1. **`client.sendMessageDraft`** + tests (body correcto, false en no-2xx). *Independiente.*
2. **`normalize.isPrivate`** + test. *Independiente.*
3. **`pumpStream`** (`telegram/stream-draft.ts`, puro) + tests (throttle con `now` inyectable, texto final,
   onUpdate best-effort). *Independiente.*
4. **Config + wiring** — `TELEGRAM_DRAFT_STREAMING` + `.env.example` + pasar a `TelegramDeps`. *Depende de 0.*
5. **`handleTurn`** reestructurado (camino draft vs typing keepalive, `sendMessage` final) + `withTypingKeepalive`
   helper. *Depende de 1-4.*
6. **Tests de `handleTurn`** (draft / no-privado / probe-false / voz). *Junto con 5.*
7. **Verificación + e2e** — suite + e2e real por Telegram (privado streamea; topic mantiene typing).

## Entregables
- `sendMessageDraft` en el client (best-effort, degrada).
- Streaming en vivo en chats privados; typing keepalive en el resto; mensaje final SIEMPRE persiste.
- Flag `TELEGRAM_DRAFT_STREAMING` (apagable en prod sin redeploy).
- Tests nuevos verdes; suite total sin regresión; fallback de modelo/voz/HTML intacto.

## Estrategia de ejecución (OBLIGATORIA)
**Directo/secuencial (yo-orquestador), NO subagentes.** Justificación: subsistema **acotado** (adapter Telegram:
client + normalize + 1 helper + handleTurn) y acoplado por el flujo de `handleTurn`; el hook de typecheck encadena.
Las fases 1-3 son independientes pero chicas (no rinde paralelizar). La exploración (1 Explore) + la verificación
de la API (context7) ya se hicieron en plan mode; la implementación es directa.

## Verificación
typecheck/biome/test/build limpios + **e2e real por Telegram** (Kevin, tras deploy): privado 1:1 → texto en vivo
(draft) + mensaje final; topic/grupo → "escribiendo…" sostenido + mensaje al final. ⚠️ Confirmar en logs qué
camino tomó (si `sendMessageDraft` no está soportado, degrada a typing). Riesgo conocido: el método es
nuevo/posible-beta → el diseño no depende de él.
