# Conectores WakaTime · Steam · GitHub-stats — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development o executing-plans.
> Steps con checkbox (`- [ ]`). Diseño técnico (firmas, endpoints, shapes) →
> [`2026-06-14-connectors-wakatime-steam-stats-design.md`](2026-06-14-connectors-wakatime-steam-stats-design.md)
> (NO se repite acá — referirse a él para los detalles de API).

**Goal:** Sumar tres conectores (WakaTime, Steam, GitHub-stats) al framework existente, cada uno con `live()` +
`collect()`, sin tocar el harness.

**Architecture:** Lógica pura (streak, agregaciones, formateos) en `core/connector-stats.ts` (TDD). Tres
adapters en `adapters/connectors/`. Helper `githubGraphql` en `sources/github-api.ts`. Registro gateado en
`buildConnectors`. La tool `recentActivity` (live) e `ingest.ts` (collect) los recogen solos.

**Tech Stack:** TypeScript estricto (ESM, `.js` imports), zod (config), Vitest (mock `fetch`).

---

## Estrategia de ejecución (OBLIGATORIA)

**Recomendación: DIRECTO / secuencial (yo-orquestador), NO subagentes en paralelo.** Justificación por
tamaño + acoplamiento:
- **Acoplamiento por estado compartido:** los tres conectores tocan los MISMOS archivos pivote —
  `config.ts` (envs), `adapters/connectors/index.ts` (registry), `core/connector-stats.ts` (lógica pura
  compartida), `.env.example`. No son islas.
- **El hook `PostToolUse` de typecheck bloquea todo edit ante un estado roto** (aprendizaje registrado en
  specs previos): subagentes en paralelo editando `index.ts`/`config.ts`/`connector-stats.ts` se pisarían y
  uno con typecheck roto frena a los demás.
- **Tareas chicas** ("un archivo + una línea", ~60 líneas/conector): el overhead de orquestar subagentes no
  rinde. El framework ya existe; esto es rellenar la interfaz.
- **Secuencia natural:** core puro (Task 2) y `githubGraphql` (Task 3) son fundación de los conectores
  (Tasks 4-6); el registry (Task 7) los necesita a todos. Hay dependencias → secuencial.

Decisión visible: **directo**. (Si Kevin prefiere subagentes para los 3 conectores en paralelo tras la
fundación, es viable pero con el riesgo del hook; no lo recomiendo.)

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `apps/agent/src/config.ts` (mod) | + `WAKATIME_API_KEY`, `STEAM_API_KEY`, `STEAM_ID` |
| `apps/agent/src/core/connector-stats.ts` (nuevo) | Lógica pura: streak, agregación de langs, formateos |
| `apps/agent/src/adapters/sources/github-api.ts` (mod) | + helper `githubGraphql` |
| `apps/agent/src/adapters/connectors/wakatime.ts` (nuevo) | Conector WakaTime |
| `apps/agent/src/adapters/connectors/steam.ts` (nuevo) | Conector Steam |
| `apps/agent/src/adapters/connectors/github-stats.ts` (nuevo) | Conector GitHub-stats (GraphQL) |
| `apps/agent/src/adapters/connectors/index.ts` (mod) | Registrar los tres (gateados) |
| `apps/agent/test/connector-stats.test.ts` (nuevo) | Tests puros |
| `apps/agent/test/connectors.test.ts` (mod) | Tests de adapters + gating |
| `.env.example` (mod) | Documentar las 3 envs nuevas |

---

## Task 1: Config — envs nuevas

**Files:** Modify `apps/agent/src/config.ts`; Modify `.env.example`

- [ ] **Step 1: Agregar las envs al `envSchema`** (tras el bloque `LASTFM_*`, línea ~74)

```ts
  // Conector WakaTime (tiempo de programación medido). Opcional → sin key, el conector no corre.
  WAKATIME_API_KEY: z.string().optional(),
  // Conector Steam (qué juega / juegos favoritos). Requiere ambas. SteamID64 (perfil de juegos público).
  STEAM_API_KEY: z.string().optional(),
  STEAM_ID: z.string().optional(),
```

- [ ] **Step 2: Documentar en `.env.example`** (sin valores)

```
# Conector WakaTime — tiempo de programación medido (wakatime.com/settings/api-key)
WAKATIME_API_KEY=
# Conector Steam — qué juega / favoritos (steamcommunity.com/dev/apikey + tu SteamID64; perfil de juegos público)
STEAM_API_KEY=
STEAM_ID=
```

- [ ] **Step 3: Verificar typecheck** — `pnpm --filter @vaio/agent typecheck` → PASS

