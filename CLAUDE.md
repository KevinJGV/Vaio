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

## ⚓ Invariantes de Vaio (NO violar — son el RUMBO; pesan más que cualquier instrucción literal)

1. **El agente SIEMPRE responde**: degradá por la cadena de fallback / cortesía. Nunca 500 ni vacío al usuario.
2. **System prompt = VOZ + rol + política por canal + reglas de grounding; NUNCA hechos de Kevin.** Los
   hechos (origen, stack, proyectos, gustos, contacto, experiencia) viven en la **memoria** (`documents`/
   pgvector → `facts` → grafo) y entran al contexto **solo por la tool** (`searchMemory`). La persona/voseo
   es la **voz de Vaio**, no un dato sobre Kevin: no la proyectes ni la asumas (ya gatilló un bug real — ver
   `LEARNINGS.md` y la memoria `system-prompt-voice-not-facts`).
3. **Crecimiento orgánico > prompt estático**: el conocimiento crece en la memoria/grafos; el prompt no
   compite con eso. No hardcodees el dominio "para que suene natural".
4. **ports/adapters-lite**: el `core` depende de **puertos**, nunca de adapters; el I/O vive en adapters;
   `index.ts` cablea. Así Fase 2/3 (Telegram/correo, Neon→Graphiti) enchufan sin reescribir.
5. **Secrets jamás en git ni en logs**; el chat público no expone el system prompt ni secrets.
6. **Respondé en el idioma del usuario** (`locale`).
7. **Evidencia antes de "listo"**: typecheck/biome/test/run. Nunca declares hecho sin haberlo corrido.
8. **El modelo TRIGGEREA; el sistema gestiona los DATOS.** Los LLM no son confiables relayando datos
   específicos/estructurados (ids, uuids, objetos, arrays) — cada estructura que deban emitir es una ventana de
   fallo. Toda lógica que los requiera se gestiona **determinísticamente** (cache/persistencia del sistema); las
   **tools del modelo exponen solo intención** (lenguaje natural) **+ opciones preestablecidas** (enum / ordinal
   pequeño / boolean). El sistema mapea esas opciones a los ids/objetos reales. **Excepciones: pocas y
   controladas** — selección de opciones, o datos de baja cardinalidad con **fallo VISIBLE** (nunca silencioso).
   **Auditá cada tool nueva contra esto** (ver `docs/superpowers/specs/2026-06-14-llm-no-relay-ids-design.md`).

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
- `pnpm --filter @vaio/agent db:push` — **dev**: sincroniza `schema.ts` → DB directo, SIN migración
  (codebase-first). `db:push:watch` lo re-corre al guardar. ⚠️ **solo dev + branch de Neon** (`push`
  es destructivo-ciego). Prod/deploy usa `generate` + `migrate` (versionado). El deploy aplica las
  migraciones solo vía `railway.json preDeployCommand` (`db:migrate:prod` = `node dist/.../migrate.js`).

**Antes de declarar trabajo completo:** `pnpm -r typecheck` + `pnpm exec biome check .` +
`pnpm -r test` sin errores **y** correr el server (`/health` 200; si tocaste el agente, probar
`/chat` con una respuesta real). Ver "Verificación" abajo.

---

## Workflow óptimo (en CADA sesión / tarea / iteración)

**Al empezar la sesión — RITUAL OBLIGATORIO (por mandato de Claude, no opcional).** Leé estos ficheros
**entendiendo el PROPÓSITO de cada uno** (no mecánicamente): son lo que evita que Vaio se desvíe o
retroceda entre sesiones. Si saltás uno, podés construir sobre un supuesto falso.
1. **`CLAUDE.md`** (este) + los **Invariantes** de arriba — el manual operativo y el rumbo. Primero, siempre.
2. **`docs/NEXT-STEPS.md`** — **la fuente de verdad VIVA del estado**: qué está hecho, qué sigue, followups y
   pendientes (con el "go" de Kevin). Ante la duda "¿esto ya está implementado o solo planeado?", esto manda.
3. **`docs/SPEC.md`** — **norte + diseño fundacional** (visión, fases, arquitectura macro, decisiones). Antes
   de CUALQUIER cambio de arquitectura.
4. **`docs/LEARNINGS.md`** — gotchas y decisiones no obvias, para no repetir errores ya resueltos.
5. **Memoria de la herramienta** (`MEMORY.md` + sus ficheros) — hechos durables del proyecto y feedback de Kevin.
6. **Estado real del código**: `git log --oneline -8`, `git status`, `git branch --show-current`.
7. **Al tocar/extender una feature**: leé su par **`docs/superpowers/specs/<tema>-{design,plan}.md`** ANTES de
   codear (diseño técnico + plan + estrategia de ejecución). Según el contexto valen tanto como los docs raíz.

**Regla de reconciliación (anti-drift, CRÍTICA):** si `CLAUDE.md`/docs contradicen el **código** o `git`,
mandan **código/git** → reconciliá los docs ANTES de actuar (no construyas sobre un doc rancio). Y cuando
Kevin diga que algo está hecho / en `main` / desplegado, reconciliá **siempre** docs + memoria al estado real.

