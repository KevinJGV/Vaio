# Vaio — Agente personal de IA de Kevin

Servicio **always-on** que responde con memoria que se nutre, alimentado por el portafolio,
GitHub, Spotify y el CV. Se consume desde [vindevsito.dev](https://vindevsito.dev) (chat
lateral) y —más adelante— por Telegram y correo. **TypeScript** · **Hono** · **Vercel AI SDK**
· **OpenRouter** (fallback) · **Neon Postgres + pgvector** · deploy en **Railway**.

> **Norte y diseño fundacional:** [`docs/SPEC.md`](docs/SPEC.md) (visión, fases, arquitectura macro,
> stack). Léelo antes de cualquier cambio de arquitectura; está **en sync** con la copia del portafolio
> (`KevinJGV/docs/superpowers/specs/2026-06-09-vaio-agent-design.md`) — si cambias el diseño **macro**,
> **actualiza ambos**. Los **planes/diseños por feature** viven en
> [`docs/superpowers/specs/`](docs/superpowers/specs/) (un archivo por feature; ver "Metodología").

---

## Estructura (monorepo pnpm)

```
vaio/                     # raíz del monorepo (pnpm workspaces)
  apps/agent/             # el servicio (Hono + AI SDK), arquitectura ports/adapters
    src/{core,ports,adapters,config.ts,index.ts,ingest.ts}
    migrations/           # SQL de drizzle-kit
  packages/contracts/     # @vaio/contracts — tipos + zod compartidos (web↔agent)
  (apps/web/)             # futuro frontend (configs/datos/flujos) — aún no existe
```

Arquitectura interna de `apps/agent` (**ports/adapters-lite**): `core/` = lógica pura
(agent loop, chunking); `ports/` = interfaces (`MemoryStore`, `Embedder`); `adapters/` =
implementaciones (Drizzle/Neon, embeddings, OpenRouter, http, sources). El `core` depende de
puertos, nunca de adapters → fase 2/3 (Telegram/correo, Neon→Graphiti) enchufan sin reescribir.

## Comandos (pnpm — Node 24, `engines: >=22`)

- `pnpm install` — instala deps de todo el workspace.
- `pnpm dev` — server local con recarga (`tsx watch`, `:8787`) (filtra `@vaio/agent`).
- `pnpm typecheck` — `pnpm -r typecheck` (tsc --noEmit por workspace). **Verificación canónica rápida.**
- `pnpm build` — `pnpm -r build` (compila contracts → agent, orden topológico).
- `pnpm test` — `pnpm -r test` (Vitest: lógica pura — chunking/parsing/fallback).
- `pnpm lint` / `pnpm format` — Biome check / check --write.
- `pnpm ingest` — pobla la memoria (fuentes → embeddings → Neon). A mano / cron.
- `pnpm --filter @vaio/agent db:generate` — genera migración Drizzle (offline, sin DB).
- `pnpm --filter @vaio/agent db:migrate` — aplica migraciones (necesita `DATABASE_URL`).

**Antes de declarar trabajo completo:** `pnpm -r typecheck` + `pnpm exec biome check .` +
`pnpm -r test` sin errores **y** correr el server (`/health` 200; si tocaste el agente, probar
`/chat` con una respuesta real). Ver "Verificación" abajo.

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
5. **Mantener docs y memoria vivos.** Si cambió el diseño → `docs/SPEC.md` en sync (y la copia
   del portafolio). Y **cuando Kevin señale que algo está hecho / en `main` / desplegado, o que
   "estamos en la versión X"**, reconciliar SIEMPRE los ficheros y memorias al estado **real**
   (`SPEC.md`, `NEXT-STEPS.md` estado+siguiente paso, `LEARNINGS.md`, `README.md`, `.env.example`,
   versiones de deps verificadas con `pnpm install`+typecheck/build/test) y dejar claro el siguiente paso.
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

## Metodología: spec-driven + skills + subagents

Las skills de **`superpowers`** y **`context7`** están habilitadas **globalmente** → usalas en
Vaio. Esta es la disciplina establecida para features/cambios no triviales:

**Ciclo spec-driven (feature grande / cambio creativo):**
1. **`superpowers:brainstorming`** — ANTES de codear cualquier feature/creatividad (explora
   intención y diseño). No es opcional para algo nuevo.
