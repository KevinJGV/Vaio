# Escalate v2 — Plan de alto nivel (Incremento 1)

> Qué hacer (fases, entregables, secuencia, dependencias) + Estrategia de ejecución. El **cómo** técnico
> (firmas, DDL, edge-cases) → [`…-escalate-v2-design.md`](2026-06-16-escalate-v2-design.md). No se duplica.

## Objetivo

Pulir `escalate` con lo que destaparon las pruebas en vivo de Kevin (2026-06-16): **hilos nativos por
escalada** (Telegram Threaded Mode), **curación default-por-tipo** (gated por Kevin, 3ª persona, nunca lo
sensible) y **"se lo transmití" como acción real**. El guard transversal "dice pero no hace" se difiere al
**Incremento 2** (toca el hot path del streaming → su propio diseño/verificación). Decisión de Kevin: dos
incrementos.

## Entregables por fase (secuenciales — typecheck/biome/test verde en cada una)

- **F0 — Specs durables + reconciliación.** Este par de docs; `NEXT-STEPS.md`: cerrar v1 ([?]→Historial,
  verificado en vivo) y abrir v2 ([~]).
- **F1 — Hilos (sub-pieza A).** `createForumTopic` (cliente) · `topicId`/`title` en `OwnerNotifier` · el
  adapter crea el hilo y postea dentro · `escalations.notifyTopicId` + migración `0010` + índice ·
  `findByNotifyTopic` · correlación por topic en inbound/routes (Kevin responde EN el hilo, sin citar).
  Entregable: una escalada abre un hilo con la pregunta de título; responder dentro correlaciona.
- **F2 — Transmití real (sub-pieza B).** `ConversationResumer.resumeConversation → Promise<{delivered}>` ·
  `resume.ts` awaitea el envío · inbound awaitea y confirma según el resultado real · `routes.ts` ACK→inbound
  en background. Entregable: la confirmación a Kevin refleja si el visitante recibió de verdad.
- **F3 — Curación (sub-pieza C).** `kind` (enum) en `escalate` + `escalations.kind` + migración `0011` ·
  puerto+adapter `FactDrafter` (Q+A→statement 3ª persona, null si sensible) · curación determinística en el
  inbound (default por tipo + veto/override del owner) reusando `FactStore` · confirmación con "qué guardé".
  Entregable: un gap-de-dato respondido se vuelve fact 3ª persona que Kevin ve; "no lo aprendas" no guarda.
- **F4 — Wiring + E2E.** `index.ts` inyecta `factDrafter`; log boot. DoD verde + listo para el e2e en vivo
  de Kevin. Reconciliar `NEXT-STEPS`.

## Dependencias / secuencia

Lineal: **cliente → schema/store → notifier → inbound (correlación) → resume (B) → curación (C) → wiring**.
F1 es prerequisito de F3 (el hilo da el contexto donde vive la curación). F2 es independiente de F1/F3 pero
se entrega entre medio (toca el mismo inbound). Dos migraciones: `0010` (F1, notify_topic_id) y `0011` (F3,
kind). Ambas a **branch Neon dev** con `db:push`, **NO prod** (prod por `db:migrate` en release, gated por la
integración del portafolio — memoria `prod-activation-gated-on-portfolio-integration`).

## Verificación macro

Por fase: `pnpm -r typecheck` + `pnpm exec biome check .` + `pnpm -r test`. DoD final (F4): `/health` 200 +
**e2e en vivo de Kevin** (ngrok + 2º Telegram no-owner): escalada → hilo con título → responde EN el hilo →
retomo real al visitante → fact guardado y mostrado; probar "no lo aprendas" (no guarda), dato sensible (no
guarda), `contact` (no guarda), "guardalo" suelto en el hilo (contexto → guarda). Fallbacks: sin owner →
degrada honesto; `createForumTopic` falla → DM plano.

## Estrategia de ejecución

**Directo / secuencial — NO subagentes paralelos.** Razón (igual que en escalate v1, connectors, repo-sync):
árbol de tipos compartido (`OwnerNotifyResult`/`EscalationStore`/`ConversationResumer`/`TelegramDeps`/
`ActionContext`) + el hook `PostToolUse` de typecheck **bloquea** todo edit si un puerto queda roto → agentes
paralelos sobre el mismo árbol se pisan (anti-patrón ya vivido). Las dependencias son estrictamente lineales y
las tareas son chicas siguiendo patrones existentes (~6 archivos nuevos, ~12 tocados). El **diseño** ya se
validó con **3 Explore agents en paralelo** (agent loop · facts/resume · telegram/topics) + **context7**
(Telegram Bot API 9.3, AI SDK v6) — ahí sí rindió el paralelismo. Antes de mergear:
`superpowers:requesting-code-review`.

## Followups (no en este incremento)

- **Incremento 2 — guard transversal "dice pero no hace"** (su propio design+plan).
- **Desaprender facts** (reversibilidad robusta).
- Push al visitante web; expiración de escaladas huérfanas; 2º consumidor del `OwnerNotifier` con su hilo;
  adapters WhatsApp/correo.
