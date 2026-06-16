# Design — Repo-awareness (detector a+b) + `findRepos` (c) + filosofía de tools

> **Plan de alto nivel + estrategia de ejecución:** [`2026-06-15-repo-awareness-findrepos-plan.md`](2026-06-15-repo-awareness-findrepos-plan.md).
> Continúa la capa de detectores ([`2026-06-15-knowledge-detectors-design.md`](2026-06-15-knowledge-detectors-design.md)).
> Este doc = spec técnico (firmas, algoritmo, edge-cases).

## Problema
El caso ACME dejó 2 gaps: (a) el `UnindexedRepoDetector` solo cazaba repos de UN nombre exacto ("ACME"), no
multi-palabra ("Tastrack"→"Tastrack_Challenge"); (b) Vaio no avisaba "lo que tengo de X es solo una descripción del
conector github, no el código". Y (c) faltaba responder queries de metadata ("proyectos con Java?", "topic X?").
**Decisión de Kevin (filosofía de tools):** no inflar el abanico de tools → tools-intención **extensibles** (crecen por
params), nunca un god-tool (el modelo orquestando operaciones viola #9).

## Filosofía de tools (principio nuevo)
**Pocas tools-intención EXTENSIBLES > muchas micro-tools > god-tool.** Una tool = UNA intención del usuario, que crece
por **parámetros** (filtros/opciones), no partiéndose en tools nuevas por cada micro-feature. Un god-tool
(`github({op})`) es lo PEOR: obliga al modelo a elegir operación y orquestar (anti-#9). Cada "plugin" futuro
(GitHub, Spotify, …) expone 2-3 tools extensibles, no N. → memoria `few-extensible-intent-tools` + `CLAUDE.md`.

## Fase 1 — Infra de detectores
`ports/knowledge-detector.ts`:
```ts
export interface RetrievedChunk { source: string; chunk: string }
export interface DetectContext { query: string; retrieved: RetrievedChunk[] } // antes: retrievedSources: string[]
export interface DetectionHint { note: string; repo?: string } // `repo` → el registry deduplica por repo
```
`core/detectors/registry.ts`: tras correr los detectores, **dedup por `hint.repo`** (mantiene la 1ª nota de cada repo;
las notas sin `repo` pasan todas) → luego cap. `FreshnessDetector` deriva los `repo:*` de `retrieved.map(r=>r.source)`.
`search-memory.ts` pasa `retrieved: combined.map(d => ({ source: d.source, chunk: d.chunk }))`.

## Fase 2 — `OwnerRepoCatalog` enriquecido
`core/repo-resolve.ts` `OwnerRepo`:
```ts
export interface OwnerRepo {
  name: string; defaultBranch: string
  language?: string | null; topics?: string[]; description?: string | null; stars?: number
}
```
`adapters/sources/owner-repos.ts`: `GhRepoListItem += language?, topics?, description?, stargazers_count?` (GitHub ya
los devuelve — `connectors/github.ts:21-30` lo prueba); `publicReposOnly` los mapea. Cache igual (10 min).

## Fase 3 — `UnindexedRepoDetector` enriquecido (a+b)
`core/repo-resolve.ts` — helper PURO:
```ts
/** Repos cuyo NOMBRE aparece en la query: (1) token == nombre normalizado exacto, o (2) token == SEGMENTO
 *  normalizado DISTINTIVO (aparece en UN solo repo del catálogo, len ≥4 → "Tastrack"→"Tastrack_Challenge",
 *  evita segmentos comunes "work"/"project"/"sql"). Conservador. */
export function reposNamedInQuery(query: string, repos: OwnerRepo[]): OwnerRepo[]
```
Algoritmo: tokenizar la query (`/[^\p{L}\p{N}]+/u` → normalizeRepoName, len≥3). Map normalized-segment→count sobre
todos los repos (segmentar cada nombre por `-_.` + el nombre completo). Para cada repo: match si (token == nombre
normalizado completo) OR (algún token == un segmento normalizado del repo con `count===1` y len≥4).

`core/detectors/unindexed-repo.ts` — combina DOS señales:
- **Señal nombre:** `reposNamedInQuery(query, catalog)`.
- **Señal contenido:** parsear los chunks `source==="github"` de `retrieved` con `/Repo "([^"]+)"/g` → nombres
  mencionados; quedarse con los que estén en el catálogo.
- Candidatos = unión, filtrando: NO recuperados (sin `repo:<owner>/<name>` en `retrieved`) y NO trackeados
  (`repoSync.isTracked`). Para cada candidato (cap 1-2): hint `{ repo: name, note: "[nota del sistema: tenés/
  mencionaste el repo \"X\" que NO tengo indexado; lo que tengo es solo una mención suelta, no el código → traelo con
  learnRepo (nombre \"X\") para responder con su contenido real.]" }`. Owner del env, no del modelo (#8).

## Fase 4 — tool `findRepos` (c, extensible)
`core/actions/find-repos.ts`:
```ts
export const findRepos: ActionDescriptor // name "findRepos", sideEffecting:false, clearance:"anyone"
// inputSchema: z.object({ language: z.string().optional(), topic: z.string().optional() }) — al menos uno
```
execute: `repos = await ctx.ownerRepos.listPublic()` (enriquecido; `[]`→degrada visible). Resolver `language`/`topic`
contra los valores REALES del catálogo (case-insensitive) → **fallo VISIBLE** si el filtro no matchea ningún valor
real ("no tenés repos en \"<X>\"; tus lenguajes son: …"). Filtrar repos por language y/o topic → devolver lista
(`name — description [language] url`). Excepción #8 (baja cardinalidad + fallo visible). Description: "Listá los repos
PÚBLICOS de Kevin por lenguaje y/o topic (p.ej. 'proyectos en Java', 'repos con topic X'). Extensible." Disponible en
TODOS los canales (metadata de repos públicos = pública). `registry.ts` + `capabilities.ts` (ToolName + 3 perfiles).
Helper PURO de filtrado (`core/repo-filter.ts` o en find-repos): `filterRepos(repos, {language?, topic?})` + resolución
de valores → testeable sin red.

## Edge-cases
- Detector: repo ya recuperado (`repo:*`) → no sugerir. Ya trackeado → no (el freshness lo cubre). Segmento común →
  no (distintividad). Dedup nombre+contenido → una nota por repo (vía `hint.repo`). github chunk sin `Repo "…"` → nada.
- findRepos: sin language ni topic → pedir uno (o degradar). language/topic inexistente → fallo visible con los valores
  reales. Catálogo `[]` (rate-limit) → degrada visible. Múltiples filtros → AND.
- Privacidad: solo repos PÚBLICOS (el catálogo ya filtra `private`).

## Invariantes
- **#8:** findRepos valida contra valores reales (fallo visible); el detector arma el spec con el owner del env.
- **#9:** findRepos = UNA intención extensible (no god-tool); el detector auto-contenido (no orquesta).
- **#1:** todo best-effort; degrada a `[]`/sin nota, nunca rompe el turno.

## TDD
1. `reposNamedInQuery` (puro): exacto · segmento distintivo multi-palabra · segmento común → no · varios.
2. `unindexed-repo` detector: señal-nombre · señal-contenido (github chunk) · dedup · ya-recuperado/trackeado → null.
3. `publicReposOnly` mapea language/topics/description/stars.
4. `filterRepos`/findRepos: por language · por topic · AND · valor inexistente → fallo visible · catálogo vacío.
5. registry: dedup por `repo`.
6. capabilities: findRepos en los 3 perfiles.