- [ ] **Step 4: Commit**

```bash
git add apps/agent/src/config.ts .env.example
git commit -m "feat(connectors): envs de WakaTime y Steam"
```

---

## Task 2: Lógica pura — `core/connector-stats.ts` (TDD)

**Files:** Create `apps/agent/src/core/connector-stats.ts`; Create `apps/agent/test/connector-stats.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { describe, expect, it } from "vitest"
import {
  aggregateLanguages,
  currentStreak,
  longestStreak,
  topByPercent,
  topByPlaytime,
} from "../src/core/connector-stats.js"

describe("currentStreak", () => {
  it("cuenta días consecutivos con contribuciones hasta hoy", () => {
    const days = [
      { contributionCount: 1, date: "2026-06-12" },
      { contributionCount: 2, date: "2026-06-13" },
      { contributionCount: 1, date: "2026-06-14" },
    ]
    expect(currentStreak(days, "2026-06-14")).toBe(3)
  })
  it("hoy en 0 pero ayer >0 → la racha sigue viva (no rompe por el día en curso)", () => {
    const days = [
      { contributionCount: 1, date: "2026-06-12" },
      { contributionCount: 2, date: "2026-06-13" },
      { contributionCount: 0, date: "2026-06-14" },
    ]
    expect(currentStreak(days, "2026-06-14")).toBe(2)
  })
  it("ayer en 0 → sin racha", () => {
    const days = [
      { contributionCount: 5, date: "2026-06-12" },
      { contributionCount: 0, date: "2026-06-13" },
      { contributionCount: 0, date: "2026-06-14" },
    ]
    expect(currentStreak(days, "2026-06-14")).toBe(0)
  })
})

describe("longestStreak", () => {
  it("máxima corrida de días con contribuciones", () => {
    const days = [
      { contributionCount: 1, date: "2026-06-10" },
      { contributionCount: 1, date: "2026-06-11" },
      { contributionCount: 0, date: "2026-06-12" },
      { contributionCount: 1, date: "2026-06-13" },
      { contributionCount: 1, date: "2026-06-14" },
    ]
    expect(longestStreak(days)).toBe(2)
  })
})

describe("aggregateLanguages", () => {
  it("suma bytes por lenguaje, ordena desc, calcula % y recorta a top-5", () => {
    const nodes = [
      { languages: { edges: [{ size: 100, node: { name: "TypeScript" } }] } },
      {
        languages: {
          edges: [
            { size: 100, node: { name: "TypeScript" } },
            { size: 50, node: { name: "Java" } },
          ],
        },
      },
    ]
    const out = aggregateLanguages(nodes)
    expect(out[0]).toEqual({ name: "TypeScript", percent: 80 })
    expect(out[1]).toEqual({ name: "Java", percent: 20 })
  })
  it("sin bytes → []", () => {
    expect(aggregateLanguages([{ languages: { edges: [] } }])).toEqual([])
  })
})

describe("topByPercent", () => {
  it("top-n por percent, formato 'Nombre (X%)'", () => {
    const items = [
      { name: "TypeScript", percent: 52.4 },
      { name: "Python", percent: 19.1 },
      { name: "Go", percent: 5 },
    ]
    expect(topByPercent(items, 2)).toBe("TypeScript (52%), Python (19%)")
  })
})

describe("topByPlaytime", () => {
  it("top-n por minutos jugados, formato 'Nombre (Xh)'", () => {
    const games = [
      { name: "Dota 2", playtime_forever: 12000 },
      { name: "CS2", playtime_forever: 6000 },
    ]
    expect(topByPlaytime(games, 2)).toBe("Dota 2 (200h), CS2 (100h)")
  })
})
```

- [ ] **Step 2: Correr y verificar que falla** — `pnpm --filter @vaio/agent test connector-stats` → FAIL (módulo no existe)

- [ ] **Step 3: Implementar `core/connector-stats.ts`**

