# Diseño técnico — Acumulación + patrones de conectores ("trends")

> **Altitud:** spec técnico (firmas, DDL, prompt, edge-cases). Plan de alto nivel + estrategia →
> [`2026-06-15-connector-trends-plan.md`](2026-06-15-connector-trends-plan.md). Construye sobre la faceta persist
> de conectores ([`2026-06-14-connector-persist-design.md`](2026-06-14-connector-persist-design.md)).

## Objetivo
Que Vaio note **patrones en el tiempo** de la actividad de Kevin: "últimamente escucha más electrónica", "se
enganchó con un roguelike", "programó 20% más, sobre todo TypeScript". Hoy `collect()` es **snapshot puro**
(`ingest.ts` hace `clearSource`+`upsert` → se pisa). Se agrega una **serie temporal** + **derivación de tendencias**.

## Decisiones de producto (cerradas con Kevin, 2026-06-15)
1. **Alcance RICO con clasificación** (géneros/categorías) → se usa el LLM (ingest ocasional → costo despreciable).
2. **Acceso vía CHUNKS en la memoria** (`searchMemory` los trae solos; sin tool nueva).
3. **Timestamp-aware, cadencia MANUAL** (sin cron): tendencias sobre las fechas reales de las capturas.

## Decisiones de diseño (con trade-offs)
- **Snapshot = TEXTO formateado de `collect()`**, no estructurado. Cero faceta nueva en los conectores (el texto
  ya tiene artistas/juegos+horas/langs+%); el LLM diffea bien. Trade-off: menos precisión aritmética
  determinística (mitigado: los números están en el texto; el fallback determinístico se queda en lo cualitativo).
  Columna `payload jsonb` nullable como extensión futura.
- **LLM principal + delta determinístico de FALLBACK** (defensa en capas): el alcance rico exige LLM; el
  Invariante #1 exige que el ingest no muera → fallback puro que nunca inventa.
- **Retención por-N** (default 12), no por-días (predecible bajo cadencia manual irregular).
- **Flag OFF por defecto** → se shippea sin tocar prod hasta el "go".

## Modelo de datos (migración 0008)
```ts
// schema.ts
export const connectorSnapshots = pgTable("connector_snapshots", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  source: text("source").notNull(),               // 'lastfm'|'steam'|'wakatime'|'github-stats'|'github'
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  content: text("content").notNull(),             // chunk(s) de collect() de ese source, unidos por "\n"
  contentHash: text("content_hash").notNull(),    // sha256(normalize(content)) → dedup consecutivo
  payload: jsonb("payload"),                      // nullable, sin uso hoy: extensión a estructurado
}, (t) => [index("connector_snapshots_source_time_idx").on(t.source, t.capturedAt)])
```
Sin embedding (la serie se lee por source+fecha, no se busca semánticamente). DDL pura → `db:generate` (no a mano).

## Puertos + adapters
```ts
// ports/snapshot-store.ts
export interface ConnectorSnapshot { source: string; capturedAt: Date; content: string }
export interface SnapshotStore {
  /** Append; false si fue dedup-skip (hash == el último de ese source). */
  append(input: { source: string; content: string; capturedAt?: Date }): Promise<boolean>
  listRecent(source: string, n: number): Promise<ConnectorSnapshot[]>   // más reciente primero
  prune(source: string, keep: number): Promise<void>                    // deja `keep` más recientes
}
// ports/trend.ts
export interface TrendSummarizer { summarize(input: { system: string; prompt: string }): Promise<string> }
```
- **`adapters/neon-snapshots.ts`** `createSnapshotStore(db)`: `append` lee el último `content_hash` del source →
  si igual, skip (false); si no, insert (true). `listRecent` = ORDER BY captured_at DESC LIMIT n. `prune` = borra
  los que no estén en los `keep` más recientes.
- **`adapters/trend-summarizer.ts`** espeja `summarizer.ts`: `generateText({model,system,prompt})` → `.trim()`.

