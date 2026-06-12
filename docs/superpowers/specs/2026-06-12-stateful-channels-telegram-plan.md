# Plan (alto nivel) — Iteración 2: núcleo conversacional + arnés + canales + Telegram

> **Artefacto hermano:** el detalle técnico (arquitectura, firmas, DDL, edge-cases) vive en
> [`2026-06-12-stateful-channels-telegram-design.md`](2026-06-12-stateful-channels-telegram-design.md).
> Este plan es de **alto nivel**: *qué* hacer (fases, entregables, secuencia, estrategia de ejecución).
> No repite los reqs técnicos — los referencia por sección del design (p.ej. "design §2").
> **Para ejecutar task-by-task:** `superpowers:executing-plans` (inline) o `subagent-driven-development`.

**Goal:** que Vaio conversе con memoria persistida (no mensajes sueltos) y sea hablable desde un
canal real (Telegram), con capacidades distintas por canal — sin tocar aún el portafolio.

**Arquitectura:** core **stateful** vía puerto `ConversationStore`; canales = adapters entrantes que
normalizan a `TurnRequest`; arnés (system prompt + capacidades + memoria) = módulos **puros** en `core/`.
Honra ports/adapters-lite y el stack ya elegido (AI SDK standalone). Detalle → design.

**Tech stack:** TypeScript ESM · Hono · Vercel AI SDK v6 (`streamText`/`generateText`) · Drizzle+Neon ·
Telegram Bot API (fetch fino, sin dep) · Vitest (`MockLanguageModelV3`) · Biome.

---

## Estrategia de ejecución (subagentes vs orquestador)

**Recomendación: ORQUESTADOR DIRECTO (esta sesión), con un único burst opcional de subagentes.**

**Por qué directo (tamaño grande, pero acoplado y secuencial):**
- El **camino crítico es un refactor central**: `core/agent.ts` cambia de firma (`respond(messages)` →
  `respond(TurnRequest): RespondResult`) y ese cambio **ripplea** por `routes.ts`, el adapter de
  Telegram, el wiring y los tests. Es estado compartido evolutivo (tipos `TurnRequest`/`RespondResult`/
  `ConversationStore`), justo lo que NO conviene paralelizar: subagentes colisionarían sobre `agent.ts`
  y los tipos a medio definir.
- El volumen (~17 archivos) es grande pero las piezas **dependen en cadena** (puertos → arnés → core →
  canales → wiring). El beneficio de subagentes (paralelismo + aislamiento de contexto) casi no aplica
  cuando hay una columna vertebral compartida; el costo de coordinación sí.
- TDD incremental + commits frecuentes en una sola sesión mantiene la coherencia de tipos mejor que
  reintegrar ramas de subagentes.

**Dónde SÍ rendiría un burst de subagentes (opcional, solo si se quiere acelerar):** una vez **congelados
los puertos** (Fase 1), las **hojas independientes** podrían ir en paralelo —
`adapters/telegram/{client,normalize}` (puro), `adapters/neon-conversation`, `adapters/summarizer` —
porque dependen solo de interfaces estables, no del refactor del core. Son 3 tareas chicas e
independientes → `dispatching-parallel-agents`. Dado su tamaño acotado, el ahorro es marginal; se deja
como optimización, no como default.

**Conclusión:** ejecutar directo, en el orden de fases de abajo. Reevaluar a subagentes solo si el
alcance crece (p.ej. sumar varios canales/adapters a la vez en una próxima iteración).

---

## Estado actual (WIP ya presente en la rama)
Ya creados (sin commitear) y a consolidar bajo TDD en las fases 1-2: contratos `Channel`/`TurnRequest`
(design §5); puertos `ConversationStore`/`Summarizer` (design §1, §4); módulos puros `core/{prompt,
capabilities,summary,tools,util}.ts` (design §3-§4). **Falta:** sus tests, el refactor del core, DB +
adapters, Telegram, wiring, verificación. El plan los integra igual (escribir/recuperar tests primero).

---

## Fases (cada una = software testeable + commit atómico)

### Fase 1 — Fundaciones: contratos + puertos  *(design §1, §4, §5)*
- [ ] Confirmar `Channel`/`TurnRequest` en `@vaio/contracts` y los puertos `ConversationStore`
      (con `pendingSummary`) y `Summarizer`. **Entregable:** `pnpm --filter @vaio/contracts build` +
      `pnpm -r typecheck` limpios. Sin lógica todavía → no hay test propio (los tipos los ejercitan las fases que siguen).
- [ ] **Commit:** `feat(contracts): Channel + TurnRequest; ports ConversationStore + Summarizer`.

### Fase 2 — Arnés puro + tests (TDD)  *(design §3, §4)*
- [ ] Tests primero para `prompt` (persona+policy+summary), `capabilities` (perfiles web/telegram +
      seam untrusted), `summary` (`shouldSummarize` + `buildSummaryPrompt`), `tools` (gating + maxK).
- [ ] Implementación mínima de cada módulo hasta verde (gran parte ya está en el WIP → ajustar a los tests).
- [ ] **Verificar:** `pnpm -r test` (suites nuevas verdes) + typecheck. **Commit:** `feat(core): arnés puro (prompt/capabilities/tools/summary) + tests`.