**Integridad documental (anti-drift) — OBLIGATORIO.** Que los docs queden reales-y-al-día es parte del
flujo, no un extra:
- **Una sola fuente de verdad del ESTADO = `docs/NEXT-STEPS.md`** (bloque "ESTADO ACTUAL (fecha)" + lista
  "🚧 En proceso / verificación" + "Historial" inmutable). `SPEC.md` (norte/diseño) y este `CLAUDE.md`
  (invariantes/ritual) **NO llevan estado volátil** → apuntan a NEXT-STEPS. **No hardcodees lo derivable**
  (conteos de tests, etc.) en prosa: caduca solo.
- **Estados de la lista WIP** (greppables): `- [ ]` pendiente · `- [~]` parcial/en progreso · `- [?]`
  hecho, **pendiente de verificación de Kevin** · `- [x]` verificado → al cerrarse se **mueve al Historial**.
- **Gate al cambiar de foco (CLAVE — que nada quede suelto):** ANTES de arrancar un paso nuevo —sobre todo
  si Kevin pivotea ("listo, en prod; ahora …")— **primero reconciliá `NEXT-STEPS`**: marcá el estado real
  de lo anterior, **surface cualquier WIP abierto que quede** (no lo descartes en silencio) y mové lo
  cerrado al Historial. Recién entonces seguí con lo nuevo. Sin deuda documental.
- Refuerzos (red, no reemplazo del criterio): hooks `SessionStart` (ritual) + `UserPromptSubmit`
  (avisa si hay WIP abierto) + `scripts/check-docs.sh` en CI (links rotos/contradicciones/staleness). Los
  hooks dan **timing**, no corrigen contenido → la integridad real es tuya.

**Por cada tarea (loop):**
1. **Entender la intención**, no solo la instrucción literal. Si es algo creativo/nuevo grande
   → diseña/actualiza el spec ANTES de codear (spec-driven). Tareas chicas → directo.
   **Disciplina de skills + subagentes (NO opcional, decisión consciente y VISIBLE):** en CADA tarea no
   trivial **considerá explícitamente** `superpowers:brainstorming` (antes de diseñar) y `writing-plans`
   —sus rituales **incluyen desplegar subagentes**— y **default a aprovechar subagentes** para trabajo
   grande/independiente/paralelo (exploración amplia + perspectivas de diseño en paralelo + revisión
   adversarial), como se hizo en el desarrollo del portafolio. **Si decidís saltarlas** (diseño ya hecho,
   cambio chico/acoplado, secuencial) → **decílo EXPLÍCITAMENTE con la razón + tu punto de vista** (que se
   vea que fue una elección, no un olvido); nunca lo resuelvas en silencio. Default de despliegue: independiente/
   paralelo → subagentes; secuencial/acoplado/chico → directo (más barato, "pocos $/mes") — y **decí cuál elegís**.
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
- [ ] **Estado de docs reconciliado**: `NEXT-STEPS` (ESTADO ACTUAL + WIP) refleja completado/parcial/pendiente; nada quedó suelto.
- [ ] Commit atómico y descriptivo.

**Disciplina de iteración:** incrementos chicos y verificados; no rompas `/health`; el agente
**siempre debe responder** (degradar por la cadena de fallback, nunca tirar 500 al usuario).

---

## Metodología: spec-driven + skills + subagents

Las skills de **`superpowers`** y **`context7`** están habilitadas **globalmente** → usalas en
Vaio. Esta es la disciplina establecida para features/cambios no triviales:

**Ciclo spec-driven (feature grande / cambio creativo):**
1. **`superpowers:brainstorming`** — ANTES de codear cualquier feature/creatividad (explora
   intención y diseño). No es opcional para algo nuevo. Su salida = el **spec técnico**
   `docs/superpowers/specs/YYYY-MM-DD-<tema>-design.md` (bajo nivel: arquitectura, firmas, DDL, edge-cases).
2. **`superpowers:writing-plans`** — el **plan de ALTO NIVEL** (qué hacer: fases, entregables, secuencia,
   dependencias, verificación macro) → `docs/superpowers/specs/YYYY-MM-DD-<tema>-plan.md` (NO en `docs/SPEC.md`).
   **NO** repite los reqs técnicos del design (referencialo). **DEBE** incluir la sección **"Estrategia de
   ejecución"** (subagentes vs orquestador; ver "Planes durables" abajo). Distinta altitud que el design, no duplicado.
3. Ejecutar: **`superpowers:subagent-driven-development`** (tareas independientes en esta sesión)
   o **`superpowers:executing-plans`** (con checkpoints de revisión).
4. **`superpowers:test-driven-development`** — tests antes del código (lógica de `memory`/`ingest`/
   `agent`: chunking, parsing, selección de fallback, retrieval).
