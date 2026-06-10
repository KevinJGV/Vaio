# Vaio

Agente personal de IA de Kevin (Johan González). Servicio always-on que responde, con memoria
que se nutre, alimentado por el portafolio, GitHub, Spotify y el CV — accesible desde
[vindevsito.dev](https://vindevsito.dev) vía un chat lateral, y (más adelante) por Telegram y correo.

> **Spec completo:** [`docs/SPEC.md`](docs/SPEC.md) (en sync con el repo del portafolio
> `KevinJGV/docs/superpowers/specs/2026-06-09-vaio-agent-design.md`).

## Stack (Fase 1 / MVP)

- **Monorepo:** pnpm workspaces — `apps/agent` (el servicio) + `packages/contracts` (tipos/zod
  compartidos), hueco para `apps/web`. Arquitectura interna **ports/adapters-lite**.
- **Runtime agéntico:** Vercel AI SDK (`ai` v6) + OpenRouter (cadena de fallback multi-proveedor).
- **Server:** Hono (TS) — `POST /chat` (stream), `GET /health`.
- **Memoria/RAG:** Neon Postgres + `pgvector` vía **Drizzle ORM** (tabla `documents`; `facts` en fase 2).
- **Tooling:** Biome (lint+format), Vitest (tests), zod (validación de env). **Node 24** (LTS).
- **Hosting:** Railway (always-on).
- **Ingesta:** `cv.vindevsito.dev`, `vindevsito.dev/me`, GitHub API, Last.fm.

## Estado

🟢 **Fase 1 — código COMPLETO y verificado** (typecheck/build/lint/test verdes; server corre con
degradación). Deps al día (majors actualizados por Dependabot y verificados). **Bloqueante para
correr de verdad: keys** (OpenRouter/Neon/embeddings/GitHub) + deploy.
**Siguiente paso y pendientes: [`docs/NEXT-STEPS.md`](docs/NEXT-STEPS.md).**

## Desarrollo

```bash
pnpm install
cp .env.example .env   # completar secrets
pnpm ingest            # poblar la memoria (necesita Neon+embeddings; a mano / cron)
pnpm dev               # server local en :8787 (filtra @vaio/agent)
pnpm typecheck && pnpm build && pnpm lint && pnpm test   # verificación
```

## Cuentas/keys necesarias (las provee Kevin)

OpenRouter · Neon (Postgres) · Railway · GitHub token (read-only) · proveedor de embeddings ·
Last.fm (ya existe). Ver `.env.example`.
