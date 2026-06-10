# Pendientes — Vaio (para retomar)

Estado: **scaffold + spec + CLAUDE.md/AGENTS.md + hooks + CI/Dependabot** listos y commiteados
(`b41370a`, `9248c43`, `3bf48cd`). Falta el código real de la Fase 1 y el deploy.
Diseño completo: [`SPEC.md`](SPEC.md) · Workflow: [`../CLAUDE.md`](../CLAUDE.md).

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

- **`npm install`** → resuelve deps + crea `package-lock.json` (activa typecheck/CI/hooks). Primer paso.
- **Escribir el código de la Fase 1 con context7** (se escribe y **typecheckea** sin keys; solo
  *correrlo* necesita las cuentas):
  - `memory.ts` — cliente Neon + pgvector (schema en el propio archivo) + `searchMemory`/`upsert`.
  - `ingest.ts` — fetch de fuentes públicas → chunk → embed → upsert.
  - `agent.ts` — `streamText` (Vercel AI SDK) + OpenRouter (fallback) + tool `searchMemory` + system prompt.
  - `index.ts` — cablear `/chat` (stream) sobre `agent.ts`.
- **Integración en el portafolio (`KevinJGV`)** — **verificable con `npm run build`** aunque Vaio
  no esté live: `src/components/react/ChatSheet.tsx` (isla `client:visible`, botón flotante glass) +
  proxy `src/pages/api/agent.ts` (origin-check + rate-limit + stream passthrough).
- **DX opcional** (si se quiere): Prettier/ESLint; `Dockerfile` (Railway autodetecta Node, no es
  imprescindible).

---

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