## Lógica pura (`core/trends.ts`, TDD)
- `normalizeForHash(s)` (trim + colapsar espacios) + `hashContent(s)` (sha256) → dedup tolerante a diffs cosméticos.
- `buildTrendPrompt({source, snapshots, locale, now})` → `{system, prompt}`. **System (grounding duro):** analista
  de tendencias; usa SOLO lo de las capturas; NUNCA inventa artistas/juegos/langs/géneros/números/fechas;
  clasifica (género/categoría) **solo si es evidente** por los nombres; habla de CAMBIOS (qué apareció, subió,
  bajó, en qué se enganchó); expresa el lapso en lenguaje natural desde las fechas; corto, 3ª persona, denso, sin
  relleno; si las capturas son casi idénticas, "se mantiene estable". ES + EN (espeja `summary.ts`). **Prompt:**
  source + fecha de hoy + capturas (más reciente→antiguo, cada una con su `capturedAt` + content).
- `deterministicTrend(recent, now)`: set-diff de ítems (líneas) entre la captura más nueva y la anterior →
  "aparecen X; ya no figuran Z" + lapso en días desde `capturedAt` (`now` inyectable, como `currentStreak`). `""`
  si `recent.length < 2`.

## Flujo en `ingest.ts`
Por conector (best-effort, el try/catch externo existente envuelve todo):
1. `rows = await col.collect()`; agrupar por source.
2. **Snapshot vigente, igual que hoy:** `clearSource(source)` + `upsertDocuments(group)` (el RAG sigue fresco aunque el trend falle).
3. **Si `TRENDS_ENABLED` && snapshotStore && trendSummarizer**, por cada source:
   - `content = group.map(c=>c.chunk).join("\n")`; `inserted = await snapshots.append({source, content})`.
   - Si `!inserted` (dedup) → no derivar, no prune-necesario. Loguear y seguir.
   - `await snapshots.prune(source, env.TREND_RETENTION)`; `recent = await snapshots.listRecent(source, env.TREND_RETENTION)`.
   - Si `recent.length < 2` → skip (sin con qué comparar). 
   - Si `>= 2`: `{system,prompt} = buildTrendPrompt(...)`; `try text = summarize(...)` / `catch text = deterministicTrend(recent, now)`;
     si `text`: `clearSource("trend:"+source)` + `upsertDocuments(toChunks("trend:"+source, "", text))`. **El trend
     REEMPLAZA al anterior; los snapshots ACUMULAN.**

Wiring (`ingest.ts`): `createSnapshotStore(db)` + `createTrendSummarizer(createModel(embeddingsKey? no →
OPENROUTER_API_KEY, trendChain(env), logger, attribution))` (espeja `index.ts`).

## Config
`TRENDS_ENABLED` (off; "true"/"1") · `TREND_MODELS` (csv; cae a SUMMARY/chat) · `TREND_RETENTION`
(`positiveIntWithDefault(12)`) + helper `trendChain(env)` (espeja `summaryChain`). `.env.example` documenta las 3.

