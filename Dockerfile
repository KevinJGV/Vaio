# Dockerfile del monorepo pnpm — buildea @vaio/contracts (dep en runtime: objetos zod) y
# empaqueta un bundle PROD-ONLY autocontenido del agente con `pnpm deploy`. Reemplaza el
# autodetect de Railway (Railpack/Nixpacks). Ver docs/LEARNINGS.md (gotchas de deploy).
# syntax=docker/dockerfile:1

# ── base: Node 24 (== .nvmrc) + pnpm vía corepack ──────────────────────────────
FROM node:24-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# ── workspace: instala TODO el workspace y buildea en orden topológico ─────────
# (manifests primero → capa de install cacheable mientras no cambien deps).
FROM base AS workspace
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/agent/package.json apps/agent/package.json
RUN --mount=type=cache,id=s/88d92a9f-f4d6-42c0-a221-b7f5a6ed1a3c-/pnpm/store,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm -r build

# ── pruned: bundle autocontenido prod-only del agente (sin devDeps) ────────────
# `pnpm deploy --prod` copia @vaio/contracts (con su dist ya compilado) como dir real,
# no symlink → el bundle corre sin el resto del monorepo. Excluye pino-pretty (devDep).
# `--legacy`: pnpm 10 exige inject-workspace-packages para deploy salvo este flag (no tocamos
# el linker del workspace para no alterar el dev local). Ver docs/LEARNINGS.md.
FROM workspace AS pruned
RUN pnpm --filter @vaio/agent --prod --legacy deploy /prod/agent

# ── runtime: imagen mínima, solo el bundle del agente ──────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
# pino-pretty es devDep (no está en el bundle prod) → forzar json (lo captura Railway).
ENV LOG_FORMAT=json
COPY --from=pruned /prod/agent .
# Migraciones drizzle: el release step (railway.json preDeployCommand → db:migrate:prod) las aplica
# con el migrator de drizzle-orm (dep de prod) desde dist/. `runMigrations` las busca en ./migrations
# relativo al cwd (= /app), por eso se copian explícitamente (no asumimos qué incluye `pnpm deploy`).
COPY --from=workspace /app/apps/agent/migrations ./migrations
# Documental: el server bindea a $PORT (Railway lo inyecta; default 8787).
EXPOSE 8787
CMD ["node", "dist/index.js"]
