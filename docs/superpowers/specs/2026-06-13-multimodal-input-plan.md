# Plan de alto nivel — Contrato de entrada multimodal (audio/voz + imágenes)

> **Altitud:** QUÉ hacer (fases, entregables, secuencia, dependencias, verificación macro) + **Estrategia
> de ejecución**. El CÓMO técnico (firmas, DDL, edge-cases) vive en
> [`2026-06-13-multimodal-input-design.md`](2026-06-13-multimodal-input-design.md) — **no se repite acá**.
> Estado vivo en [`../../NEXT-STEPS.md`](../../NEXT-STEPS.md).

## Objetivo

Que el core acepte y procese **audio/voz + imágenes** (Telegram y web) sin romper el camino texto,
respetando los invariantes (siempre responde, ports/adapters-lite, secrets, locale, costo). Es el **primer
eje** del próximo paso mayor; el harness/HITL queda para la iteración siguiente.

## Entregables

1. Contrato wire multimodal en `@vaio/contracts` (refs + metadata, sin bytes).
2. Puertos `Transcriber`/`MediaUnderstanding` + adapter sobre OpenRouter/Gemini Flash.
3. Núcleo puro `core/modality.ts` (decisión nativo-vs-normalizar + armado de `content`/`derivedText`).
4. Telegram: normalize multimodal + descarga de media (token nunca en logs).
5. Persistencia texto-derivado + metadata (`jsonb attachments`) + migración.
6. Config (cadena multimodal separada + flag nativo + límite de tamaño) + wiring + rutas de entrada.
7. Cobertura de tests (TDD) + verificación e2e con degradación/fallback.

## Fases y secuencia (pasos chicos verificables; detalle de archivos en el design)

1. **Contrato** (`@vaio/contracts`) — tipos + zod. _Verif:_ build contracts + typecheck.
2. **Puertos + núcleo puro** (`ports/media.ts`, `core/modality.ts`) — **TDD** (tests primero). _Verif:_ test.
3. **Adapter de media** (`media-openrouter.ts`) — `generateText` + file part. _Verif:_ test con mock.
4. **Telegram** — normalize extendido (TDD con fixtures) + descarga (`media.ts`, test token-no-en-logs). _Verif:_ test.
5. **Core + persistencia** — `agent.respond(req,ctx,media)` + `buildUserContent`; `jsonb attachments` +
   `db:push` (dev) + `db:generate` (prod); `ports/conversation` + `neon-conversation`. _Verif:_ typecheck + agent-loop + conversation-store tests.
6. **Config + wiring + rutas** — `config.ts`/`index.ts`/`{http,telegram}/routes.ts`/`.env.example`. _Verif:_ config test + boot `/health`.
7. **Verificación e2e** (ver "Verificación macro").

**Dependencias:** 1 → 2 → 3 → (4 ∥ 5 una vez fijados los tipos) → 6 → 7. El contrato (1) y el núcleo puro
(2) son el cuello: todo lo demás depende de esos tipos.

## Verificación macro (Definition of Done)

- `pnpm -r typecheck` + `pnpm exec biome check .` + `pnpm -r test` limpios.
- `/health` 200; `POST /chat` con `attachments` base64 (imagen) responde grounded.
- Telegram real: nota de voz → transcribe y responde; foto con caption → describe y responde.
- **Degradación/fallback (invariante "siempre responde"):** matar el modelo multimodal (slug inválido) → el
  turno degrada (marcador + sigue con el texto), nunca 500; doc/PDF → "no soporto ese tipo aún".
- Sin secrets en logs (grep del bot token = vacío). `.env.example` actualizado. Commits atómicos por fase.

## Estrategia de ejecución

**Orquestador directo, secuencial-acoplado** — NO subagentes paralelos. Justificación por tamaño +
complejidad: las piezas (contrato → puertos → adapters → core → persistencia → rutas) **comparten tipos**
y **convergen en `agent.ts`**; la cadena de dependencias es fundamentalmente secuencial (cada paso consume
los tipos del anterior). El único tramo paralelizable son los **tests puros** de `modality`/`normalize`/
`media` una vez fijados los tipos del contrato — no amerita el overhead de coordinar subagentes. **Sin
worktree** (una sola línea de trabajo, rama `feat/multimodal-input`). TDD en la lógica pura
(`modality`, `normalize`) y en el helper de descarga (secret en logs).

## Riesgos / a verificar en vivo

- **Slugs/precios de modelos multimodales en OpenRouter** cambian mensual → verificar en `openrouter.ai/models`
  al fijar `MULTIMODAL_MODELS` (Gemini Flash audio+vision barato). No hardcodear suposiciones de training.
- **Tamaño de payloads base64** (web) vs límites del proxy/Hono → `MEDIA_MAX_BYTES` defensivo + nota en contrato.
- **Costo**: audio siempre transcribe (barato); imagen nativa OFF por default (aísla el costo de vision).

## Fuera de alcance (seams, NO implementar)

Harness/registry + HITL (próxima iteración); PDF/docs; embeddings multimodales; persistencia de binarios;
ventana por tokens; persona/policy como dato. Detalle de cada seam en el design.
