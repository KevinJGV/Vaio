# Diseño técnico — Memoria viva de repos: sync incremental + frescura autónoma lazy (paso 3, parte 1)

> **Altitud:** spec técnico (DDL, firmas, edge-cases). Plan de alto nivel + estrategia →
> [`2026-06-14-repo-incremental-sync-plan.md`](2026-06-14-repo-incremental-sync-plan.md).
> Contexto: norte "Vaio se nutre solo" paso 3 (`docs/SPEC.md` · memoria `vaio-self-nourishing-memory-vision`).
> Reusa la maquinaria de pasos 1+2 (`2026-06-14-raw-repo-ingestion-design.md`).

## Objetivo y alcance
Mantener el índice de los repos **fresco solo, barato**, vía sync **incremental** (re-embeber **solo lo cambiado**
por blob-SHA) disparado **lazy** (solo cuando un repo relevante está stale), **autónomo y natural** en la charla.
**Decisión rectora:** lo indexado+vectorizado le gana al "leer en caliente" (más barato/rápido/preciso + alimenta
grafos) → el norte es mantener el índice al día, no leer frío.

**ESTE incremento (parte 1):** engine incremental + frescura barata + tools autónomas en chat para repos **ya
trackeados** (curados), **sync inline** (caso rápido). **FUERA (followups):** turnos proactivos ("Vaio retoma solo"),
ingesta on-demand de repo nuevo/arbitrario, cron, webhook. (Ver §Followups del plan.)

## Schema (migración drizzle-kit — `generate` + `migrate`, NO `db:push`)
```sql
-- documents: 2 columnas nuevas (nullable → legacy intacto: cv/me/github/lastfm y repos pre-sync quedan NULL)
ALTER TABLE "documents" ADD COLUMN "path" text;
ALTER TABLE "documents" ADD COLUMN "blob_sha" text;
CREATE INDEX "documents_source_path_idx" ON "documents" USING btree ("source","path","blob_sha");

-- estado de frescura/sync por repo (1 fila por source)
CREATE TABLE "tracked_repos" (
  "source"          text PRIMARY KEY,   -- 'repo:owner/repo'
  "owner"           text NOT NULL,
  "repo"            text NOT NULL,
  "branch"          text NOT NULL,      -- branch resuelto
  "last_commit_sha" text,               -- HEAD del branch en el último sync OK (frescura)
  "last_tree_sha"   text,               -- cross-check defensivo
  "policy_version"  integer DEFAULT 1,  -- si cambia el chunker/policy → forzar full
  "last_synced_at"  timestamp with time zone,
  "last_status"     text,               -- 'ok' | 'partial' | 'error'
  "embedded_count"  integer DEFAULT 0,
  "deleted_count"   integer DEFAULT 0,
  "created_at"      timestamp with time zone DEFAULT now()
);
```
**Por qué `path`/`blob_sha` EN `documents` y no un manifest aparte:** el manifest *es* `documents`
(`SELECT DISTINCT path, blob_sha`) → **una sola fuente de verdad**, imposible que diverja de sí misma ante un corte.
`blob_sha` = el SHA del blob de Git (viene en el árbol sin bajar contenido) → diff gratis. `DocChunk` (en
`@vaio/contracts`) suma `path?`/`blobSha?` **opcionales** (no rompe los otros collectors que no los setean).

## Lógica pura — `core/repo-sync.ts`
```ts
import type { TreeEntry, RepoIngestPolicy } from "./repo-ingest.js"

export interface IndexedFile { path: string; blobSha: string }
export interface RepoDiff { toEmbed: TreeEntry[]; toDelete: string[]; unchanged: number }

/** PURO. 1) filterTree(tree,policy)=kept (lo que DEBE estar). 2) manifest→Map<path,sha>.
 *  3) kept no-en-manifest o sha distinto → toEmbed; sha igual → unchanged.
 *  4) toDelete = paths del manifest que NO están en kept (borrado/rename/ahora-filtrado). */
export function diffRepoTree(currentTree: TreeEntry[], indexed: IndexedFile[], policy: RepoIngestPolicy): RepoDiff

export type FreshnessState = "fresh" | "stale" | "untracked"
export interface FreshnessResult { state: FreshnessState; remoteCommitSha: string; storedCommitSha?: string }
/** stored null → untracked (primer sync = full); igual → fresh; distinto → stale. */
export function compareFreshness(remoteCommitSha: string, storedCommitSha: string | null | undefined): FreshnessResult

/** Estima si el sync inline es "rápido" (≤ maxFiles archivos a embeber) o "largo". */
export function isInlineSync(diff: RepoDiff, maxFiles: number): boolean
```

## Puertos / adapters (I/O)
**`MemoryStore` (`ports/memory.ts`) — agrega (clearSource/upsertDocuments intactos):**
```ts
listIndexedFiles(source: string): Promise<IndexedFile[]>           // SELECT DISTINCT path,blob_sha WHERE path NOT NULL
deleteFiles(source: string, paths: string[]): Promise<void>        // DELETE WHERE source=$ AND path = ANY($)
replaceFile(source: string, path: string, rows: DocChunk[]): Promise<void>  // tx: delete(source,path)+embed+insert
```
`upsertDocuments` ahora persiste `path`/`blobSha` si vienen. `DocChunk += { path?: string; blobSha?: string }`.