## Edge-cases
- **collect() multi-chunk / multi-source** → un snapshot por source, uniendo sus chunks con "\n".
- **Dedup consecutivo** (ingest 2× sin cambios) → `append` false → no deriva, no ruido en la serie ni trabajo LLM.
- **Conector sin datos** (`collect()` → []) → grupo vacío → no append → skip natural.
- **1ª captura / 1 solo snapshot** → `recent.length < 2` → sin trend (no inventamos delta).
- **LLM falla/timeout** → `deterministicTrend` (grounded). El ingest nunca rompe (Invariante #1).
- **Trend compite en el RAG** con ~miles de chunks de repo → **v1: doc normal + medir**; si no aflora, followup:
  prioridad de retrieval estilo `searchFacts` (`searchTrends` + anteposición). YAGNI: no antes de medir.
- **OFF** → ingest legacy exacto.

## Tests
- Core puro: hash/normalize (cosmético→mismo; real→distinto); `deterministicTrend` (aparece/desaparece, lapso con
  `now` inyectable, <2→""); `buildTrendPrompt` (incluye fechas + orden reciente→antiguo + grounding; ES y EN).
- `neon-snapshots` (fake db): append skip si hash igual / insert si no; listRecent orden+limit; prune deja `keep`.
- Flujo ingest (fakes SnapshotStore/TrendSummarizer/MemoryStore): 1ª captura→sin trend; 2ª distinta→summarizer+
  upsert `trend:source`; summarizer tira→fallback determinístico igual upserta; duplicado→sin summarizer; OFF→legacy.
- Config: `trendChain` cae a summary/chat; `TREND_RETENTION` default 12; `TRENDS_ENABLED` parsea "1"/"true".

## Invariantes
Siempre responde / ingest no rompe (degradación LLM→determinístico→skip). Grounding (system sin hechos; tendencia
derivada de datos). ports/adapters-lite (`core/trends` puro; I/O en adapters; `ingest` cablea). Sin secrets en logs.

## Acceso: complemento en `recentActivity` (refinamiento post-prueba, 2026-06-15)
**Hallazgo en prueba real (Telegram):** el chunk `trend:*` aflora bien por `searchMemory` cuando el modelo la
llama, pero `recentActivity` (el AHORA) y los trends (la EVOLUCIÓN) **se solapan semánticamente** sobre "¿cómo
viene?" → el modelo elige no-determinísticamente y a veces se queda **solo con lo live** (caso "¿cómo viene el
código?" no llamó `searchMemory` → perdió `trend:github-stats`/`trend:wakatime`). No era "el trend se ahoga en el
RAG" sino **competencia de selección de tool**.
**Decisión (Kevin):** que **UNA** tool cubra ambos sentidos del tiempo. `recentActivity` lee por **source
EXACTO** el último `trend:<connector.name>` y lo anexa bajo "📈 Cómo viene" (determinístico — Invariante #8: el
sistema trae el dato por clave; el modelo no lo relaya). Los trends **siguen en memoria** (searchMemory los trae en
preguntas profundas = cinturón + tirantes). Inerte sin trends (OFF → solo live, legacy).
- `ports/memory`: `getBySource?(source)` opcional (espeja `searchFacts?`); adapter `neon-memory` lo implementa.
- `core/trends`: `trendSource(source)` = única fuente de verdad del prefijo (lo escribe trend-ingest, lo lee
  recentActivity).
- **Bonus (verificado e2e):** `getBySource` trae el texto **crudo y limpio** → esquiva la **corrupción de texto**
  (espacios/palabras comidas: "seachicó", "perfil deKevin") que aparece **solo** por el path `searchMemory`/rerank.
  El storage está sano → la corrupción es del retrieval/rerank (o artefacto de log). **Followup aparte** (verificar
  y corregir). Otro followup colateral: `searchMemory` tardó **183 s** con un `repo sync` concurrente (contención).

## Evolución a grafos (Fase 3 — Graphiti) — forward-link
Esta feature es el **precursor pragmático "antes del grafo"**. Cuando llegue el grafo temporal bi-temporal
(Graphiti, Fase 3): los **entes** (artistas/juegos/lenguajes/géneros) pasan a **nodos** con aristas bi-temporales
(`valid_at`/`invalid_at`) → la evolución es **nativa** (no se diffea texto); la **clasificación** son **relaciones
estructuradas** (artista→género) en vez de re-inferirse cada ingest; las **tendencias** pasan de "LLM diffea
texto" a **queries/traversals** del grafo; y habilita **patrones cross-conector** (música × gaming × código en una
sola estructura temporal). **Este diseño ya es graph-ready a propósito:** la columna `payload jsonb` (hoy sin uso)
es el seam hacia datos estructurados, y el puerto `SnapshotStore` deja enchufar un adapter de grafo sin reescribir
el `core`/`ingest`. La **serie de snapshots de hoy es la materia prima** que el grafo ingeriría. La frontera no
cambia (el grafo es store durable detrás de la tool — `SPEC.md`).
