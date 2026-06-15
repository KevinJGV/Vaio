# Diseño técnico — Conectores WakaTime · Steam · GitHub-stats

> **Altitud:** spec técnico (firmas, endpoints, shapes, edge-cases). Plan de alto nivel + estrategia →
> [`2026-06-14-connectors-wakatime-steam-stats-plan.md`](2026-06-14-connectors-wakatime-steam-stats-plan.md).
> Construye sobre el framework de conectores
> ([`2026-06-14-connectors-and-now-design.md`](2026-06-14-connectors-and-now-design.md)) + la faceta persist
> ([`2026-06-14-connector-persist-design.md`](2026-06-14-connector-persist-design.md)).

## Objetivo
Sumar **tres fuentes nuevas** al framework de conectores existente, cada una con sus dos facetas
(`live()` → "sentido del ahora" · `collect()` → memoria durable): **WakaTime** (tiempo de programación
medido), **Steam** (qué juega / juegos favoritos) y **GitHub-stats** (totales agregados + lenguajes reales
por bytes + racha). Es el followup directo de la faceta persist: "sumar fuente = archivo + push al registry".
**Cero cambios en el harness**: la tool `recentActivity` ya itera todos los `live()`; `ingest.ts` ya itera
todos los `collect()`. Modelo **snapshot** (igual que hoy; acumulación/patrones = follow-up).

## Config nueva (`config.ts`, zod) + gating (`buildConnectors`)
Tres envs nuevas, todas **opcionales** (fail-open: sin key → conector apagado, nunca rompe el boot):

| Conector | Envs | Gate en `buildConnectors` |
|---|---|---|
| `wakatime` | `WAKATIME_API_KEY` | `env.WAKATIME_API_KEY` |
| `steam` | `STEAM_API_KEY`, `STEAM_ID` (SteamID64) | `env.STEAM_API_KEY && env.STEAM_ID` |
| `github-stats` | *(reusa `GITHUB_USER` + `GITHUB_TOKEN`)* | `env.GITHUB_USER && env.GITHUB_TOKEN` |

`github-stats` **exige token** (GraphQL no acepta requests anónimas); el conector `github` (REST) sigue
gateado solo por `GITHUB_USER`. `.env.example` documenta las 3 nuevas **sin valores**.

## Conector WakaTime (`adapters/connectors/wakatime.ts`)
`createWakatimeConnector({apiKey}): Connector`, `name:"wakatime"`. Base `https://api.wakatime.com/api/v1`.
Auth: header `Authorization: Basic ${base64(apiKey)}` (helper interno; la key **nunca** se loguea).

- **`live()`** — `GET /users/current/stats/last_7_days`.
  - `202` (aún calculando) o `!ok` → `null` (best-effort).
  - `data.total_seconds === 0` → `null`.
  - Si hay datos → `⌨️ Esta semana Kevin programó ${human_readable_total}, sobre todo en ${topLangs}`
    donde `topLangs` = top-3 de `data.languages` por `percent` → `"TypeScript (52%), Python (19%)"`.
  - `try/catch → null`.
- **`collect()`** — `GET /users/current/stats/last_year`.
  - `!ok` → propaga `Error` (lo aísla `ingest`); `data` vacío → `[]`.
  - 1 `DocChunk` `source:"wakatime"`, `url:"https://wakatime.com/@<user-implícito>"` (sin user en config →
    URL genérica `https://wakatime.com`), texto:
    `"Tecnologías que Kevin usa de verdad, medidas por tiempo (WakaTime, último año): lenguajes <l1 %, l2 %…>; editores <…>; proyectos <…>. Total: <human_readable_total>."`
  - `toChunks("wakatime", url, text)`.

**Shapes** (verificados): `data.human_readable_total: string`, `data.total_seconds: number`,
`data.{languages,editors,projects}: {name, percent, text, total_seconds}[]`.

## Conector Steam (`adapters/connectors/steam.ts`)
`createSteamConnector({apiKey, steamId}): Connector`, `name:"steam"`. Base `https://api.steampowered.com`.
Auth: query `?key=${apiKey}` (la key **nunca** se loguea). Minutos→horas: `Math.round(min/60)`.

- **`live()`** — `GET /ISteamUser/GetPlayerSummaries/v2?steamids=<id>`.
  - `player.gameextrainfo` presente → `🎮 Kevin está jugando ahora: ${gameextrainfo}`.
  - Si no juega → fallback `GET /IPlayerService/GetRecentlyPlayedGames/v1?steamid=<id>&count=1` →
    `🎮 Lo último que jugó Kevin: ${name} (${h}h en 2 semanas)`.
  - Nada → `null`. `try/catch → null`. (`gameextrainfo` es **no-documentado oficialmente** pero estable en
    práctica; al ser best-effort, su ausencia degrada al fallback sin romper.)
- **`collect()`** — `GET /IPlayerService/GetOwnedGames/v1?steamid=<id>&include_appinfo=true&include_played_free_games=true`.
  - Respuesta vacía (perfil **privado** o sin juegos) → `[]`.
  - Top-N por `playtime_forever` (default 10) → 1 `DocChunk` `source:"steam"`,
    `url:"https://steamcommunity.com/profiles/<id>"`, texto:
    `"Juegos favoritos de Kevin (Steam, por horas jugadas): <Juego1 (Nh)>, <Juego2 (Mh)>…"`.
  - `toChunks("steam", url, text)`.

