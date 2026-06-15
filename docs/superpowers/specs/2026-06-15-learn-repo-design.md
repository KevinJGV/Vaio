# Design — `learnRepo`: ingesta on-demand de un repo público de Kevin (paso 3 parte 2)

> **Plan de alto nivel + estrategia de ejecución:** [`2026-06-15-learn-repo-plan.md`](2026-06-15-learn-repo-plan.md).
> Este doc = **spec técnico de bajo nivel** (arquitectura, firmas, edge-cases). No repite las fases del plan.

## Problema
Norte "Vaio se nutre solo", **paso 3 parte 2**. Hoy Vaio solo conoce los repos del enum cerrado
`RAW_SOURCE_REPOS`; un repo fuera de ahí no se puede consultar/ingerir. Escenario conversacional: Kevin
pregunta por un repo SUYO no indexado → Vaio lo ingiere en background para responder. La maquinaria ya soporta
repos arbitrarios (`syncRepo` sobre un repo untracked hace full ingest y crea su `tracked_repos`; el freshness
gate mantiene fresco cualquier `repo:*` recuperado, no limitado al enum). Falta el **trigger on-demand** + la
**resolución del nombre** sin violar el Invariante #8.

## Decisiones (Kevin, 2026-06-15)
1. **Resolución (#8):** el modelo pasa un NOMBRE (string baja-cardinalidad); el sistema valida contra los repos
   REALES de Kevin (GitHub, cacheado). Match claro → procede **sin doble confirmación**; ambiguo → candidatos;
   sin match → fallo **VISIBLE** + sugerencias. Excepción permitida del #8 (baja cardinalidad + fallo visible).
2. **Privacidad:** SOLO repos de `GITHUB_USER` y SOLO **públicos** (`private===false`); owner-only. (Un privado en
   el RAG sería recuperable por el chat público anónimo → fuga.)
3. **v1 sin turnos proactivos:** ingest BACKGROUND fire-and-forget + "lo estoy trayendo, preguntá de nuevo".

## Arquitectura (ports/adapters-lite)
```
core/actions/learn-repo.ts        (acción: arma la tool; orquesta vía puertos; NO toca fetch)
   ├─ core/repo-resolve.ts        (PURO: resolveRepoName)
   └─ ctx.ownerRepos: OwnerRepoCatalog (puerto)   ctx.ownerUser: string (env, NUNCA del modelo)
            └─ adapters/sources/owner-repos.ts     (I/O: githubApi + filtro private + cache TTL)
```

## Firmas

### `core/repo-resolve.ts` (puro, sin I/O)
```ts
export interface OwnerRepo { name: string; defaultBranch: string } // ya filtrado a públicos por el adapter
export type RepoResolution =
  | { kind: "match"; repo: OwnerRepo }
  | { kind: "ambiguous"; candidates: OwnerRepo[] }   // cap ≤ ~5 para no inundar al modelo
  | { kind: "none"; suggestions: string[] }          // nombres cercanos para el fallo visible
/** lowercase + colapsa separadores [-_ .]+ a "" (o uno) → case/separador-insensitive. */
export function normalizeRepoName(s: string): string
/** Resuelve el nombre tipeado contra la lista real. Match exacto normalizado único → match;
 *  varios por prefijo/substring → ambiguous; ninguno → none + suggestions (substring + Levenshtein corto). */
export function resolveRepoName(name: string, repos: OwnerRepo[]): RepoResolution
```
Regla "sin doble confirmación": exacto normalizado único gana sobre prefijo/substring → `match` directo.

### `ports/owner-repos.ts`
```ts
import type { OwnerRepo } from "../core/repo-resolve.js"
export interface OwnerRepoCatalog {
  /** Repos PÚBLICOS del owner (private=false), cacheados. Nunca tira: ante error → []. */
  listPublic(): Promise<OwnerRepo[]>
}
```

### `adapters/sources/owner-repos.ts`
```ts
interface GhRepoListItem { name: string; private: boolean; default_branch: string; fork: boolean; archived: boolean }
export function publicReposOnly(list: GhRepoListItem[]): OwnerRepo[]   // PURO: filtra private===false → {name, defaultBranch}
export function createOwnerRepoCatalog(deps: {
  user: string; token?: string; logger?: Logger; ttlMs?: number  // ttl default 5–10 min
}): OwnerRepoCatalog
```
- Reusa `githubApi<GhRepoListItem[]>(\`/users/${user}/repos?sort=updated&per_page=100\`, token)` (mismo endpoint
  que `connectors/github.ts:85`, **tipo propio** porque la `GithubRepo` de ese conector NO trae `private`).
- Paginación `Link: rel="next"` con **cap ≤3 páginas** (≤300 repos); si trunca → `logger.warn`.
- Cache TTL en vida de proceso (variable + timestamp, patrón `lastChecked` de `createRepoSync`).
- `catch` → `[]` (degrada; Invariante #1).
- Filtra SOLO `private` (deja forks/archived: Kevin podría preguntar por uno).

### `core/actions/learn-repo.ts`
```ts
export const learnRepo: ActionDescriptor = { name: "learnRepo", sideEffecting: true, clearance: "owner", build(ctx) {...} }
// inputSchema: z.object({ repo: z.string().min(1).describe("El nombre del repo de Kevin (solo el nombre, no owner/).") })
```
Header documenta la **excepción al #8** (como `repo-select.ts`/`remember-fact.ts`). `execute`:
1. `if (!ctx.ownerRepos || !ctx.repoSync || !ctx.ownerUser)` → `done(false, "no puedo aprender repos ahora")`.
2. `repos = await ctx.ownerRepos.listPublic()`; `if (!repos.length)` → `done(false, "no pude consultar tus repos ahora mismo")`.
3. `res = resolveRepoName(input.repo, repos)`; switch:
   - **match**: `spec = { owner: ctx.ownerUser, repo: res.repo.name }`.
     - `if (await ctx.repoSync.isTracked(spec))` → `done(true, "Ese ya lo tengo indexado, preguntame directo.")`.
     - else `void ctx.repoSync.sync(spec).catch(()=>{})` + `done(true, "Lo estoy trayendo a mi memoria (toma un momentito); preguntame de nuevo en un rato.")`.
   - **ambiguous**: `done(true, "Tengo varios parecidos: <candidatos>. ¿Cuál?")` — sin ingerir.
   - **none**: `done(true, "No te encuentro un repo público con ese nombre." + (suggestions ? " ¿Quisiste decir <…>?" : ""))` — sin ingerir.

Emite `tool.result` (helper `done` espejo de `check-repo-freshness.ts`). `owner` NUNCA del modelo.

### Wiring
- `core/actions/types.ts` `ActionContext` += `ownerRepos?: OwnerRepoCatalog | null`, `ownerUser?: string`.
- `core/agent.ts`: deps `ownerRepos`/`ownerUser` → `buildTools({...})`.
- `index.ts`: `createOwnerRepoCatalog({ user: env.GITHUB_USER, token: env.GITHUB_TOKEN, logger })` + `ownerUser: env.GITHUB_USER` (gated por DB/token como `repoSync`).
- `core/capabilities.ts`: `ToolName` += `"learnRepo"`; en `allowedTools` **solo** del perfil owner-telegram (línea ~93). NO web/visitor (doble cinturón con el owner-only).
- `core/prompt.ts` / `TELEGRAM_POLICY`: guía ES+EN (ver plan, Fase 5).

## Reuso (sin cambios)
`syncRepo`/`createRepoSync` (untracked → full + upsert tracked; in-flight guard); `collectRawRepo`/policy/caps
(`maxChunksPerRepo`/`maxFileBytes`)/secret-scan; freshness gate (`ensureFresh` parsea cualquier `repo:*`);
`githubApi`. **Sin migración** (reusa `documents` + `tracked_repos`).

## Edge-cases
| Caso | Manejo |
|---|---|
| Ya indexado | `isTracked` → no re-ingiere |
| Privado que matchea por nombre | filtrado en el adapter → ni aparece → `none` (fuga cerrada) |
| Ingest falla en background | `.catch(()=>{})`; `syncRepo` best-effort (`mode:"error"`, no corrompe) |
| Repo enorme | caps existentes del policy |
| Rate-limit/error del listado | `listPublic()` → `[]` → degrada visible |
| >100 repos | paginación con cap ≤3 págs (warn si trunca) |
| Owner spoofing | owner del env, nunca del modelo |
| Spam mismo repo | in-flight guard de `createRepoSync` |
| Recién ingerido → retrieval/gate | `source=repo:owner/repo` entra al vector retrieval; el gate lo cubre |

## Invariantes
- **#8:** string baja-cardinalidad + validación contra lista real + fallo VISIBLE; owner/spec los arma el sistema.
- **#9:** UNA tool auto-contenida (resuelve+dispara en un execute); el re-llamado por `ambiguous` es desambiguación legítima, no relay de id.
- **#1:** toda rama/degradación responde; `void sync().catch()` nunca bloquea/lanza.
- **Privacidad:** filtro `private===false` en el adapter + owner-only + capa 1 oculta la tool al chat público.

## TDD
1. `core/repo-resolve.ts` (puro): match/ambiguous/none, normalización case+separador, sugerencias, lista vacía.
2. `learn-repo.ts` (fakes `ownerRepos`+`repoSync`): sync solo en match+no-tracked; no-ingiere en ya-tracked/
   ambiguous/none/lista-vacía; fire-and-forget no bloquea (gate `release()`); degrada sin puertos; bg-fail no rompe.
3. `owner-repos.ts`: `publicReposOnly` puro (filtro private); cache no re-pega; error→`[]`.
4. `capabilities`: `learnRepo` en owner, ausente en web/visitor.
