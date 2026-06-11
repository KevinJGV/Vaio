# Pendientes — Vaio (para retomar)

Estado (2026-06-10): **código de Fase 1 COMPLETO** en monorepo pnpm (`apps/agent` +
`packages/contracts`), arquitectura ports/adapters, **Drizzle ORM + migración inicial**,
Biome + Vitest (12 tests verdes). Verificado: typecheck/build/lint/test limpios; server
corre (`/health` 200, `/chat` 401 sin key, 400 body inválido, cortesía 200 sin OpenRouter).

**Ya en `main` además:** Node **24** (LTS) en `.nvmrc`/CI/`engines`; Biome alineado con `clon-ai`
(formato + reglas); Dependabot configurado para el monorepo (globs + grouping); y **deps mayores
al día y verificadas** (ai 6, zod 4, openrouter-provider 2, hono-node-server 2, drizzle 0.45,
TS 6, vitest 4 + vite 8). Fixes aplicados: `declaration:false` en la app (TS4058 de ai v6) y `vite@^8`.

**🟢 CORRE END-TO-END EN LOCAL** (jun-2026, con keys): `db:migrate` creó el schema en Neon;
`pnpm ingest` pobló **29 chunks** (`gemini-embedding-2` de a uno, truncado a 1536); `/chat` responde
con **RAG real citando CV/portfolio/Last.fm**; **fallback** y **cortesía** en error verificados.
Pendiente de embeddings: el **triage multimodal de documentos** (diseño en `SPEC.md`) es fase 2.

**Falta para producción: deploy a Railway + integración del portafolio** (`ChatSheet.tsx` + proxy
`/api/agent`). Luego `apps/web`. Diseño: [`SPEC.md`](SPEC.md) · Workflow: [`../CLAUDE.md`](../CLAUDE.md).

---

## 🔴 Bloqueante (necesita cuentas/keys — solo Kevin)

Crear las cuentas y poner las keys en `Vaio/.env` (copiar de `.env.example`) y luego en los
secrets de Railway/Vercel. Cada una desbloquea:

| Cuenta / key | Desbloquea | Dónde |
|---|---|---|
| **OpenRouter** (`OPENROUTER_API_KEY`) | respuestas del agente + cadena de fallback (`agent.ts`) | openrouter.ai/keys |
| **Neon** (`DATABASE_URL`) | memoria/RAG (`memory.ts`, `ingest.ts`) | neon.tech (crear DB + `CREATE EXTENSION vector`) |
| **Embeddings** (`EMBEDDINGS_API_KEY`) | vectorizar fuentes (ingesta/búsqueda) | OpenAI u otro barato |
| **GitHub token** read-only (`GITHUB_TOKEN`) | ingerir perfil/repos | github.com/settings/tokens |
| **Railway** | hostear Vaio always-on (deploy) | railway.app |
| Last.fm (`LASTFM_*`) | música/gustos | **ya existen** (mismas del portafolio) |

Acciones de Kevin además: crear el **repo de Vaio en GitHub** y **conectarlo a Railway**; en
**Vercel** (portafolio) setear `AGENT_URL`, `AGENT_API_KEY` y Upstash Redis (rate-limit del proxy).

---

## 🟢 No bloqueante (se puede hacer ya, sin keys)

- **Código de Fase 1: HECHO** (monorepo, ports/adapters, Drizzle, tests). ✅
- **`apps/web` (frontend)** — la visión nueva: dashboard de configs/datos/conectores/flujos.
  Reusa `@vaio/contracts`. Diseñar con `brainstorming` antes de codear.
- **Integración en el portafolio (`KevinJGV`)** — **verificable con `npm run build`** aunque Vaio
  no esté live: `src/components/react/ChatSheet.tsx` (isla `client:visible`, botón flotante glass) +
  proxy `src/pages/api/agent.ts` (origin-check + rate-limit + stream passthrough).
- **Sincronizar la copia del SPEC en el portafolio** (`KevinJGV/docs/superpowers/specs/
  2026-06-09-vaio-agent-design.md`) con los cambios de arquitectura de hoy (pendiente).
- **DX opcional**: `Dockerfile` (Railway autodetecta Node/pnpm, no imprescindible); Turborepo
  (sumar cuando exista el 2º app).

---

## Decisión diferida: OpenSpec (tooling SDD)

Evaluado el 2026-06-10. **Decisión: NO adoptar todavía** — el flujo actual (`SPEC.md` +
superpowers) es eficiente para un servicio / una feature por vez, y meter tooling SDD pesado
ahora arriesga sobre-especificación / spec rot. **El disparador exacto para adoptarlo está
en [`../CLAUDE.md`](../CLAUDE.md) → "Cuándo escalar a OpenSpec"** (resumen: cuando `apps/web` +
fase 2 estén activos a la vez, o aparezcan ≥2 síntomas de que el `SPEC.md` monolítico quedó chico).

## Secuencia sugerida
1. (Kevin) cuentas + keys en `.env`; repo GitHub + Railway; env del portafolio en Vercel. *(bloqueante)*
2. `npm install`. *(ya)*
3. `memory.ts` (Neon+pgvector) con context7 → schema + búsqueda.
4. `ingest.ts` → `npm run ingest` para poblar la memoria. *(necesita Neon+embeddings)*
5. `agent.ts` + cablear `/chat`. *(necesita OpenRouter)*
6. Probar local (`/health`, `/chat` real, matar primario→fallback). Deploy a Railway.
7. Portafolio: `ChatSheet.tsx` + proxy `/api/agent`; conectar a Vaio; smoke test end-to-end.

> Pasos 2 y el *escribir+typecheck* de 3/5 son no-bloqueantes; *correr* (4,6) y el deploy necesitan keys.
> Definition of Done por tarea y verificación: ver `../CLAUDE.md`.