**`RepoTracker` (`ports/repo-tracker.ts` + adapter `adapters/neon-tracker.ts`):**
```ts
export interface TrackedRepo { source: string; owner: string; repo: string; branch: string
  lastCommitSha: string | null; lastTreeSha: string | null; policyVersion: number }
export interface RepoTracker {
  get(source: string): Promise<TrackedRepo | null>
  upsert(rec: TrackedRepo & { status: string; embedded: number; deleted: number }): Promise<void>
}
```

**Orquestador `adapters/sources/repo-sync.ts`:**
```ts
export interface SyncReport { source: string; mode: "full"|"incremental"|"skipped-fresh"|"partial"|"error"
  embedded: number; deleted: number; unchanged: number }
export async function syncRepo(spec: RawRepoSpec, deps: { memory; tracker; token?; policy; logger? }): Promise<SyncReport>
export async function repoFreshness(spec: RawRepoSpec, deps: { tracker; token? }): Promise<FreshnessResult>
```
**Flujo `syncRepo` (idempotente):** resolver branch → `repoFreshness` (`GET /repos/{o}/{r}/commits/{branch}` →
HEAD sha) → si `fresh` y misma `policy_version` → `skipped-fresh` (0 embeddings, ni baja árbol) → si stale: árbol
recursivo → `listIndexedFiles` → `diffRepoTree` → **legacy reconcile** (si manifest vacío pero el source tiene filas
→ `clearSource` one-shot) → `deleteFiles(toDelete)` → por `toEmbed` (prosa-primero): `githubRaw`→`isProbablyText`
(si no→deleteFiles[path])→`hasSecret` (si sí→deleteFiles[path]+warn)→chunk+header→setear path/blobSha/url→
`replaceFile` (cap `maxChunksPerRepo`) → `tracker.upsert(lastCommitSha=remoteHead)` **al final**.
**`repoFreshness`:** llamada barata (1 request), comparación pura. `untracked` si no hay fila.

## Capa de autonomía (harness + prompt)
**Tools (registry, gating 2 capas):**
- `checkRepoFreshness({owner,repo})` — read, `clearance:"anyone"`, **todos los canales**, barato (`repoFreshness`).
  Devuelve `fresh|stale|untracked`. La usa cuando la respuesta depende del **estado ACTUAL** de un repo.
- `syncRepo({owner,repo})` — sync incremental, **autónoma sin HITL**, repos trackeados, todos los canales.
  **Duración-aware** (`isInlineSync`): rápido → inline (responde fresco); largo → NO bloquea: responde con el índice
  actual + (owner) caveat natural + **refresco en background** (fire-and-forget, patrón `persist` de agent.ts) → fresco
  para próximos turnos. Repo **no-trackeado** → denegado acá (parte 2). *(Reanudación proactiva mismo-hilo = incremento 2.)*
- `ActionContext` suma `repoTracker?` + `githubToken?` + `rawPolicy?` + `syncInlineMaxFiles?`. Wiring `index.ts`/`agent.ts`.

**Prompt (`prompt.ts`, por `audience`):** "cuando la respuesta dependa del estado ACTUAL de un repo que conocés,
verificá frescura; si está stale, sincronizá antes de responder. En chat público y con visitantes, **en silencio**;
**con Kevin**, mencionalo **natural**. Nunca pidas confirmación ni mandes mensajes dedicados a esto." **El 'pedí un
momento' NUNCA bloquea preguntas técnicas:** cómo funciona el sync/repo/código se responde libremente (reusa el
grounding de auto-introspección; el código es público vía `searchMemory`). La frescura NO agrega restricciones de divulgación.

**Entrypoint `apps/agent/src/sync.ts`** (hermano de `ingest.ts`): itera `rawSourceRepos(env)` → `syncRepo`,
best-effort. Hace el **primer sync full** (legacy) y el incremental. Manual ahora; cron = followup.

## Edge-cases
Rename = delete viejo + add nuevo (el header de procedencia lleva el path → re-embeber correcto) · archivo
(de)filtrado → toDelete/toEmbed · **árbol truncado** → NO borrar por ausencia, `status='partial'`, **no avanzar
last_commit_sha** (forzar reintento) · 404/privado → no tocar `documents`, `status='error'` · **corte a mitad** →
replaceFile atómico por archivo + sha al final → el próximo sync re-diffea desde el estado real, converge (nunca
corrupto) · cambio de chunker/policy → bump `policy_version` → full ese repo · `untracked` → manifest vacío → full natural.

## Tests (TDD)
- **Puros** (`test/repo-sync.test.ts`): `diffRepoTree` (manifest vacío→todo toEmbed; sha igual→unchanged; 1 cambiado→
  solo ese; nuevo→toEmbed; desaparecido→toDelete; rename; (de)filtrado), `compareFreshness` (untracked/fresh/stale),
  `isInlineSync` (umbral).
- **mockGithub** (`test/repo-sync-adapter.test.ts`, fakes de MemoryStore/RepoTracker en memoria): `syncRepo` fresh→
  skipped-fresh (sin baja de árbol); stale 1 archivo→1 replaceFile; archivo borrado→deleteFiles; truncado→sin deletes
  +partial+no-avanza-sha; archivo con secret→deleteFiles; 404→no toca documents+error; legacy (manifest vacío + filas)
  →clearSource una vez luego full.
- **tools** (`test/sync-actions.test.ts`): checkRepoFreshness devuelve estado; syncRepo inline vs largo (fake isInlineSync);
  repo no-trackeado→denegado; degradación sin tracker/memory.
