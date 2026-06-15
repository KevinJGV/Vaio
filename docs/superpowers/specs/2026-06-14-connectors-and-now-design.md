# Diseño técnico — Sentido del AHORA + framework de conectores (gap ①)

> **Altitud:** spec técnico (firmas, edge-cases). Plan de alto nivel + estrategia →
> [`2026-06-14-connectors-and-now-plan.md`](2026-06-14-connectors-and-now-plan.md). Norte: "Vaio vivo, al día, del
> día a día" (memoria `proactive-turns-vision` para la mención proactiva, diferida).

## Objetivo y alcance
(A) Vaio sabe la **fecha/hora actual** (TZ de Kevin) en cada turno. (B) Puede traer **on-demand** la actividad/estado
EN VIVO de Kevin desde una **infra de conectores extensible** (hoy: Last.fm now-playing + GitHub actividad; mañana:
WakaTime/Steam/stats = sumar un conector). **Fuera de este incremento:** la faceta **persist** de conectores (que
alimenten la memoria) y la mención **proactiva** — son followups (interfaz lista).

## Framework de conectores
### `ports/connector.ts` (NUEVO)
```ts
import type { DocChunk } from "./memory.js"
export interface Connector {
  name: string
  /** Snapshot EN VIVO ("qué pasa ahora": now-playing, actividad, stats). null = sin datos. NUNCA tira (best-effort). */
  live(): Promise<string | null>
  /** FUTURO — faceta persist ("se nutre solo"): chunks para memoria. Opcional; NO se usa en este incremento. */
  collect?(): Promise<DocChunk[]>
}
```

### Conectores LIVE (implementados)
- **`adapters/connectors/lastfm-now.ts`:** `createLastfmConnector({ apiKey, user }): Connector`, `name:"lastfm"`.
  `live()`: `GET ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=&api_key=&format=json&limit=5`. El track
  con `@attr.nowplaying==="true"` → `"🎧 Kevin escucha ahora: <artist> — <name>"`; si no hay → `"🎵 Lo último que
  escuchó: <artist> — <name>"`; sin tracks → `null`. Best-effort (catch → null).
- **`adapters/connectors/github-activity.ts`:** `createGithubActivityConnector({ user, token }): Connector`,
  `name:"github"`. `live()`: `githubApi<GhEvent[]>("/users/{user}/events/public?per_page=30")` → filtrar
  `type==="PushEvent"` → por evento: `repo.name` + `payload.commits[].message` (1ª línea) → top ~5 mensajes →
  `"💻 Actividad de código reciente de Kevin: <repo>: <msg>; …"`. Sin push events → `null`. ⚠️ Latencia eventos
  GitHub 30s–6h → frasear "reciente", no "ahora". Best-effort (catch → null).
  ```ts
  interface GhEvent { type: string; repo: { name: string }; payload: { commits?: { message: string }[] }; created_at: string }
  ```

### Registry — `adapters/connectors/index.ts` (NUEVO)
```ts
export function buildConnectors(env: Env, logger: Logger): Connector[]
```
Arma SOLO los habilitados (gating por keys, como el resto del wiring): lastfm si `LASTFM_API_KEY && LASTFM_USER`;
github si `GITHUB_USER` (token opcional). Sumar un conector futuro = nuevo archivo + 1 push acá. Espeja el patrón del
registry de actions.

## Tool `recentActivity` — `core/actions/recent-activity.ts` (NUEVO)
`ActionDescriptor` `name:"recentActivity"`, `sideEffecting:false`, `clearance:"anyone"` (info pública de Kevin →
todos los canales; encaja en el chat del portafolio "¿qué está haciendo Kevin?"). `execute`:
```ts
const snaps = (await Promise.all(ctx.connectors.map(c =>
  c.live().catch(() => null)))).filter((s): s is string => !!s)
const output = snaps.length ? snaps.join("\n") : "Ahora mismo no tengo señales de actividad de Kevin."
// emit tool.result (ok, hits=snaps.length, latency, output)
```
Degrada si `ctx.connectors` vacío. Descripción (para el modelo): *"Actividad/estado EN VIVO de Kevin desde sus
fuentes conectadas (música que escucha, actividad de código reciente, …). Usala para '¿qué escuchás/hiciste hoy?',
no para datos estáticos (eso es searchMemory)."*

## Sentido del AHORA (temporal)
- **`config.ts`:** `OWNER_TIMEZONE: z.string().default("America/Bogota")`.
- **`core/time.ts` (NUEVO, puro):**
  ```ts
  export function formatNow(date: Date, tz: string, locale: Locale): string
  ```
  `Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-CO", { timeZone: tz, weekday:"long", day:"numeric",
  month:"long", year:"numeric", hour:"2-digit", minute:"2-digit" }).format(date)`. TZ inválida → catch → fallback
  `date.toISOString()` (no romper). Testeable con date+tz+locale fijos.
- **`core/agent.ts`:** `AgentDeps += ownerTimezone?: string`. Por turno: `const now = formatNow(new Date(),
  ownerTimezone ?? "America/Bogota", locale)` → `buildSystemPrompt({ ..., now })`. (Date/Intl = app code, permitido.)
- **`core/prompt.ts` `buildSystemPrompt`:** arg `now?: string` → bloque al inicio (antes de persona) o tras identidad:
  ES `"Ahora mismo es ${now} (hora de Kevin)."` / EN `"Right now it's ${now} (Kevin's time)."`. Solo si `now`.

## Wiring
- `ActionContext (types.ts) += connectors?: Connector[]` (default `[]`).
- `agent.ts`: AgentDeps += `connectors`; pasar a `buildTools({ ..., connectors })`.
- `registry.ts`: `ACTIONS += recentActivity`.
- `capabilities.ts`: `ToolName += "recentActivity"`; agregar a allowedTools de web, untrustedTelegram, trusted telegram.
- `index.ts`: `const connectors = buildConnectors(env, logger)` → `createAgent({ ..., connectors, ownerTimezone: env.OWNER_TIMEZONE })`. Boot log `connectors: connectors.length`.
- `.env.example`: `OWNER_TIMEZONE=America/Bogota`.

## Edge-cases
- Conector que falla/timeout → `live()` catch → null → se omite (best-effort; el tool nunca rompe).
- Sin conectores habilitados → tool degrada con mensaje de cortesía.
- Latencia eventos GitHub → frasear "reciente".
- TZ inválida → fallback ISO.
- now-playing/commits = info pública → ok en chat público.
- El tool NO se debe usar para datos estáticos (bio/stack) → eso es `searchMemory` (aclarado en la descripción).

## Tests
- **`time.test.ts`:** `formatNow` con date fija + tz `America/Bogota` y `America/New_York`, locale es/en → string
  contiene el día/mes esperados; TZ inválida → no tira.
- **`connectors.test.ts` (mockFetch):** lastfm now-playing (con/sin `@attr.nowplaying`, sin tracks→null);
  github PushEvent→mensajes (sin push→null); ambos best-effort (fetch falla → null). `buildConnectors` gating por keys.
- **`recent-activity.test.ts`:** concatena snapshots de fakes; omite los null; degrada con `connectors:[]`.
- **`prompt.test.ts`:** con `now` → bloque "Ahora mismo es …"; sin `now` → no aparece.