**Privacidad:** `GetOwnedGames`/`GetRecentlyPlayedGames` devuelven vacío si el perfil de juegos es privado →
`[]`/`null` (sin error). `GetPlayerSummaries` anda igual (campos básicos).
**Shapes:** summaries `response.players[0].{personastate, gameextrainfo?, gameid?, communityvisibilitystate}`;
recently/owned `response.games[]: {appid, name, playtime_2weeks?, playtime_forever, img_icon_url}` (minutos).

## Conector GitHub-stats (`adapters/connectors/github-stats.ts`)
`createGithubStatsConnector({user, token}): Connector`, `name:"github-stats"`. **GraphQL** (REST no da
totales/streak/langs-por-bytes). Nuevo helper en `sources/github-api.ts`:
`githubGraphql<T>(query, variables, token): Promise<T>` (POST `https://api.github.com/graphql`,
`Authorization: bearer <token>`, `Content-Type: application/json`; tira en `!ok` o si `body.errors`).

**Query única** (variables `{login, from: <hace 1 año ISO>, to: null}`):
```graphql
query($login:String!, $from:DateTime, $to:DateTime){
  user(login:$login){
    repositories(ownerAffiliations:OWNER, isFork:false, first:100){
      totalCount
      nodes{ stargazers{ totalCount }
             languages(first:10, orderBy:{field:SIZE,direction:DESC}){ edges{ size node{ name } } } }
    }
    contributionsCollection(from:$from, to:$to){
      totalCommitContributions totalPullRequestContributions totalIssueContributions
      contributionCalendar{ totalContributions weeks{ contributionDays{ contributionCount date } } }
    }
  }
}
```
*(Snapshot pragmático: 1 página de 100 repos sin re-paginar; el `from`=hace-1-año lo calcula `core/time`/
`new Date` en el adapter — fuera de la lógica pura, ver Testing.)*

- **`collect()`** — chunk `source:"github-stats"`, `url:"https://github.com/<user>"`, texto:
  `"Stats de GitHub de Kevin (@<user>): <N> repos públicos, <M> stars totales; el último año: <C> commits, <P> PRs, <I> issues (<T> contribuciones). Racha más larga: <D> días. Lenguajes top por código real: TypeScript 41%, Java 28%…"`.
  - `totalStars` = Σ `nodes[].stargazers.totalCount`.
  - `topLanguages` = agregar `nodes[].languages.edges[].size` por `node.name`, % sobre el total de bytes, top-5.
  - `longestStreak` = de `contributionCalendar.weeks[].contributionDays[]` (función pura).
- **`live()`** — racha **actual** de la misma `contributionCalendar` (función pura `currentStreak`):
  `🔥 Kevin lleva ${n} días de racha de contribuciones en GitHub` · `n===0 → null`. (No duplica el `live`
  de `github`, que es pushes recientes.)

## Lógica pura (en `core/`, TDD con fixtures)
Extraída para tests sin red. Nuevo `core/connector-stats.ts`:
- `currentStreak(days: {contributionCount:number; date:string}[], today:string): number` — cuenta hacia atrás
  desde hoy mientras `count>0`; si hoy es 0 pero ayer >0, sigue contando desde ayer (no rompe la racha por el
  día en curso). `today` se inyecta (determinismo en test).
- `longestStreak(days): number` — máxima corrida de `count>0`.
- `aggregateLanguages(nodes): {name:string; percent:number}[]` — suma bytes por lenguaje, ordena, %, top-5.
- `topByPercent(items, n)` (WakaTime) y `topByPlaytime(games, n)` (Steam) — formateo/orden puros.
`weeks → days` se aplana en el adapter; las funciones reciben el array plano de días.

## Degradación (Invariante #1)
- `live()` de los tres → `try/catch → null` (idéntico a los conectores actuales; la tool `recentActivity` ya
  trata `null` como "sin datos").
- `collect()` puede tirar; `ingest.ts` lo aísla **best-effort por conector** (ya lo hace).
- WakaTime `202` y Steam perfil-privado → degradan a `null`/`[]` sin error.

## Seguridad
Keys (`WAKATIME_API_KEY`, `STEAM_API_KEY`, `GITHUB_TOKEN`) **nunca** en logs ni en chunks. La data servida es
pública (perfil público de Steam, stats de WakaTime/GitHub). Sin secrets en `documents`.

## Registry (`adapters/connectors/index.ts`)
`buildConnectors` += imports y push gateados de los tres `create*Connector`. Orden: lastfm, github,
**github-stats, wakatime, steam** (no importa funcionalmente).

## Tests (`test/connectors.test.ts` + `test/connector-stats.test.ts`)
- **`connector-stats.test.ts`** (puro, sin mocks de red): `currentStreak` (racha viva, hoy-0-ayer>0, sin racha,
  todo-cero), `longestStreak`, `aggregateLanguages` (suma bytes, %, top-5), `topByPercent`/`topByPlaytime`.
- **`connectors.test.ts`** (mock `fetch`/`githubApi`/`githubGraphql`): por conector, `live()`
  (caso con datos / fallback / null) y `collect()` (chunk shape con `source` correcto / vacío→`[]`). WakaTime
  `202→null`; Steam `gameextrainfo` presente vs fallback recently-played vs perfil privado→`[]`; github-stats
  parseo de la query GraphQL.
- `buildConnectors`: gating de los tres (con/sin sus envs).
