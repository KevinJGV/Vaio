# Diseño técnico — Freshness gate (no confiarse de embebidos viejos sobre Kevin)

> **Altitud:** spec técnico (firmas, integración, edge-cases). Plan de alto nivel + estrategia →
> [`2026-06-14-freshness-gate-plan.md`](2026-06-14-freshness-gate-plan.md). Construye sobre el sync incremental
> ([`…-repo-incremental-sync-design.md`](2026-06-14-repo-incremental-sync-design.md)).

## Problema
El sync incremental dejó la frescura como capacidad, pero es **oportunista** (la decide el modelo, vía
`checkRepoFreshness`) y acotada a preguntas sobre código de repos. Para preguntas **sobre Kevin** (bio/stack/
proyectos) Vaio **responde por inercia** con los chunks indexados, sin chequear staleness. Y `cv/cv-en/me/contact`
(scrape) son **duplicados sin frescura** del repo del portafolio.

## Decisiones (Kevin)
1. **Gate determinístico** dentro de `searchMemory` (no a criterio del modelo), con **TTL ~10 min** por repo.
2. **Repo `KevinJGV/KevinJGV` = única fuente de verdad** de lo público → **dejar de scrapear** cv/me/contact
   (salvaguarda: verificar calidad del contenido del repo antes de dropear).
3. **Meta-conciencia** explícita en el prompt.

## Componentes

### `RepoSyncPort.ensureFresh` (`ports/repo-sync.ts` + impl en `adapters/sources/repo-sync.ts`)
```ts
// en RepoSyncPort:
ensureFresh(sources: string[]): Promise<{ refreshed: boolean }>
```
**Impl (en `createRepoSync`, con un `Map<string, number>` de TTL en el closure — vida de proceso):**
- Para cada `source` que empiece con `repo:` (los demás se ignoran): parsear → `{owner, repo}`.
- **TTL:** si `now - lastChecked.get(source) < ttlMs` → skip (no llama a GitHub).
- Si no: `freshness(spec)`. Si `stale`:
  - `r = await sync(spec, { inlineMaxFiles })`.
  - `r.mode` ∈ {incremental, full} → `refreshed = true`.
  - `r.mode === "deferred"` → `void sync(spec).catch(()=>{})` (refresco full en background) → NO marca refreshed.
  - set `lastChecked.set(source, now)`.
- Devuelve `{ refreshed }` = true si **algún** repo se sincronizó inline (→ el llamador re-recupera).
- **Nunca tira** (try/catch por source; un fallo de GitHub no rompe el turno). `ttlMs`/`inlineMaxFiles` se pasan a
  `createRepoSync` desde el wiring (`FRESHNESS_TTL_MINUTES`, `SYNC_INLINE_MAX_FILES`).

### Integración en `searchMemory` (`core/actions/search-memory.ts`)
Refactor: extraer la recuperación (vector wide-K → rerank → trim, ya existente) a una fn local `retrieve(): Promise<DocChunk[]>`.
```ts
let docs = await retrieve()
const repoSources = [...new Set(docs.map((d) => d.source).filter((s) => s.startsWith("repo:")))]
if (repoSources.length > 0 && ctx.repoSync) {
  try {
    const { refreshed } = await ctx.repoSync.ensureFresh(repoSources)
    if (refreshed) docs = await retrieve()   // una sola vez: incluye los chunks frescos
  } catch (err) {
    logger.warn({ err: errMsg(err) }, "freshness gate falló (se responde con lo indexado)")
  }
}
// …construir output como hoy (compresión Tier 1, tool.result, hits)…
```
**Coste:** en el caso común el TTL está cacheado → 0 requests, overhead nulo. Solo cuando expira TTL + hay stale se
paga 1 freshness + (si stale) el sync. Degrada limpio (Invariante #1).

### Meta-conciencia (`core/prompt.ts`, persona ES+EN)
Nueva línea: *"Tu conocimiento de lo que Kevin expone públicamente (bio, CV, proyectos, contacto) viene de su repo
del portafolio (vía `searchMemory`, que se mantiene fresco solo) y de los facts curados; no lo deduzcas de tu estilo."*

### Dejar de scrapear cv/me/contact (`ingest.ts`) — condicional a la salvaguarda
- Quitar `collectCV` + `collectPortfolio` del array de collectors. **Mantener** `collectGithub` (catálogo de repos,
  externo) y `collectLastfm` (música, externo).
- `DEPRECATED_SOURCES = ["cv","cv-en","me","contact"]` → `memory.clearSource(s)` para cada uno (idempotente; evita
  filas rancias huérfanas). Corre en `ingest.ts`.
- **Salvaguarda:** en la verificación e2e, sync full del repo + inspeccionar chunks "sobre Kevin"; si el contenido es
  pobre (Astro/MDX ilegible) → NO aplicar el drop+clear, mantener el scrape y registrar "frescura no-repo" (followup).

### Config (`config.ts` + `.env.example`)
`FRESHNESS_TTL_MINUTES: positiveIntWithDefault(10)`. Wiring: `createRepoSync({ …, ttlMs: env.FRESHNESS_TTL_MINUTES*60000, inlineMaxFiles: env.SYNC_INLINE_MAX_FILES })`.

## Edge-cases
- **Sin `repoSync`** (sin DB/token) → gate no corre, responde con lo indexado (degrada).
- **`ensureFresh` falla** → try/catch, responde con lo indexado.
- **deferred (diff grande)** → background + responde con lo actual (sin reanudación proactiva = ⭐ incremento 2).
- **Re-retrieve una sola vez** (no re-gate tras re-retrieve → sin loops).
- **TTL en memoria** → se resetea al reiniciar el proceso (acepta un chequeo extra tras restart; barato).
- **Sources no-repo en los resultados** (github/lastfm/facts) → ignorados por el gate (no fresh-ables acá).

## Tests
- **`repo-sync` (ensureFresh, con fakes):** TTL skip (2ª llamada misma ventana no chequea); stale→sync→`refreshed:true`;
  deferred→bg→`refreshed:false`; source no-repo ignorado; freshness que tira → no rompe.
- **`search-memory` (gate):** fake `repoSync.ensureFresh` que devuelve `refreshed:true` → `retrieve` se llama 2 veces;
  `refreshed:false` → 1 vez; sin `repoSync` → 1 vez (degrada); `ensureFresh` que tira → 1 vez + responde.
- **`config`:** `FRESHNESS_TTL_MINUTES` vacío → 10.
