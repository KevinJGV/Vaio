# Vaio

Agente personal de IA de Kevin (Johan González). Servicio always-on que responde, con memoria
que se nutre, alimentado por el portafolio, GitHub, Spotify y el CV — accesible desde
[vindevsito.dev](https://vindevsito.dev) vía un chat lateral, y (más adelante) por Telegram y correo.

> **Spec completo:** [`docs/SPEC.md`](docs/SPEC.md) (en sync con el repo del portafolio
> `KevinJGV/docs/superpowers/specs/2026-06-09-vaio-agent-design.md`).

## Stack (Fase 1 / MVP)

- **Runtime agéntico:** Vercel AI SDK (`ai`) + OpenRouter (cadena de fallback multi-proveedor).
- **Server:** Hono (TS) — `POST /chat` (stream), `GET /health`.
- **Memoria/RAG:** Neon Postgres + `pgvector` (tabla `documents`; `facts` en fase 2).
- **Hosting:** Railway (always-on).
- **Ingesta:** `cv.vindevsito.dev`, `vindevsito.dev/me`, GitHub API, Last.fm.

## Estado

🚧 **Fase 1 en arranque.** Scaffold creado. Pendiente (siguiente paso, con context7 para fijar
la API real del Vercel AI SDK v6 y versiones):
- [ ] `npm install` (deps abajo) + verificar API del AI SDK con context7.
- [ ] `src/memory.ts` — cliente Neon/pgvector + `searchMemory`.
- [ ] `src/ingest.ts` — pipeline de ingesta (fetch fuentes → chunk → embed → upsert).
- [ ] `src/agent.ts` — `streamText` con OpenRouter + tools + system prompt.
- [ ] `src/index.ts` — wire `/chat` (stream) y `/health`.
- [ ] Deploy a Railway + Neon + secrets.
- [ ] Integración en el portafolio: `ChatSheet.tsx` + proxy `/api/agent`.

## Desarrollo

```bash
npm install
cp .env.example .env   # completar secrets
npm run ingest         # poblar la memoria (una vez / cron)
npm run dev            # server local en :8787
```

## Cuentas/keys necesarias (las provee Kevin)

OpenRouter · Neon (Postgres) · Railway · GitHub token (read-only) · proveedor de embeddings ·
Last.fm (ya existe). Ver `.env.example`.