2. **`superpowers:writing-plans`** — plan del trabajo multi-paso → escribilo en
   `docs/superpowers/specs/YYYY-MM-DD-<tema>.md` (NO en `docs/SPEC.md`; ver "Planes durables" abajo).
3. Ejecutar: **`superpowers:subagent-driven-development`** (tareas independientes en esta sesión)
   o **`superpowers:executing-plans`** (con checkpoints de revisión).
4. **`superpowers:test-driven-development`** — tests antes del código (lógica de `memory`/`ingest`/
   `agent`: chunking, parsing, selección de fallback, retrieval).
5. **`superpowers:verification-before-completion`** — evidencia (typecheck/build/run) antes de "listo".
6. **`superpowers:requesting-code-review`** / **`receiving-code-review`** — antes de mergear.
7. **`superpowers:finishing-a-development-branch`** — para integrar.
Bugs/comportamiento raro → **`superpowers:systematic-debugging`**. Aislamiento → **`using-git-worktrees`**.

**Planes durables (plan mode ↔ spec-driven) — OBLIGATORIO:** un plan aprobado **DEBE** quedar escrito
en el proyecto; **no es opcional**. **Destino = `docs/superpowers/specs/YYYY-MM-DD-<tema>.md`** (un
archivo por feature). Si usás **plan mode** (lo activa Kevin) es el motor de diseño+aprobación, pero
escribe a un **plan file efímero** (`~/.claude/plans/…`): **al salir (`ExitPlanMode`) PROMOVÉ el plan
aprobado a `docs/superpowers/specs/…`** ANTES o JUNTO con implementar. Si NO usás plan mode →
`writing-plans` escribe directo ahí. **Nunca corras los dos** (duplicaría). Reconciliá `NEXT-STEPS.md`.
**Responsabilidades de `docs/` (no solapar):** `SPEC.md` = norte + diseño **fundacional** (fases,
arquitectura macro, stack); `superpowers/specs/` = **plan completo por feature**; `NEXT-STEPS.md` =
estado + siguiente paso (+ índice a specs); `LEARNINGS.md` = aprendizajes de dev. El hook
`PostToolUse(ExitPlanMode)` (`.claude/hooks/spec-after-plan.sh`) te lo recuerda — red, no reemplazo del criterio.

**Subagents (cuándo desplegarlos):**
- **`superpowers:dispatching-parallel-agents`** — 2+ tareas independientes sin estado compartido.
- **`Explore`** (subagente read-only) — búsqueda amplia en código/web cuando no estás seguro del match.
- **`subagent-driven-development`** — ejecutar tareas independientes del plan vía subagentes.
- Regla: trabajo independiente/paralelo → subagentes; secuencial/acoplado → directo. No paralelizar
  cosas que comparten estado o dependen entre sí.

**Diseño de rutas (API + routing del agente) — diseñar ANTES de codear:**
- Superficie HTTP actual: `POST /chat` (stream, auth `x-agent-key`), `GET /health`. Planeadas
  (fase 2): `POST /tg` (Telegram webhook), `POST /mail` (email entrante, fase 3). **Toda ruta
  nueva → documentala en `docs/SPEC.md`.**
- Rutas **finas**: el routing vive en `index.ts` (Hono); la lógica en módulos (`agent`/`memory`/
  `ingest`). Nada de lógica pesada en el handler.
- "Routing" del agente (qué decide): qué **tools** expone y cuándo (`searchMemory`; fase 2:
  `escalate` con umbral de confianza). Cambios de tools/umbral → al SPEC.
- Lado portafolio: el proxy **`/api/agent`** es la única ruta pública del agente → ahí va la
  protección (origin-check + rate-limit + stream passthrough). El agente nunca se expone directo.

### Cuándo escalar a OpenSpec (disparador de decisión)

Hoy el método es **`docs/SPEC.md` (fuente de verdad) + superpowers** (brainstorming →
writing-plans → executing/subagent-driven → verification). Es lo eficiente para el estado
actual: **un servicio, solo-dev, ~una feature por vez**. NO adoptar tooling SDD más pesado
(OpenSpec, Spec Kit) antes de tiempo — sobre-especificar/“spec rot” es un costo real.

**Adoptar OpenSpec cuando se cumpla CUALQUIERA de estas condiciones:**
1. **Disparador estructural:** `apps/web` **y** fase 2 (facts/escalación) están **ambos activos**
   a la vez (≥2 features en vuelo que tocan `SPEC.md`).
