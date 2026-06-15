# Diseño técnico — Faceta PERSIST de conectores (unificar ingesta)

> **Altitud:** spec técnico (firmas, edge-cases). Plan de alto nivel + estrategia →
> [`2026-06-14-connector-persist-plan.md`](2026-06-14-connector-persist-plan.md). Construye sobre el framework de
> conectores ([`2026-06-14-connectors-and-now-design.md`](2026-06-14-connectors-and-now-design.md)).

## Objetivo
Activar la faceta `collect()` del `Connector` (ya declarada, sin usar) e **unificar** la ingesta batch de
github/lastfm dentro del framework: cada fuente = UN conector con `live()` (consultable) + `collect()` (persistible).
`ingest.ts` pasa a iterar `buildConnectors().collect()` → una sola definición por fuente. Modelo **snapshot actual**
(reemplaza en `documents` cada run, como hoy; acumulación/patrones = follow-up).

## Conectores unificados (uno por fuente)
`collect()` devuelve `DocChunk[]` con el MISMO `source` que el batch actual (para no romper `searchMemory`/`clearSource`).

- **`adapters/connectors/lastfm.ts`** (rename de `lastfm-now.ts`): `createLastfmConnector({apiKey,user}): Connector`,
  `name:"lastfm"`.
  - `live()` — recent/now-playing (sin cambios).
  - `collect()` — `user.gettopartists` (limit 30) → 1 `DocChunk` `{source:"lastfm", url:"https://www.last.fm/user/<u>",
    chunk:"Gustos musicales de Kevin (Last.fm, artistas más escuchados): …"}` (mueve la lógica de `sources/lastfm.ts::collectLastfm`,
    reusa `toChunks` de `sources/util.ts`). `[]` si no hay artistas. Best-effort: si falla, propaga el Error (igual que
    el batch hoy → `ingest.ts` lo loguea por collector) — collect NO necesita el catch-null de `live` (la ingesta es offline/best-effort por fuente).
- **`adapters/connectors/github.ts`** (rename de `github-activity.ts`): `createGithubConnector({user,token}): Connector`,
  `name:"github"`.
  - `live()` — events/public (sin cambios).
  - `collect()` — perfil (`/users/{user}`) + repos (`/users/{user}/repos?sort=updated&per_page=100`, no fork/archived)
    → `toChunks("github", "https://github.com/<user>", text)` (mueve la lógica de `sources/github.ts::collectGithub`,
    reusa `githubApi` de `sources/github-api.ts`).

`adapters/connectors/index.ts` (`buildConnectors`): imports → `createLastfmConnector`/`createGithubConnector`
(mismo gating: lastfm si LASTFM_*, github si GITHUB_USER). Ambos ya exponen `live` y ahora `collect`.

## Ingesta unificada (`ingest.ts`)
Reemplaza el bloque hardcodeado de collectors por:
```ts
const connectors = buildConnectors(env)
const collectors = connectors.filter((c) => c.collect)
for (const c of collectors) {
  try {
    const rows = await c.collect!()        // DocChunk[]
    const bySource = groupBy(rows, r => r.source)
    for (const [source, group] of bySource) { await memory.clearSource(source); await memory.upsertDocuments(group); log }
  } catch (err) { logger.error({ connector: c.name, err }, "collector falló") }  // best-effort por conector
}
```
Mantener el `clearSource(DEPRECATED_SOURCES)` (cv/cv-en/me/contact) one-shot. `runMigrations` + db/embedder igual.
Resultado: `ingest.ts` y la tool `recentActivity` usan el MISMO `buildConnectors`.

## Limpieza (parte del refactor)
- Borrar `adapters/sources/github.ts` (collectGithub + GithubConfig/interfaces) y `adapters/sources/lastfm.ts`
  (collectLastfm + LastfmConfig). Mantener `sources/github-api.ts` (githubApi/githubRaw, lo usan el conector github y
  repo-sync) y `sources/util.ts` (toChunks/fetchText, lo usan los conectores y collectRawRepo).
- Tests: mover los `describe("collectGithub")`/`describe("collectLastfm")` de `sources.test.ts` → `connectors.test.ts`
  como tests de `collect()`. `sources.test.ts` queda solo con `collectRawRepo`.

## Edge-cases
- `collect()` que falla → `ingest.ts` lo loguea por conector y sigue (best-effort), igual que hoy.
- `source` idéntico al batch ("github"/"lastfm") → `clearSource` + upsert idempotente, sin duplicar ni romper RAG.
- Conector sin `collect` (p.ej. uno futuro live-only) → `ingest` lo saltea (`filter(c=>c.collect)`).
- Snapshot (no acumulación): cada ingest reemplaza → sin crecimiento. Acumulación = follow-up.

## Tests
- `connectors.test.ts`: agregar `describe("lastfm.collect()")` (mockFetch gettopartists → 1 chunk source "lastfm";
  vacío → []) y `describe("github.collect()")` (perfil+repos → chunks source "github"; salta fork/archived). Reusar los
  asserts de los viejos tests. Mantener los tests de `live()` y `buildConnectors`.
- `sources.test.ts`: quitar collectGithub/collectLastfm (quedan los de collectRawRepo).