### Fase 3 — Core stateful (el refactor central)  *(design §2)*
- [ ] Fake in-memory `test/fakes/in-memory-conversation.ts` + test de contrato del `ConversationStore`.
- [ ] Refactor `core/agent.ts`: `respond(TurnRequest): Promise<RespondResult{stream,text}>`, carga de
      historial server-side, tee del `textStream`, persistencia+resumen en background (no bloqueante,
      `try/catch`, `turn.error where:"persist"|"summary"`), modo stateless si `conversations===null`.
- [ ] Actualizar `test/agent-loop.test.ts` a la firma nueva (drain del `stream` / `await text`); sumar
      asserts: `appendTurn` llamado 1×; sobre el threshold → `summarize`+`updateSummary`.
- [ ] **Verificar:** `pnpm -r test` + typecheck. **Commit:** `feat(core): respond stateful (TurnRequest + memoria conversacional)`.

### Fase 4 — Persistencia: DB + adapters  *(design §6, §1, §4)*
- [ ] `adapters/db/schema.ts`: tablas `conversations` + `messages` (índices/unique). `db:generate` →
      **inspeccionar `0001_*.sql`** (solo las 2 tablas; `0000` intacto; journal appendeado).
- [ ] `adapters/neon-conversation.ts` (implementa el puerto) y `adapters/summarizer.ts` (`generateText`,
      modelo barato vía OpenRouter). Estos dos son las **hojas paralelizables** (ver Estrategia).
- [ ] **Verificar:** typecheck + build; con `DATABASE_URL`, `db:migrate` aplica limpio (manual).
      **Commit:** `feat(memory): tablas conversations/messages + adapters Neon/summarizer (migración 0001)`.

### Fase 5 — Canal web  *(design §8)*
- [ ] Refactor `POST /chat` a adapter del canal **web** (capped): arma `TurnRequest`, `await respond`,
      passthrough del `stream`. Mantener auth `x-agent-key` y degradación a cortesía.
- [ ] **Verificar:** typecheck + test. **Commit:** `refactor(http): /chat como canal web sobre el core stateful`.

### Fase 6 — Canal Telegram  *(design §8)*
- [ ] `adapters/telegram/normalize.ts` (puro) + test (turn/ignore/allowlist + `detectTelegramLocale`).
- [ ] `adapters/telegram/client.ts` (fetch fino: `sendMessage` con chunking 4096, `sendChatAction`, `setWebhook`).
- [ ] `adapters/telegram/routes.ts` `POST /tg`: secret header, allowlist gate, dedupe `update_id`,
      ack 200 rápido + `void handleTurn` (typing → respond → `await text` → sendMessage; courtesy en catch).
- [ ] **Verificar:** test (normalize) + typecheck. **Commit:** `feat(telegram): canal webhook (/tg) con allowlist + entrega no-streaming`.

### Fase 7 — Config + wiring  *(design §7, §9)*
- [ ] `config.ts`: env `TELEGRAM_*`, `SUMMARY_MODEL`, `SUMMARY_THRESHOLD`, `CONVERSATION_RECENT_LIMIT` +
      helpers `telegramAllowedIds`/`telegramEnabled` (+ casos en `config.test.ts`). `.env.example` documentado.
- [ ] `index.ts`: construir `conversations`/`summarizer`/`capabilities`, inyectar en `createAgent`,
      montar `/tg` solo si `telegramEnabled`, ampliar el boot log (on/off). `buildApp` crece.
- [ ] **Verificar:** `pnpm -r typecheck` + `pnpm exec biome check .` + `pnpm -r test` + `pnpm build`.
      **Commit:** `feat(wiring): inyección de memoria/summarizer/Telegram + config/env`.

### Fase 8 — Verificación e2e + docs  *(design §12 + Verificación)*
- [ ] Correr `pnpm dev`: `/health` 200; `POST /chat` 2× con mismo `conversationId` → contexto previo
      (filas en `messages` / `turn.start.messageCount`>1). Simular update de Telegram por curl (secret
      OK→200; secret malo→401; no allowlisted→200 sin modelo). Fallback: primer modelo malo → cadena.
- [ ] `requesting-code-review` antes de mergear. Reconciliar `SPEC.md` (ruta `/tg`, canales/capacidades,
      tablas), `NEXT-STEPS.md`, `LEARNINGS.md` (gotchas). **Commit/merge** con `finishing-a-development-branch`.

---

## Verificación global (Definition of Done de la iteración)
`pnpm -r typecheck` · `pnpm exec biome check .` · `pnpm -r test` · `pnpm build` limpios; `0001` revisado;
multi-turno real por `/chat`; `/tg` simulado (3 casos); fallback/cortesía intactos; `/health` siempre 200;
sin secrets en el diff; `.env.example` actualizado; SPEC/NEXT-STEPS/LEARNINGS reconciliados.

## Dependencias / secuencia
1 → 2 → 3 son **secuenciales** (el core depende de puertos+arnés). 4 depende de 1 (puertos). 5 y 6
dependen de 3 (core nuevo). 7 depende de 4-6. 8 cierra. Las hojas de la Fase 4 (neon-conversation,
summarizer) y de la 6 (client/normalize) son las únicas candidatas a paralelizar tras congelar puertos.
