# Vaio — Agente personal de IA de Kevin

Servicio **always-on** que responde con memoria que se nutre, alimentado por el portafolio,
GitHub, Spotify y el CV. Se consume desde [vindevsito.dev](https://vindevsito.dev) (chat
lateral) y —más adelante— por Telegram y correo. **TypeScript** · **Hono** · **Vercel AI SDK**
· **OpenRouter** (fallback) · **Neon Postgres + pgvector** · deploy en **Railway**.

> **Spec completo y fuente de verdad del diseño:** [`docs/SPEC.md`](docs/SPEC.md).
> Léelo antes de cualquier cambio de arquitectura. Está **en sync** con la copia del
> portafolio (`KevinJGV/docs/superpowers/specs/2026-06-09-vaio-agent-design.md`) — si cambias
> el diseño, **actualiza ambos**.

---

## Comandos

- `npm install` — instalar deps (Node >= 20).
- `npm run dev` — server local con recarga (`tsx watch`, `:8787`).
- `npm run typecheck` — `tsc --noEmit`. **Verificación canónica rápida.**
- `npm run build` — compila a `dist/` (`tsc`).
- `npm run start` — corre el build (`node dist/index.js`).
- `npm run ingest` — pobla la memoria (fuentes → embeddings → Neon). A mano / cron.

**Antes de declarar trabajo completo:** `npm run typecheck` sin errores **y** correr el
server (`/health` 200; si tocaste el agente, probar `/chat` con una respuesta real). Ver
"Verificación" abajo.

---

## Workflow óptimo (en CADA sesión / tarea / iteración)

**Al empezar la sesión:**
1. Lee este `CLAUDE.md` + `docs/SPEC.md` (la **fase actual** y qué está hecho).
2. Mira el estado real: `git log --oneline -5`, `git status`, qué `TODO(fase1)` quedan.
3. Recupera aprendizajes previos (memoria de la herramienta / `docs/LEARNINGS.md` si existe).

**Por cada tarea (loop):**
1. **Entender la intención**, no solo la instrucción literal. Si es algo creativo/nuevo grande
   → diseña/actualiza el spec ANTES de codear (spec-driven). Tareas chicas → directo.
2. **context7 ANTES de tocar APIs de librerías** (ver sección). No confíes en memoria de
   entrenamiento: las versiones y, sobre todo, **el catálogo/precios de modelos cambian
   mensualmente y están más allá del corte de conocimiento**.
3. **Implementar** en pasos chicos, siguiendo convenciones. Un cambio coherente por vez.
4. **Verificar con evidencia** (typecheck/build/run/probar endpoint/probar fallback) ANTES de
   decir "listo". **Nunca declares hecho sin haberlo corrido.** Si un test falla, dilo con la
   salida.
5. **Mantener `docs/SPEC.md` en sync** (y la copia del portafolio) si cambió el diseño.
6. **Secrets**: jamás en git. `.env` local + secrets en Railway. Nunca los imprimas/loguees.
7. **Registrar aprendizajes** no obvios (decisiones, gotchas) para la próxima sesión.

**Definition of Done (checklist por tarea):**
- [ ] `npm run typecheck` limpio.
- [ ] Corre localmente; `/health` OK; el camino tocado probado de verdad.
- [ ] Si tocaste el modelo/agente: respuesta real OK **y** fallback OK (matar el primario).
- [ ] Sin secrets en el diff; `.env.example` actualizado si agregaste una var.
- [ ] Spec en sync si cambió el diseño.
- [ ] Commit atómico y descriptivo.

**Disciplina de iteración:** incrementos chicos y verificados; no rompas `/health`; el agente
**siempre debe responder** (degradar por la cadena de fallback, nunca tirar 500 al usuario).

---

## Docs de librerías → usa context7 (obligatorio)

Antes de escribir/modificar código que toque estas APIs, tu primera acción es resolver la lib
en **context7** y consultar la API específica:

- **Vercel AI SDK** (`ai`) — `streamText`, tools, structured output, streaming. La v6 cambió API.
- **Hono** (`hono`, `@hono/node-server`) — routing, middleware, streaming de respuestas.
- **OpenRouter** (`@openrouter/ai-sdk-provider`) — provider + **cadena de fallback** (`models: []`).
- **pg + pgvector** — driver, operadores de similaridad (`<=>` coseno), índices (HNSW).

⚠️ **Modelos/precios**: el catálogo (DeepSeek, Gemini Flash, Qwen, MiniMax, Llama free…) y sus
precios **cambian seguido** — verifícalos en vivo en `openrouter.ai/models` al elegir/ajustar
la cadena. No hardcodees suposiciones de training.