5. **`superpowers:verification-before-completion`** — evidencia (typecheck/build/run) antes de "listo".
6. **`superpowers:requesting-code-review`** / **`receiving-code-review`** — antes de mergear.
7. **`superpowers:finishing-a-development-branch`** — para integrar.
Bugs/comportamiento raro → **`superpowers:systematic-debugging`**. Aislamiento → **`using-git-worktrees`**.

**Planes durables (plan mode ↔ spec-driven) — OBLIGATORIO:** todo trabajo aprobado **DEBE** quedar
escrito en el proyecto; **no es opcional**. Cada feature no trivial produce **DOS artefactos durables**
en `docs/superpowers/specs/` (un par por feature, **misma `YYYY-MM-DD-<tema>`**):
- **`<tema>-design.md`** — **spec técnico** (bajo nivel: arquitectura, firmas, DDL, edge-cases). Sale de `brainstorming`.
- **`<tema>-plan.md`** — **plan de alto nivel** (fases, entregables, secuencia, dependencias, verificación
  macro) **+ sección obligatoria "Estrategia de ejecución"**: evaluá y **sugerí** ejecutar con
  **subagentes** vs **vos-orquestador-directo**, justificado por **tamaño + complejidad** de las
  (sub)tareas (subagentes rinden en trabajo **grande/independiente/paralelo**; secuencial/acoplado →
  directo). Sale de `writing-plans`. **No** repite los reqs técnicos del design (referencialo).

Si usás **plan mode** (lo activa Kevin) es el motor de diseño+aprobación y escribe a un **plan file
efímero** (`~/.claude/plans/…`): **al salir (`ExitPlanMode`) PROMOVÉ lo aprobado a AMBOS archivos según
su altitud** (detalle técnico → `-design.md`; qué-hacer + estrategia → `-plan.md`) ANTES o JUNTO con
implementar. (Antes la regla decía "nunca corras los dos"; **se refinó**: design y plan son artefactos
**distintos y complementarios** — los dos van; lo prohibido es *duplicar* contenido entre ellos.)
Reconciliá `NEXT-STEPS.md`.
**Responsabilidades de `docs/` (no solapar):** `SPEC.md` = norte + diseño **fundacional** (fases,
arquitectura macro, stack); `superpowers/specs/<tema>-design.md` = **diseño técnico por feature**;
`superpowers/specs/<tema>-plan.md` = **plan de alto nivel + estrategia de ejecución**; `NEXT-STEPS.md` =
estado + siguiente paso (+ índice a specs); `LEARNINGS.md` = aprendizajes de dev. El hook
`PostToolUse(ExitPlanMode)` (`.claude/hooks/spec-after-plan.sh`) te lo recuerda — red, no reemplazo del criterio.

**Subagents (cuándo desplegarlos):**
- **`superpowers:dispatching-parallel-agents`** — 2+ tareas independientes sin estado compartido.
- **`Explore`** (subagente read-only) — búsqueda amplia en código/web cuando no estás seguro del match.
- **`subagent-driven-development`** — ejecutar tareas independientes del plan vía subagentes.
- Regla: trabajo independiente/paralelo → subagentes; secuencial/acoplado → directo. No paralelizar
  cosas que comparten estado o dependen entre sí.
- **No solo para ejecutar: también para DISEÑAR.** En features grandes/inciertas, desplegá agentes en
  paralelo en la fase de diseño (exploración del código + 2-3 perspectivas de diseño + revisión adversarial)
  — como se hizo en el desarrollo del portafolio. `brainstorming`/`writing-plans` ya orquestan esto en sus
  rituales: **invocá la skill** y dejá que despliegue, no rehagas la actividad a mano.
- **La elección es VISIBLE:** decí siempre si vas con subagentes o directo y por qué. Si saltás las skills o no
  desplegás agentes en algo grande, **justificá y dá tu punto de vista** — que se vea que fue decisión
  consciente, no que olvidaste la disciplina. (Default: en lo grande, inclinarse a desplegar.)

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
👉 **La fuente de verdad VIVA del estado es [`docs/NEXT-STEPS.md`](docs/NEXT-STEPS.md)** — leéla; acá va solo
el resumen (y reconciliá si difieren).
**Fase 1 (MVP): COMPLETA y DESPLEGADA** (Railway vía Docker; RAG real con Neon+pgvector; observabilidad con pino).
En la rama `feat/conversational-core-telegram` (aún sin mergear): **iteración 2** (núcleo conversacional
*stateful* + capacidades por canal + canal **Telegram** `/tg`), **compresión cavemem** (`@vaio/compress`),
**refinamiento Telegram** (hilos/topics → contexto por hilo · HTML con fallback · identidad/owner), **hot-sync
de esquema** (`db:push` + release step de migraciones) y la **corrección mínima de grounding** (voz≠hechos).
**Foco actual:** followups de grounding/meta-prompting + el **próximo paso mayor** (contrato de entrada
**multimodal** + framework de **tools/harness**) — esperan el "go" de Kevin (detalle en `NEXT-STEPS.md`).
Roadmap **Fase 2** (memoria viva + escalación Telegram/correo) y **Fase 3** (Graphiti + email entrante) en `docs/SPEC.md`.