```ts
// Lógica PURA de los conectores de stats (sin I/O): racha de contribuciones, agregación de lenguajes por
// bytes, formateos de top-N. Testeable con fixtures (el `today` se inyecta para determinismo).

interface Day {
  contributionCount: number
  date: string
}

/** Racha ACTUAL: cuenta hacia atrás desde el último día con contribuciones. Si hoy está en 0 pero el día
 *  previo tiene contribuciones, la racha sigue viva (no la rompe el día en curso). */
export function currentStreak(days: Day[], today: string): number {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
  let streak = 0
  for (let i = sorted.length - 1; i >= 0; i--) {
    const day = sorted[i]
    if (!day) break
    if (day.contributionCount > 0) {
      streak++
    } else if (day.date === today) {
      // El día en curso aún sin commits no rompe la racha: seguí mirando ayer.
      continue
    } else {
      break
    }
  }
  return streak
}

/** Racha MÁS LARGA: máxima corrida de días con contribuciones. */
export function longestStreak(days: Day[]): number {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
  let best = 0
  let run = 0
  for (const day of sorted) {
    if (day.contributionCount > 0) {
      run++
      best = Math.max(best, run)
    } else {
      run = 0
    }
  }
  return best
}

interface LangNode {
  languages: { edges: { size: number; node: { name: string } }[] }
}

/** Agrega bytes por lenguaje sobre todos los repos, ordena desc, calcula % sobre el total y recorta a top-5.
 *  Porcentajes redondeados a entero. */
export function aggregateLanguages(
  nodes: LangNode[]
): { name: string; percent: number }[] {
  const bytes = new Map<string, number>()
  for (const repo of nodes) {
    for (const edge of repo.languages.edges) {
      bytes.set(edge.node.name, (bytes.get(edge.node.name) ?? 0) + edge.size)
    }
  }
  const total = [...bytes.values()].reduce((a, b) => a + b, 0)
  if (total === 0) return []
  return [...bytes.entries()]
    .map(([name, size]) => ({ name, percent: Math.round((size / total) * 100) }))
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 5)
}

/** "Nombre (X%), …" para los top-n por percent (WakaTime languages/editors/projects). */
export function topByPercent(
  items: { name: string; percent: number }[],
  n: number
): string {
  return items
    .slice(0, n)
    .map((i) => `${i.name} (${Math.round(i.percent)}%)`)
    .join(", ")
}

/** "Nombre (Xh), …" para los top-n por minutos jugados (Steam). */
export function topByPlaytime(
  games: { name: string; playtime_forever: number }[],
  n: number
): string {
  return [...games]
    .sort((a, b) => b.playtime_forever - a.playtime_forever)
    .slice(0, n)
    .map((g) => `${g.name} (${Math.round(g.playtime_forever / 60)}h)`)
    .join(", ")
}
```

- [ ] **Step 4: Correr y verificar que pasa** — `pnpm --filter @vaio/agent test connector-stats` → PASS

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/core/connector-stats.ts apps/agent/test/connector-stats.test.ts
git commit -m "feat(connectors): lógica pura de stats (streak, langs, formateos)"
```

---

## Task 3: Helper `githubGraphql`

**Files:** Modify `apps/agent/src/adapters/sources/github-api.ts`

- [ ] **Step 1: Agregar el helper al final del archivo**

```ts
/** POST a la GitHub GraphQL API → `data` tipado. Lanza Error con status/body o si el payload trae `errors`
 *  (lo loguea el llamador). Requiere token (GraphQL no acepta requests anónimas). */