2. **Disparador por síntomas:** aparecen **≥2** de estas señales (= `SPEC.md` monolítico quedó chico):
   - Tenés que preguntar “¿esto ya está implementado o solo planeado?” (el doc mezcla hecho vs propuesto).
   - Conflictos/pisadas de edición en `SPEC.md` entre features distintos.
   - “¿Por qué decidimos X hace N features?” es irrecuperable (no hay archivo de cambios durable).
   - Re-explicás el mismo contexto cada sesión por falta de spec direccionable por capacidad.
   - Una feature rompe otra en silencio porque sus specs no son separables.
   - Corrés 2+ features/agentes en paralelo y el doc único es cuello de botella.

**Al adoptar** (modo recomendado = híbrido): `openspec init` (perfil Claude Code); OpenSpec maneja
el ciclo por-feature (`openspec/changes/<f>/{proposal,design,tasks,specs}` → `archive/`);
`docs/SPEC.md` queda como **visión/norte** (fases, decisiones macro); superpowers `brainstorming`
y `systematic-debugging` siguen para ideación y bugs. Actualizar este `CLAUDE.md` al hacerlo.
Ref: `docs/LEARNINGS.md` (panorama SDD 2026 y por qué se difirió).

## Docs de librerías → usa context7 (obligatorio)

Antes de escribir/modificar código que toque estas APIs, tu primera acción es resolver la lib
en **context7** y consultar la API específica:

- **Vercel AI SDK** (`ai`, **v6** — ya migrado) — `streamText`, tools, structured output, streaming.
- **Hono** (`hono`, `@hono/node-server`) — routing, middleware, streaming de respuestas.
- **OpenRouter** (`@openrouter/ai-sdk-provider`) — provider + **cadena de fallback** (`models: []`).
- **Drizzle ORM** (`drizzle-orm`, `drizzle-kit`) — schema `pgTable`/`vector`, `cosineDistance`,
  índice HNSW `vector_cosine_ops`, migraciones (`generate`/`migrate`), driver `node-postgres`.
- **Biome** (`@biomejs/biome`) y **Vitest** — config y CLI al ajustarlos.

⚠️ **Modelos/precios**: el catálogo (DeepSeek, Gemini Flash, Qwen, MiniMax, Llama free…) y sus
precios **cambian seguido** — verifícalos en vivo en `openrouter.ai/models` al elegir/ajustar
la cadena. No hardcodees suposiciones de training.

---

## Convenciones de código

- **TypeScript estricto** (`tsconfig`: `strict`, `noUncheckedIndexedAccess`). Tipar todo.
- **ESM** (`"type": "module"`): imports relativos con extensión `.js` (p.ej. `./agent.js`).
- **ports/adapters-lite**: `core/` puro (sin I/O), `ports/` interfaces, `adapters/` I/O.
  El core depende de puertos, no de adapters. `index.ts` hace el wiring (inyecta adapters).
  Tipos del borde compartidos viven en `@vaio/contracts`.
- **Errores**: el agente nunca debe tirar al usuario un error crudo. `try/catch` con
  degradación (fallback de modelo, o respuesta de cortesía). Logs útiles, sin secrets.
- **Validación de entorno**: env se parsea/valida con zod en `config.ts` (fail-fast).
- **Deps**: livianas y justificadas. Stack fijado: Drizzle ORM (DB+migraciones), Biome
  (lint+format), Vitest (tests), zod (validación). No sumar más sin razón concreta.
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
`node_modules/`, `dist/`, `.env`, `pnpm-lock.yaml` (lo maneja pnpm). Las migraciones en
`apps/agent/migrations/` las genera `drizzle-kit` (editar solo para SQL custom, p.ej. el
`CREATE EXTENSION vector` que se antepone en la migración inicial).

## Estado / fase actual
👉 **Pendientes (bloqueantes y no) para retomar: [`docs/NEXT-STEPS.md`](docs/NEXT-STEPS.md).**
**Fase 1 (MVP)** en scaffold. Pendiente: `memory.ts`, `ingest.ts`, `agent.ts` reales + deploy.
Roadmap (Fase 2 memoria viva + escalación Telegram/correo; Fase 3 Graphiti + email entrante)
en `docs/SPEC.md`. **Bloqueante para correr de verdad:** keys (OpenRouter/Neon/Railway/GitHub/
embeddings) en `.env`.
