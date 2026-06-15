# Plan de alto nivel — Sentido del AHORA + framework de conectores (gap ①)

> **Altitud:** fases, secuencia, estrategia. Detalle técnico → [`2026-06-14-connectors-and-now-design.md`](2026-06-14-connectors-and-now-design.md).

## Objetivo y entregable
Vaio sabe la fecha/hora actual cada turno (TZ de Kevin) y puede traer on-demand su actividad/estado EN VIVO
(now-playing + commits recientes) desde una **infra de conectores extensible** (sumar fuente = implementar la
interfaz + key + 1 línea). Faceta persist + WakaTime/Steam = followups (interfaz lista).

## Dependencias
Reusa: `githubApi` (`adapters/sources/github-api.ts`), la base Last.fm de `adapters/sources/lastfm.ts`, el patrón
del registry de actions, `buildSystemPrompt`. Keys ya existentes (GITHUB_*, LASTFM_*). Sin migración.

## Fases
| # | Fase | Entregable | Verificación |
|---|---|---|---|
| 1 | Temporal | `config` (OWNER_TIMEZONE) + `core/time.ts` (formatNow) + prompt (now) + agent wiring | `time.test` + `prompt.test` |
| 2 | Puerto + conectores | `ports/connector.ts` + `adapters/connectors/{lastfm-now,github-activity,index}` | `connectors.test` (mockFetch) |
| 3 | Tool + wiring | `recent-activity.ts` + ActionContext + registry + capabilities + index.ts | `recent-activity.test` + typecheck |
| 4 | e2e + cierre | `/chat` (fecha + actividad) | traza `recentActivity` |

## Secuencia
1 (temporal) es independiente. 2 (conectores) → 3 (tool consume los conectores) → 4. Todo secuencial/acoplado por el wiring.

## Estrategia de ejecución
**Directo / orquestador.** Cambio acoplado (framework + tool + temporal + wiring en agent/index/capabilities) y el
hook global de typecheck hace que el estado intermedio no-compilable bloquee edits → subagentes en paralelo se
pisarían (recurrente esta sesión). Lo hago directo, con TDD de las piezas puras/mockeables (`formatNow`, conectores,
tool, prompt). Decisión visible (CLAUDE.md): acoplado + constraint del hook → directo.

## Verificación macro (DoD)
- Vaio sabe fecha/hora cada turno (TZ configurable, fallback seguro). `recentActivity` trae live de los conectores
  habilitados, best-effort, on-demand, todos los canales. Framework extensible (archivo + 1 línea) con `collect`
  lista para el follow-up de persistencia.
- typecheck/biome/test/build limpios. Sin secrets en el diff. Sin migración.
- Docs reconciliados (gap ① → hecho; framework + followups registrados). Commit atómico.

## Riesgos
Latencia eventos GitHub (frasear "reciente") · costo por invocación del tool (cheap, no por turno) · TZ inválida
(fallback ISO) · Invariante #1 (degrada por conector).

## Followups (registrar en NEXT-STEPS)
Faceta **persist** de conectores (`collect()` → memoria, "se nutre solo"; migrar github/lastfm batch al framework) ·
conectores **WakaTime/Steam/GitHub-stats** (interfaz lista) · mención **proactiva** de actividad → ⭐ turnos proactivos.
