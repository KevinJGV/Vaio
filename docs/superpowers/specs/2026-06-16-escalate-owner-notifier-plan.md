# Plan (ALTO NIVEL) — `escalate` + infra de notificación proactiva genérica (Fase 2), v1

> **Diseño técnico (firmas, DDL, flujo, edge-cases):** [`2026-06-16-escalate-owner-notifier-design.md`](2026-06-16-escalate-owner-notifier-design.md).
> Este doc = **qué hacer** (fases, secuencia, dependencias, verificación macro) + **Estrategia de ejecución**.

## Objetivo
Construir el **canal de notificación proactiva al owner** (`OwnerNotifier`, genérico/maleable) y su 1er
consumidor **`escalate`**: cuando un visitante pregunta algo que Vaio no sabe de Kevin → escala a su DM →
Kevin responde citando → Vaio retoma al visitante (donde haya push) + Kevin decide curar el fact. Persistido
(sobrevive restart), correlación reply-to determinística, curación 100% gated por Kevin.

## Fases (secuenciales — cadena acoplada puerto→schema→adapter→acción→resume→inbound→wiring)
1. **F1 — Puertos + schema + migración.** `ports/owner-notifier.ts`, `ports/escalation.ts`; tabla `escalations`
   en `schema.ts`; extender `ActionContext`/`AgentDeps`/`TurnContext` (opcionales/null → no rompe); `db:generate`
   → `0009`. **Entregable:** typecheck verde; migración generada (a branch Neon dev con `db:push`, NO prod).
2. **F2 — Adapters (TDD).** `adapters/neon-escalation.ts`, `adapters/telegram/owner-notifier.ts`; `sendMessage`
   → `message_id` en `client.ts`. Tests del store (CRUD + idempotencia) ANTES de la impl.
3. **F3 — Acción `escalate` (TDD).** action + registry + `ToolName` + perfiles web/untrusted en `capabilities.ts`
   + threading en `agent.ts` + anti-spam (rate-limit/dedup) + saneo del DM. Tests de gating + execute.
4. **F4 — Retomo cross-conversation (TDD).** `adapters/telegram/resume.ts` (`ConversationResumer`) +
   `TurnContext.toolDenylist` restado en `buildTools`. Tests de proactive existentes verdes (sin regresión).
5. **F5 — Inbound (TDD).** `reply_to` en `normalize.ts` + `escalation-inbound.ts` + rama en `routes.ts` antes de
   `handleTurn` + `TelegramDeps`. Tests: normalize, match/no-match, idempotencia ante retry.
6. **F6 — Wiring + E2E.** `index.ts` singletons (reusar 1 `TelegramClient`) + log boot. DoD + reconciliar NEXT-STEPS.

## Dependencias
- Reusa: harness de acciones + gating 2 capas, `FactStore`/`rememberFact` (curación), `agent.respond` (re-entrada
  sintética + rehidratación por `conversationKey`), `ProactiveResume` (familia), `TelegramClient`/`normalize`/
  `html.ts` (saneo), `conversations`/`messages` (threading), patrón puerto+adapter+migración, wiring de `index.ts`.
- Nuevo: tabla `escalations` + 2 puertos + 2 adapters + 1 acción + `resume.ts` + `escalation-inbound.ts` + parseo
  reply + retorno de `sendMessage`.
- F1 habilita el resto (firmas de puertos). F3 depende de F1/F2. F5 depende de F2 (store) + F4 (resumer). F6 cablea todo.

## Verificación macro
1. `pnpm -r typecheck` + `pnpm exec biome check .` + `pnpm -r test` limpios en cada fase.
2. **TDD** por fase (ver design §Testing): store idempotente, gating del action, anti-spam, resumer dirigido +
   anti-loop (`resume:null` + `toolDenylist`), inbound match/no-match/idempotencia.
3. **E2E en vivo** (F6, local + ngrok + `OWNER_TELEGRAM_ID`): 2º Telegram (no-owner) pregunta algo no-sabido →
   `escalate` → DM al owner → owner responde citando → retomo al visitante en su hilo con la respuesta en voz de
   Vaio. Verificar: idempotencia (no doble retomo), reply normal de Kevin (sin citar) sigue siendo turno normal,
   y que NADA se curó sin la confirmación de Kevin. Fallback: sin owner/notifier → degrada honesto, escalada persistida.
4. **Prod gated** por integración del portafolio (`db:migrate` en release, no `db:push`).

## Estrategia de ejecución
**Directo/orquestador — NO subagentes para implementar.** Cadena acoplada por el árbol de tipos compartido
(`ActionContext`/`AgentDeps`/`ToolName`/`TelegramDeps`) + el hook `PostToolUse(typecheck)` serializa los edits →
subagentes en paralelo se pisarían (anti-patrón ya vivido). Dependencias estrictamente lineales; tamaño mediano
(~8 archivos nuevos, ~10 tocados, todos chicos siguiendo patrones existentes — `learn-repo`, `neon-facts`,
`telegram/proactive`). **El DISEÑO sí se hizo con 3 Plan agents en paralelo** (arquitectura + adversarial + infra),
decisión visible — el adversarial atrapó el riesgo de auto-curar facts (corrupción/fuga) que reencuadró la
curación a gated. Red de seguridad en impl = TDD por fase + no-regresión. Antes de mergear:
`superpowers:requesting-code-review`.

## Docs al cerrar
- `NEXT-STEPS.md`: WIP `- [?]` por fase hasta el e2e de Kevin; al verificar → Historial. `SPEC.md` §Fase 2 (ruta
  `/tg` reply-inbound + tool `escalate` + `OwnerNotifier`).
- Memoria nueva del feature (`escalate-owner-notifier-vision`/`-decisions`): el reencuadre (infra proactiva
  genérica), el invariante "Vaio no aprende facts de visitantes" y la curación gated. Linkear `proactive-turns-vision`.
- Followups explícitos: push proactivo al visitante en web (pedir contacto → política de datos), recordatorio/
  expiración de huérfanas (cron), persistencia del dedupe `seen`, que Vaio **proponga** el statement de fact
  reescrito, 2º consumidor del notifier (rutina/cron/webhook), adapters WhatsApp/correo.
