# Design (TÉCNICO) — `hasOpenPRs`: PRs sin mergear como param de `findRepos`

> **Plan de alto nivel + estrategia de ejecución:** [`2026-06-15-findrepos-open-prs-plan.md`](2026-06-15-findrepos-open-prs-plan.md).
> Este doc = **diseño técnico de bajo nivel** (firmas, query, edge-cases). Candidato #2 del roadmap "queries vivas a
> GitHub": parte **PRs** (CI = incremento aparte; deploy Railway = aparte).

## Problema / norte
`findRepos` (la ÚNICA tool de "consultar repos", Invariante #10) crece por **params**, no por tools nuevas. Suma
estado **vivo** de GitHub: "¿qué repos tengo con **PRs sin mergear**?". Hoy solo filtra metadata cacheada
(language/topic).

## Insight de costo (define la arquitectura)
- **PRs abiertos** → **Search API** (`GET /search/issues`), cross-repo en **1 llamada**: barato.
- (CI sería **por-repo** → N llamadas → caro → diferido.)
El camino metadata sigue cacheado; el vivo agrega 1 llamada **solo cuando `hasOpenPRs` está set**.

## Endpoint (verificado en context7 `/websites/github_en_rest`)
```
GET /search/issues?q=<url-encode("is:pull-request is:open user:{owner} is:public")>&per_page=100
```
- `is:pull-request` (NO `is:pr` suelto: sin `is:issue`/`is:pull-request` GitHub da **422**). `is:open` = sin mergear/cerrar.
- `user:{owner}` = PRs en repos del owner. **`is:public`** = solo repos públicos (1er guard de privacidad, Inv #5).
- Respuesta: `{ total_count, items: [{ repository_url, number, title, html_url, state, … }] }`.
  `repository_url` = `https://api.github.com/repos/{owner}/{repo}` → de ahí el repo.
- Rate limit Search = **30/min** (1 call sobra). Auth con el token existente.

## Contratos / firmas

### 1. Puerto — `ports/owner-repos.ts` (hermano de `OwnerRepoCatalog`, concern distinto)
```ts
export interface OpenPR { repo: string; number: number; title: string; url: string }
export interface OwnerRepoActivity {
  /** PRs ABIERTOS en los repos PÚBLICOS del owner (Search API, 1 call, cacheado TTL).
   *  `null` = no se pudo consultar (degrada honesto); `[]` = genuinamente ninguno. */
  openPullRequests(): Promise<OpenPR[] | null>
}
```
`null` vs `[]` distingue "falló la query" de "no hay PRs" → mensaje honesto en `findRepos`.

### 2. Lógica PURA — `core/repo-activity.ts` (sin red, unit-testeable)
```ts
/** `https://api.github.com/repos/{owner}/{repo}` → "repo" (null si no matchea). */
export function parseRepoFromUrl(repositoryUrl: string): string | null
/** Agrupa PRs por repo (preserva el orden de aparición). */
export function groupPRsByRepo(prs: OpenPR[]): Map<string, OpenPR[]>
```

### 3. Adapter — `createOwnerRepoActivity` en `adapters/sources/owner-repos.ts`
```ts
createOwnerRepoActivity(deps: { user: string; token?: string; logger?: Logger; ttlMs?: number }): OwnerRepoActivity
```
- `q = "is:pull-request is:open user:" + user + " is:public"`; `githubApi('/search/issues?q=' + encodeURIComponent(q) + '&per_page=100')`.
- `items` → `OpenPR[]`: `{ repo: parseRepoFromUrl(it.repository_url), number: it.number, title: it.title, url: it.html_url }`
  (descarta items sin repo parseable). **TTL cache** (default 5 min, mismo patrón que `createOwnerRepoCatalog`).
- Error/red → `null` (logueado `warn`, Inv #1). Reusa `githubApi` (`sources/github-api.ts`).

### 4. Acción — `core/actions/find-repos.ts`
- `inputSchema` += `hasOpenPRs: z.boolean().optional().describe("Filtrar a repos con PRs sin mergear (abiertos); enriquece con los PRs.")`.
  Description de la tool: agregar "…o por PRs sin mergear (hasOpenPRs)".
- En `execute`, DESPUÉS de `filterRepos(repos, {language, topic})` (→ `res.matched`), si `hasOpenPRs === true`:
  1. `const prs = await ctx.repoActivity?.openPullRequests()`.
  2. `prs == null` → `done(true, "No pude consultar el estado de PRs ahora.")`. (incluye ctx sin `repoActivity`.)
  3. `byRepo = groupPRsByRepo(prs)`; `matched = res.matched.filter(r => byRepo.has(r.name))` — **intersección con el
     catálogo público = 2º guard de privacidad** (un repo privado nunca está en `res.matched`).
  4. `matched.length === 0` → `done(true, "No tenés PRs sin mergear" + filtrosSuffix + ".")`.
  5. **Enriquece** cada repo (cap 5 PRs): `• {name}{ [lang]} — {n} PR(s) sin mergear: #{num} "{title}"[, …]`.
- Sin `hasOpenPRs` → rama actual intacta (0 llamadas extra).

### 5. Wiring
- `core/actions/types.ts` — `ActionContext` += `repoActivity?: OwnerRepoActivity | null` (opcional, como `ownerRepos`).
- `index.ts` — `const repoActivity = token ? createOwnerRepoActivity({ user: env.GITHUB_USER, token, logger }) : null`
  e inyectar al ctx (junto a `ownerRepos`).

## Edge cases / invariantes
- **#5 privacidad (doble guard):** `is:public` en la query + intersección con `res.matched` (catálogo público-only).
- **#1 degrada:** `null` → "no pude consultar"; nunca rompe la tool ni expone privados; `[]` → "no tenés PRs".
- **#8:** booleano (baja cardinalidad); sin modo "valor desconocido" (a diferencia de language/topic) → el único
  fallo es la query viva, reportado honesto.
- **#10:** param de `findRepos`, NO tool nueva; CI/issues/releases futuros = mismo patrón de param.
- **Componibilidad:** `{language:"TypeScript", hasOpenPRs:true}` = repos TS **∩** con PRs (filtro metadata primero,
  intersección de PRs después).
- **Paginación:** `per_page=100` cubre el caso real (Kevin no tiene >100 PRs abiertos); si total_count>100 se ignora
  el resto (aceptable; logque­able a futuro). No paginamos en este incremento (YAGNI).

## Testing (TDD)
- **Puro** (`repo-activity.test.ts`): `parseRepoFromUrl` (ok / sin match / url rara); `groupPRsByRepo` (varios repos,
  orden, repo único).
- **Adapter** (`owner-repos.test.ts`, +describe): mock `fetch` de Search → parsea items → `OpenPR[]`; items sin repo
  parseable se descartan; TTL (2ª llamada no re-fetchea); error/red → `null`.
- **Acción** (`find-repos.test.ts`): fake `repoActivity`; `hasOpenPRs` con PRs → enriquece + intersecta (un PR de
  repo fuera del catálogo NO aparece); `[]` → "no tenés PRs"; `null`/sin dep → "no pude consultar"; combinado con
  `language` (intersección).
