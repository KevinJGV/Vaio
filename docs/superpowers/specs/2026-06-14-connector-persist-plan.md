# Plan de alto nivel — Faceta PERSIST de conectores (unificar ingesta)

> **Altitud:** fases, secuencia, estrategia. Detalle técnico → [`2026-06-14-connector-persist-design.md`](2026-06-14-connector-persist-design.md).

## Objetivo y entregable
Cada fuente de Kevin = UN conector con `live()` + `collect()`. `ingest.ts` itera `buildConnectors().collect()` (una
sola definición por fuente; el batch github/lastfm migra al framework). Persistencia "snapshot" igual que hoy, sin
regresión. La infra queda lista para conectores nuevos (WakaTime/Steam) y para acumulación/patrones (follow-up).

## Dependencias
Framework de conectores (gap ①, en main): `ports/connector.ts` (`collect?` ya está), `buildConnectors`, conectores
lastfm/github (`live`). Reusa `githubApi` (`sources/github-api.ts`), `toChunks` (`sources/util.ts`). Sin migración de schema.

## Fases
| # | Fase | Entregable | Verificación |
|---|---|---|---|
| 1 | collect() en conectores | `connectors/lastfm.ts` + `connectors/github.ts` (+collect, rename) + index imports | `connectors.test` (collect) |
| 2 | Ingesta unificada | `ingest.ts` itera `buildConnectors().collect()` + DEPRECATED clear | typecheck + e2e ingest |
| 3 | Limpieza | borrar `sources/github.ts`+`sources/lastfm.ts`; mover tests a connectors.test | suite verde |
| 4 | e2e + cierre | `pnpm ingest` persiste github/lastfm; psql verifica | conteos en DB |

## Secuencia
1 → 2 (ingest usa los collect de 1) → 3 (limpieza tras migrar) → 4. Secuencial/acoplado.

## Estrategia de ejecución
**Directo / orquestador.** Refactor acoplado (conectores + ingest + tests, toca la ingesta funcionando) + el hook
global de typecheck bloquea el estado intermedio no-compilable → subagentes en paralelo se pisarían (recurrente esta
sesión). TDD de los `collect()` (mockFetch, asserts migrados). Decisión visible (CLAUDE.md): acoplado + hook → directo.

## Verificación macro (DoD)
- `collect()` migrado; `ingest.ts` unificado en `buildConnectors`; persistencia snapshot sin regresión (sources
  "github"/"lastfm" iguales). Tests migrados verdes. `sources/{github,lastfm}.ts` borrados. Sin migración. Sin secrets.
- e2e: `pnpm ingest` → documents con source github/lastfm (conteos en DB); cv/me/contact limpios; searchMemory ok.
- typecheck/biome/build limpios. Docs reconciliados. Commit atómico en `feat/connector-persist`.

## Riesgos
Regresión de la ingesta (mitigado: misma lógica movida + e2e que verifica conteos) · borrar sources usados por otro
módulo (verificado: solo ingest+test usan collectGithub/collectLastfm; github-api/util se mantienen).

## Followups
Acumulación/patrones en el tiempo (snapshots fechados → tendencias; memoria episódica/aprendizaje) · conectores
WakaTime/Steam/GitHub-stats (live+collect) · cleanup de código muerto (collectRawRepo/collectCV/collectPortfolio).
