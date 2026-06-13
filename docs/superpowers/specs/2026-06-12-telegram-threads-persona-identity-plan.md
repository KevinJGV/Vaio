# Plan (alto nivel) — Telegram: hilos, persona, identidad/owner (2026-06-12)

Qué-hacer + secuencia + estrategia. Reqs técnicos (firmas, edge-cases) → el
[`…-design.md`](2026-06-12-telegram-threads-persona-identity-design.md) (no se duplican acá).

## Objetivo
Dejar el canal Telegram "como debe ser" antes de integrar el portafolio: usar los **hilos** de
Telegram para acotar la **ventana de contexto** (1 topic = 1 charla), corregir la **persona** (nombre
+ voseo palmireño + formato HTML) e **identificar al usuario** (owner vs visitante) preparando el
gating del harness por-usuario.

## Decisiones (con Kevin)
- Formato **HTML** con fallback a texto plano.
- **1 topic = 1 conversación** (contexto por hilo; DM sin topics = una sola conversación).
- No-owner = **capado tipo público, presenta a Kevin** (reusa el perfil untrusted, ahora con searchMemory).

## Estrategia de ejecución
**Orquestador-directo (una sesión).** Cambios chicos, secuenciales y **acoplados** (los mismos archivos:
`normalize`, `routes`, `client`, `prompt`, `capabilities`, `agent`, `config`) que comparten el flujo del
turno → subagentes no aportan (no hay trabajo grande, independiente ni paralelo; el riesgo está en
integrar bien, no en cubrir amplitud). TDD en la lógica pura.

## Fases / entregables
1. **Paso 0 — separar commits del trabajo previo** (allowlist opcional; hot-sync de esquema) ANTES de
   editar, porque los nuevos cambios tocan los mismos archivos. ✅
2. **Hilos** (normalize+routes+client): clave por topic + responder dentro del hilo.
3. **Persona + HTML** (prompt + capabilities + client): nombre/voseo + parse_mode HTML con fallback.
4. **Identidad/owner** (config + normalize + routes + index + agent + prompt + capabilities): `trusted`
   = owner; `audience` en el system prompt; perfil visitante "presenta a Kevin".
5. **Docs + housekeeping**: este par, `SPEC.md`, `NEXT-STEPS.md` (+ punto 1 futuro: Neon reactiva), `LEARNINGS.md`.

## Dependencias / acción de Kevin
- `OWNER_TELEGRAM_ID` (id de @userinfobot) en entorno local + Railway.
- E2E real: bot con topic-mode ON; chatear en 2 topics (contexto aislado), como owner y como no-owner.

## Verificación (macro)
`typecheck` · `biome` · `tests` · `build` limpios (hecho). E2E local con ngrok + bot real: hilos
separan contexto, respuestas caen en su topic, HTML renderiza (y rompe → cae a plano), owner vs visitante
se comportan distinto.

## Estado
**Código + tests + build: COMPLETO y verificado en local** (73+20 tests verdes). Pendiente: E2E real con
keys (acción de Kevin) y luego review + merge de la rama.