---

## Convenciones de código

- **TypeScript estricto** (`tsconfig`: `strict`, `noUncheckedIndexedAccess`). Tipar todo.
- **ESM** (`"type": "module"`): imports relativos con extensión `.js` (p.ej. `./agent.js`).
- **Un módulo, una responsabilidad**: `index.ts` (server/routing), `agent.ts` (loop + tools +
  system prompt), `memory.ts` (Neon/pgvector + RAG), `ingest.ts` (fuentes → memoria).
- **Errores**: el agente nunca debe tirar al usuario un error crudo. `try/catch` con
  degradación (fallback de modelo, o respuesta de cortesía). Logs útiles, sin secrets.
- **Sin dependencias nuevas sin razón concreta** — el servicio se mantiene liviano.
- Idioma de respuesta del agente = el del usuario (`locale` que manda el portafolio).

## Tono / persona del agente
El system prompt representa a Kevin (persona/profesional/dev). **Respeta sus quirks de
personalidad** en el copy — son señal cultural deliberada, no se neutralizan al "profesionalizar".

---

## Seguridad & costo (crítico en un agente público)

- `POST /chat` exige el header `x-agent-key` == `AGENT_API_KEY`. **Solo el proxy del portafolio
  lo conoce** → nadie llama al agente directo y te quema tokens.
- **Rate-limit y origin-check viven en el proxy** del portafolio (`/api/agent`), no acá.
- **Inyección de prompts**: el chat es público. No expongas secrets ni el system prompt en las
  respuestas; limita lo que pueden hacer las tools; valida inputs.
- **Costo**: prompt caching del system/tools + cadena de fallback (barato → free de última
  instancia). Objetivo: tráfico bajo ≈ pocos $/mes. Vigila el gasto en OpenRouter.
- **Secrets** en `.env` (local) y en Railway. `.env` está en `.gitignore`. Si agregas una var,
  documenta en `.env.example` (sin el valor).

---

## Memoria: del PRODUCTO vs del DESARROLLO
- **Del producto** (lo que el agente "sabe"): Neon + pgvector (`documents`, y `facts` en
  fase 2). Es lo que se nutre con cada conversación.
- **Del desarrollo** (aprendizajes para próximas sesiones): regístralos donde tu herramienta
  guarde memoria, o en `docs/LEARNINGS.md`.

## Fuentes de datos (ingesta) — desacopladas (solo HTTP/API público)
`cv.vindevsito.dev` (CV ES/EN), `vindevsito.dev/me`·`/contact`, **GitHub API**, **Last.fm**.
No acoplar el repo del portafolio; leer sus fuentes públicas.

---

## Verificación antes de declarar listo
1. `npm run typecheck` (y `npm run build`) sin errores.
2. `npm run dev` → `GET /health` 200; `POST /chat` con `x-agent-key` correcto responde.
3. Si tocaste el modelo: una respuesta **real** que use contexto RAG (p.ej. "¿qué tecnologías
   usa Kevin?" cita el CV) **y** verificar que al fallar el primario sigue respondiendo.
4. Evidencia antes de afirmaciones: pega la salida si algo falla; no digas "funciona" sin correrlo.

## Automatización (hooks + CI) — refuerza el workflow, no lo reemplaza
Este repo trae hooks de Claude Code en `.claude/settings.json` (aplican al abrir Claude Code
**dentro de Vaio**):
- **PostToolUse** (editar `.ts`) → corre `typecheck` y **bloquea** si falla (salta limpio sin
  `node_modules`). Análogo al `astro check` del portafolio.
- **UserPromptSubmit** → inyecta recordatorio de **context7** si el prompt menciona las libs.
- **PreToolUse (git)** → **bloquea** commitear el `.env` real.

Igual seguí verificando vos: los hooks son una red, no sustituyen el "correr y probar".
CI en `.github/workflows/ci.yml` (`npm ci` + `typecheck` + `build`) y Dependabot semanal.
Aprendizajes de desarrollo → `docs/LEARNINGS.md`.

## No tocar (generados / sensibles)
`node_modules/`, `dist/`, `.env`, `package-lock.json` (lo maneja npm).

## Estado / fase actual
**Fase 1 (MVP)** en scaffold. Pendiente: `memory.ts`, `ingest.ts`, `agent.ts` reales + deploy.
Roadmap (Fase 2 memoria viva + escalación Telegram/correo; Fase 3 Graphiti + email entrante)
en `docs/SPEC.md`. **Bloqueante para correr de verdad:** keys (OpenRouter/Neon/Railway/GitHub/
embeddings) en `.env`.