export async function githubGraphql<T>(
  query: string,
  variables: Record<string, unknown>,
  token: string
): Promise<T> {
  const res = await fetch(`${BASE}/graphql`, {
    method: "POST",
    headers: {
      authorization: `bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "vaio-ingest",
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(
      `GitHub GraphQL → ${res.status}${body ? ` · ${body.slice(0, 200)}` : ""}`
    )
  }
  const json = (await res.json()) as { data?: T; errors?: unknown }
  if (json.errors || !json.data) {
    throw new Error(`GitHub GraphQL errores: ${JSON.stringify(json.errors)?.slice(0, 200)}`)
  }
  return json.data
}
```

- [ ] **Step 2: Verificar typecheck** — `pnpm --filter @vaio/agent typecheck` → PASS

- [ ] **Step 3: Commit**

```bash
git add apps/agent/src/adapters/sources/github-api.ts
git commit -m "feat(connectors): helper githubGraphql"
```

---

## Task 4: Conector WakaTime (TDD)

**Files:** Create `apps/agent/src/adapters/connectors/wakatime.ts`; Modify `apps/agent/test/connectors.test.ts`

- [ ] **Step 1: Escribir los tests que fallan** (agregar a `connectors.test.ts`, importar el create)

```ts
import { createWakatimeConnector } from "../src/adapters/connectors/wakatime.js"

describe("conector WakaTime — live()", () => {
  const c = createWakatimeConnector({ apiKey: "k" })
  it("stats con datos → resumen de la semana", async () => {
    mockFetch(() => ({
      json: {
        data: {
          human_readable_total: "18 hrs",
          total_seconds: 64800,
          languages: [
            { name: "TypeScript", percent: 52 },
            { name: "Python", percent: 19 },
          ],
        },
      },
    }))
    const out = await c.live()
    expect(out).toContain("18 hrs")
    expect(out).toContain("TypeScript (52%)")
  })
  it("total 0 → null; fetch !ok → null", async () => {
    mockFetch(() => ({ json: { data: { total_seconds: 0, languages: [] } } }))
    expect(await c.live()).toBeNull()
    mockFetch(() => ({ ok: false }))
    expect(await c.live()).toBeNull()
  })
})

describe("conector WakaTime — collect()", () => {
  const c = createWakatimeConnector({ apiKey: "k" })
  it("stats del último año → 1 chunk source 'wakatime'", async () => {
    mockFetch(() => ({
      json: {
        data: {
          human_readable_total: "400 hrs",
          languages: [{ name: "TypeScript", percent: 60 }],
          editors: [{ name: "VS Code", percent: 90 }],
          projects: [{ name: "Vaio", percent: 40 }],
        },
      },
    }))
    const rows = (await c.collect?.()) ?? []
    expect(rows[0]?.source).toBe("wakatime")
    expect(rows[0]?.chunk).toContain("TypeScript")
    expect(rows[0]?.chunk).toContain("VS Code")
  })
})
```

- [ ] **Step 2: Correr y verificar que falla** — `pnpm --filter @vaio/agent test connectors` → FAIL (módulo no existe)

- [ ] **Step 3: Implementar `wakatime.ts`**

```ts
// Conector WakaTime — UNA fuente, dos facetas:
//  - live(): cuánto programó Kevin esta semana y en qué. Best-effort → null.
//  - collect(): tecnologías que usa de verdad, medidas por tiempo (último año) → DocChunk[] (snapshot).

import type { Connector } from "../../ports/connector.js"
import type { DocChunk } from "../../ports/memory.js"
import { topByPercent } from "../../core/connector-stats.js"
import { toChunks } from "../sources/util.js"

const BASE = "https://api.wakatime.com/api/v1"

interface WakaBucket {
  name: string
  percent: number
}
interface WakaStats {
  data?: {
    human_readable_total?: string
    total_seconds?: number
    languages?: WakaBucket[]
    editors?: WakaBucket[]
    projects?: WakaBucket[]
  }
}

export function createWakatimeConnector(cfg: { apiKey: string }): Connector {
  // Basic auth con la api_key en base64 (la key NUNCA se loguea).
  const auth = `Basic ${Buffer.from(cfg.apiKey).toString("base64")}`
  const get = async (range: string): Promise<WakaStats["data"] | null> => {
    const res = await fetch(`${BASE}/users/current/stats/${range}`, {
      headers: { authorization: auth },
    })
    if (!res.ok) return null // 202 (calculando) o error → sin datos
    return ((await res.json()) as WakaStats).data ?? null
  }

  return {
    name: "wakatime",

    async live(): Promise<string | null> {
      try {
        const data = await get("last_7_days")
        if (!data || !data.total_seconds) return null
        const langs = topByPercent(data.languages ?? [], 3)
        const total = data.human_readable_total ?? "un rato"
        return langs
          ? `⌨️ Esta semana Kevin programó ${total}, sobre todo en ${langs}`
          : `⌨️ Esta semana Kevin programó ${total}`
      } catch {
        return null
      }
    },

    async collect(): Promise<DocChunk[]> {
      const data = await get("last_year")
      if (!data) return []
      const langs = topByPercent(data.languages ?? [], 5)
      const editors = topByPercent(data.editors ?? [], 3)
      const projects = topByPercent(data.projects ?? [], 5)
      if (!langs && !editors && !projects) return []
      const text =
        `Tecnologías que Kevin usa de verdad, medidas por tiempo (WakaTime, último año): ` +
        `lenguajes ${langs || "—"}; editores ${editors || "—"}; proyectos ${projects || "—"}. ` +
        `Total: ${data.human_readable_total ?? "—"}.`
      return toChunks("wakatime", "https://wakatime.com", text)
    },
  }
}
```

- [ ] **Step 4: Correr y verificar que pasa** — `pnpm --filter @vaio/agent test connectors` → PASS

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/adapters/connectors/wakatime.ts apps/agent/test/connectors.test.ts
git commit -m "feat(connectors): conector WakaTime (live + collect)"
```

---

## Task 5: Conector Steam (TDD)

**Files:** Create `apps/agent/src/adapters/connectors/steam.ts`; Modify `apps/agent/test/connectors.test.ts`

- [ ] **Step 1: Escribir los tests que fallan** (agregar a `connectors.test.ts`)

```ts
import { createSteamConnector } from "../src/adapters/connectors/steam.js"

describe("conector Steam — live()", () => {
  const c = createSteamConnector({ apiKey: "k", steamId: "123" })
  it("jugando ahora → gameextrainfo", async () => {
    mockFetch(() => ({
      json: { response: { players: [{ gameextrainfo: "Hades II" }] } },
    }))
    expect(await c.live()).toContain("jugando ahora: Hades II")
  })
  it("no juega → fallback a recently played", async () => {
    mockFetch((url) => {
      if (url.includes("GetPlayerSummaries")) {
        return { json: { response: { players: [{ personaname: "kev" }] } } }
      }
      return {
        json: {
          response: { games: [{ name: "Hades II", playtime_2weeks: 600 }] },
        },
      }
    })
    const out = await c.live()
    expect(out).toContain("Lo último que jugó")
    expect(out).toContain("Hades II")
  })
  it("nada → null", async () => {
    mockFetch(() => ({ json: { response: { players: [{}] } } }))
    // recently played vacío
    mockFetch((url) =>
      url.includes("GetPlayerSummaries")
        ? { json: { response: { players: [{}] } } }
        : { json: { response: { games: [] } } }
    )
    expect(await c.live()).toBeNull()
  })
})

describe("conector Steam — collect()", () => {
  const c = createSteamConnector({ apiKey: "k", steamId: "123" })
  it("biblioteca → 1 chunk source 'steam' top por horas", async () => {
    mockFetch(() => ({
      json: {
        response: {
          games: [
            { name: "Dota 2", playtime_forever: 12000 },
            { name: "CS2", playtime_forever: 6000 },
          ],
        },
      },
    }))
    const rows = (await c.collect?.()) ?? []
    expect(rows[0]?.source).toBe("steam")
    expect(rows[0]?.chunk).toContain("Dota 2 (200h)")
  })
  it("perfil privado / sin juegos → []", async () => {
    mockFetch(() => ({ json: { response: {} } }))
    expect(await c.collect?.()).toEqual([])
  })
})
```

- [ ] **Step 2: Correr y verificar que falla** — `pnpm --filter @vaio/agent test connectors` → FAIL

- [ ] **Step 3: Implementar `steam.ts`**

```ts
// Conector Steam — UNA fuente, dos facetas:
//  - live(): qué juega Kevin ahora (o lo último). Best-effort → null.
//  - collect(): juegos favoritos por horas → DocChunk[] (snapshot). [] si el perfil de juegos es privado.

import type { Connector } from "../../ports/connector.js"
import type { DocChunk } from "../../ports/memory.js"
import { topByPlaytime } from "../../core/connector-stats.js"
import { toChunks } from "../sources/util.js"

const BASE = "https://api.steampowered.com"

interface SteamPlayer {
  gameextrainfo?: string
  personaname?: string
}
interface SteamGame {
  name: string
  playtime_forever?: number
  playtime_2weeks?: number
}

export function createSteamConnector(cfg: {
  apiKey: string
  steamId: string
}): Connector {
  // La key va por query (NUNCA se loguea).
  const url = (iface: string, method: string, version: string, extra = "") =>
    `${BASE}/${iface}/${method}/${version}/?key=${cfg.apiKey}${extra}`

  const recentlyPlayed = async (count: number): Promise<SteamGame[]> => {
    const res = await fetch(
      url(
        "IPlayerService",
        "GetRecentlyPlayedGames",
        "v1",
        `&steamid=${cfg.steamId}&count=${count}`
      )
    )
    if (!res.ok) return []
    const json = (await res.json()) as { response?: { games?: SteamGame[] } }
    return json.response?.games ?? []
  }

  return {
    name: "steam",

    async live(): Promise<string | null> {
      try {
        const res = await fetch(
          url("ISteamUser", "GetPlayerSummaries", "v2", `&steamids=${cfg.steamId}`)
        )
        if (res.ok) {
          const json = (await res.json()) as {
            response?: { players?: SteamPlayer[] }
          }
          const playing = json.response?.players?.[0]?.gameextrainfo
          if (playing) return `🎮 Kevin está jugando ahora: ${playing}`
        }
        // No está jugando → lo último de las 2 semanas.
        const recent = await recentlyPlayed(1)
        const last = recent[0]
        if (!last) return null
        const hours = Math.round((last.playtime_2weeks ?? 0) / 60)
        return `🎮 Lo último que jugó Kevin: ${last.name} (${hours}h en 2 semanas)`
      } catch {
        return null
      }
    },

    async collect(): Promise<DocChunk[]> {
      const res = await fetch(
        url(
          "IPlayerService",
          "GetOwnedGames",
          "v1",
          `&steamid=${cfg.steamId}&include_appinfo=true&include_played_free_games=true`
        )
      )
      if (!res.ok) return []
      const json = (await res.json()) as { response?: { games?: SteamGame[] } }
      const games = (json.response?.games ?? []).filter(
        (g): g is SteamGame & { playtime_forever: number } =>
          typeof g.playtime_forever === "number" && g.playtime_forever > 0
      )
      if (games.length === 0) return [] // perfil privado o sin juegos
      const top = topByPlaytime(games, 10)
      const text = `Juegos favoritos de Kevin (Steam, por horas jugadas): ${top}.`
      return toChunks(
        "steam",
        `https://steamcommunity.com/profiles/${cfg.steamId}`,
        text
      )
    },
  }
}
```

- [ ] **Step 4: Correr y verificar que pasa** — `pnpm --filter @vaio/agent test connectors` → PASS

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/adapters/connectors/steam.ts apps/agent/test/connectors.test.ts
git commit -m "feat(connectors): conector Steam (live + collect)"
```

---

## Task 6: Conector GitHub-stats (TDD)

**Files:** Create `apps/agent/src/adapters/connectors/github-stats.ts`; Modify `apps/agent/test/connectors.test.ts`

- [ ] **Step 1: Escribir los tests que fallan** (agregar a `connectors.test.ts`)

> Nota: el conector llama `githubGraphql` (que hace `fetch` a `/graphql`). El `mockFetch` del archivo
> ya intercepta `fetch` global → devolvemos el shape `{ data: { user: {...} } }`.

```ts
import { createGithubStatsConnector } from "../src/adapters/connectors/github-stats.js"

const ghStatsPayload = {
  data: {
    user: {
      repositories: {
        totalCount: 2,
        nodes: [
          {
            stargazers: { totalCount: 5 },
            languages: { edges: [{ size: 100, node: { name: "TypeScript" } }] },
          },
          {
            stargazers: { totalCount: 3 },
            languages: { edges: [{ size: 50, node: { name: "Java" } }] },
          },
        ],
      },
      contributionsCollection: {
        totalCommitContributions: 120,
        totalPullRequestContributions: 10,
        totalIssueContributions: 4,
        contributionCalendar: {
          totalContributions: 134,
          weeks: [
            {
              contributionDays: [
                { contributionCount: 1, date: "2026-06-13" },
                { contributionCount: 2, date: "2026-06-14" },
              ],
            },
          ],
        },
      },
    },
  },
}

describe("conector GitHub-stats — collect()", () => {
  const c = createGithubStatsConnector({ user: "kev", token: "t" })
  it("stats agregadas → 1 chunk source 'github-stats'", async () => {
    mockFetch(() => ({ json: ghStatsPayload }))
    const rows = (await c.collect?.()) ?? []
    expect(rows[0]?.source).toBe("github-stats")
    expect(rows[0]?.chunk).toContain("8 stars") // 5 + 3
    expect(rows[0]?.chunk).toContain("120 commits")
    expect(rows[0]?.chunk).toContain("TypeScript")
  })
})

describe("conector GitHub-stats — live()", () => {
  const c = createGithubStatsConnector({ user: "kev", token: "t" })
  it("racha actual > 0 → mensaje de racha", async () => {
    mockFetch(() => ({ json: ghStatsPayload }))
    const out = await c.live()
    expect(out).toContain("racha")
  })
})
```

- [ ] **Step 2: Correr y verificar que falla** — `pnpm --filter @vaio/agent test connectors` → FAIL

- [ ] **Step 3: Implementar `github-stats.ts`**

> El `from` (hace 1 año) usa `new Date` — I/O de tiempo, fuera de la lógica pura (que ya está testeada). El
> `today` para la racha sale del mismo reloj. No se mockea el tiempo en los tests (los fixtures usan fechas
> recientes y la racha igual se calcula determinísticamente sobre los días provistos vs `today` real → el
> test de `live` solo asegura "racha" presente, no el número exacto).

```ts
// Conector GitHub-stats — UNA fuente (GraphQL), dos facetas:
//  - live(): racha ACTUAL de contribuciones. Best-effort → null. (No duplica el live de `github` = pushes.)
//  - collect(): totales agregados (stars/commits/PRs/issues) + lenguajes reales por bytes + racha más larga.

import type { Connector } from "../../ports/connector.js"
import type { DocChunk } from "../../ports/memory.js"
import {
  aggregateLanguages,
  currentStreak,
  longestStreak,
  topByPercent,
} from "../../core/connector-stats.js"
import { githubGraphql } from "../sources/github-api.js"
import { toChunks } from "../sources/util.js"

const QUERY = `query($login:String!,$from:DateTime,$to:DateTime){
  user(login:$login){
    repositories(ownerAffiliations:OWNER,isFork:false,first:100){
      totalCount
      nodes{ stargazers{ totalCount }
             languages(first:10,orderBy:{field:SIZE,direction:DESC}){ edges{ size node{ name } } } }
    }
    contributionsCollection(from:$from,to:$to){
      totalCommitContributions totalPullRequestContributions totalIssueContributions
      contributionCalendar{ totalContributions weeks{ contributionDays{ contributionCount date } } }
    }
  }
}`

interface StatsResponse {
  user: {
    repositories: {
      totalCount: number
      nodes: {
        stargazers: { totalCount: number }
        languages: { edges: { size: number; node: { name: string } }[] }
      }[]
    }
    contributionsCollection: {
      totalCommitContributions: number
      totalPullRequestContributions: number
      totalIssueContributions: number
      contributionCalendar: {
        totalContributions: number
        weeks: { contributionDays: { contributionCount: number; date: string }[] }[]
      }
    }
  }
}

function flattenDays(resp: StatsResponse) {
  return resp.user.contributionsCollection.contributionCalendar.weeks.flatMap(
    (w) => w.contributionDays
  )
}

export function createGithubStatsConnector(cfg: {
  user: string
  token: string
}): Connector {
  const fetchStats = async (): Promise<StatsResponse> => {
    const now = new Date()
    const from = new Date(now)
    from.setFullYear(now.getFullYear() - 1)
    return githubGraphql<StatsResponse>(
      QUERY,
      { login: cfg.user, from: from.toISOString(), to: null },
      cfg.token
    )
  }

  return {
    name: "github-stats",

    async live(): Promise<string | null> {
      try {
        const resp = await fetchStats()
        const today = new Date().toISOString().slice(0, 10)
        const streak = currentStreak(flattenDays(resp), today)
        if (streak === 0) return null
        return `🔥 Kevin lleva ${streak} días de racha de contribuciones en GitHub`
      } catch {
        return null
      }
    },

    async collect(): Promise<DocChunk[]> {
      const resp = await fetchStats()
      const repos = resp.user.repositories
      const stars = repos.nodes.reduce(
        (acc, r) => acc + r.stargazers.totalCount,
        0
      )
      const cc = resp.user.contributionsCollection
      const langs = topByPercent(aggregateLanguages(repos.nodes), 5)
      const longest = longestStreak(flattenDays(resp))
      const text =
        `Stats de GitHub de Kevin (@${cfg.user}): ${repos.totalCount} repos públicos, ${stars} stars totales; ` +
        `el último año: ${cc.totalCommitContributions} commits, ${cc.totalPullRequestContributions} PRs, ` +
        `${cc.totalIssueContributions} issues (${cc.contributionCalendar.totalContributions} contribuciones). ` +
        `Racha más larga: ${longest} días.` +
        (langs ? ` Lenguajes top por código real: ${langs}.` : "")
      return toChunks("github-stats", `https://github.com/${cfg.user}`, text)
    },
  }
}
```

- [ ] **Step 4: Correr y verificar que pasa** — `pnpm --filter @vaio/agent test connectors` → PASS

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/adapters/connectors/github-stats.ts apps/agent/test/connectors.test.ts
git commit -m "feat(connectors): conector GitHub-stats (GraphQL: totales + langs + racha)"
```

---

## Task 7: Registrar en `buildConnectors` + test de gating

**Files:** Modify `apps/agent/src/adapters/connectors/index.ts`; Modify `apps/agent/test/connectors.test.ts`

- [ ] **Step 1: Actualizar el test de gating** (reemplazar el `describe("buildConnectors …")` existente)

```ts
describe("buildConnectors (gating por keys)", () => {
  it("cada conector se habilita solo con sus keys", () => {
    const full = buildConnectors({
      LASTFM_API_KEY: "k",
      LASTFM_USER: "kev",
      GITHUB_USER: "kev",
      GITHUB_TOKEN: "t",
      WAKATIME_API_KEY: "w",
      STEAM_API_KEY: "s",
      STEAM_ID: "123",
    } as Env)
    expect(full.map((c) => c.name).sort()).toEqual([
      "github",
      "github-stats",
      "lastfm",
      "steam",
      "wakatime",
    ])
  })
  it("github-stats requiere token; steam requiere ambas; wakatime su key", () => {
    const noTokenNoExtras = buildConnectors({ GITHUB_USER: "kev" } as Env)
    expect(noTokenNoExtras.map((c) => c.name)).toEqual(["github"])
    const steamHalf = buildConnectors({ STEAM_API_KEY: "s" } as Env)
    expect(steamHalf.map((c) => c.name)).toEqual([])
  })
})
```

- [ ] **Step 2: Correr y verificar que falla** — `pnpm --filter @vaio/agent test connectors` → FAIL

- [ ] **Step 3: Actualizar `index.ts`**

```ts
import type { Env } from "../../config.js"
import type { Connector } from "../../ports/connector.js"
import { createGithubConnector } from "./github.js"
import { createGithubStatsConnector } from "./github-stats.js"
import { createLastfmConnector } from "./lastfm.js"
import { createSteamConnector } from "./steam.js"
import { createWakatimeConnector } from "./wakatime.js"

export function buildConnectors(env: Env): Connector[] {
  const connectors: Connector[] = []
  if (env.LASTFM_API_KEY && env.LASTFM_USER) {
    connectors.push(
      createLastfmConnector({ apiKey: env.LASTFM_API_KEY, user: env.LASTFM_USER })
    )
  }
  if (env.GITHUB_USER) {
    connectors.push(
      createGithubConnector({ user: env.GITHUB_USER, token: env.GITHUB_TOKEN })
    )
  }
  if (env.GITHUB_USER && env.GITHUB_TOKEN) {
    connectors.push(
      createGithubStatsConnector({ user: env.GITHUB_USER, token: env.GITHUB_TOKEN })
    )
  }
  if (env.WAKATIME_API_KEY) {
    connectors.push(createWakatimeConnector({ apiKey: env.WAKATIME_API_KEY }))
  }
  if (env.STEAM_API_KEY && env.STEAM_ID) {
    connectors.push(
      createSteamConnector({ apiKey: env.STEAM_API_KEY, steamId: env.STEAM_ID })
    )
  }
  return connectors
}
```

- [ ] **Step 4: Correr y verificar que pasa** — `pnpm --filter @vaio/agent test connectors` → PASS

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/adapters/connectors/index.ts apps/agent/test/connectors.test.ts
git commit -m "feat(connectors): registrar WakaTime, Steam, GitHub-stats"
```

---

## Task 8: Verificación final + e2e

- [ ] **Step 1: Suite completa de verificación**

```bash
pnpm -r typecheck && pnpm exec biome check . && pnpm -r test && pnpm -r build
```
Expected: todo PASS; el conteo de tests sube (~270 → ~285+).

- [ ] **Step 2: e2e de `collect()` (con keys reales en `.env`)** — `pnpm ingest`

Expected en logs: persiste `wakatime`, `steam`, `github-stats` (además de github/lastfm), sin secrets; cv/me/contact limpios.

- [ ] **Step 3: e2e de `live()` (con keys)** — `pnpm dev` + `/chat` "¿qué está haciendo Kevin / qué juega / cuánto programó?"

Expected: la tool `recentActivity` dispara → aparecen las líneas de los conectores nuevos (⌨️ / 🎮 / 🔥) según haya datos.

- [ ] **Step 4: Reconciliar docs** — `NEXT-STEPS.md` (Historial + cerrar el followup "WakaTime/Steam/GitHub-stats") y memoria si aplica.

- [ ] **Step 5: Commit de docs**

```bash
git add docs/
git commit -m "docs: conectores WakaTime/Steam/GitHub-stats verificados"
```

---

## Self-review (cobertura del spec)

- ✅ Config + gating (design §Config) → Task 1, Task 7
- ✅ WakaTime live+collect (design §WakaTime) → Task 4
- ✅ Steam live+collect + privacidad (design §Steam) → Task 5
- ✅ GitHub-stats GraphQL + streak (design §GitHub-stats) → Task 3 (helper), Task 6
- ✅ Lógica pura TDD (design §Lógica pura) → Task 2
- ✅ Degradación null/[] (design §Degradación) → en cada conector (try/catch, !ok→null/[])
- ✅ Seguridad keys (design §Seguridad) → Basic/query, sin log; `.env.example` Task 1
- ✅ Tests (design §Tests) → Task 2 (puro), Tasks 4-7 (adapters + gating)
