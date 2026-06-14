# Diseño técnico — Rerank (2ª etapa del RAG)

> **Altitud:** spec técnico (puerto, adapter, firmas, API, edge-cases). Plan de alto nivel + estrategia →
> [`2026-06-14-rerank-plan.md`](2026-06-14-rerank-plan.md). Contexto: trigger disparado por la ingesta de fuentes
> crudas (~29 → ~1600+ chunks). Memoria `openrouter-api-surface`. Invariante #1 (degradar siempre).

## Objetivo
Segunda etapa del retrieval: recuperar un **K ancho** por vector → **rerankear** (cross-encoder query+chunk juntos
vía OpenRouter `/rerank`) → **recortar al top-N** del canal. Mejora QUÉ entra al contexto (grounding). **Degrada
siempre**: sin reranker configurado o si falla → vector top-K como hoy (el turno nunca se rompe).

## API OpenRouter `/rerank` (verificada: context7 `/websites/openrouter_ai` + memoria)
- `POST https://openrouter.ai/api/v1/rerank` · headers `Bearer <key>` + `content-type` + attribution.
- Body: `{ model, query, documents: string[], top_n? }`.
- Respuesta: `{ model, results: [{ document: { text }, index, relevance_score }], id, usage: { search_units, total_tokens } }`.
  `index` = posición en el array `documents` de entrada; `results` viene **ordenado por relevancia desc**, recortado a `top_n`.
- Single-provider REST (el `@openrouter/ai-sdk-provider` NO lo envuelve) → `fetch` directo.

## Puerto — `apps/agent/src/ports/rerank.ts`
```ts
export interface RerankResult { index: number; score: number }
export interface Reranker {
  /** Top-N de `documents` por relevancia a `query`, como índices+score (índice = posición en el array original).
   *  Devuelve [] si no se pudo rerankear (sin modelo / todos fallan) → el llamador degrada a vector. NUNCA tira. */
  rerank(query: string, documents: string[], topN: number): Promise<RerankResult[]>
}
```
Devolver índices+score (no DocChunks) mantiene el puerto desacoplado del tipo de memoria; la action mapea de vuelta.

## Adapter — `apps/agent/src/adapters/rerank-openrouter.ts`
`createReranker({ apiKey, baseURL, chain: string[], logger, attribution? }): Reranker`. Espeja
`speech-openrouter.ts`:
- **Cadena client-side:** por cada `model` de `chain`, `POST /rerank` con `{model, query, documents, top_n: topN}`.
  La 1ª que responde con `results` gana; si una falla (no-2xx, o 200 con `{error}` como en `embeddings.ts`,
  o excepción) → log `warn` + siguiente. Todas fallan → `[]`.
- Mapear `results` → `RerankResult[]` = `results.map(r => ({ index: r.index, score: r.relevance_score }))`
  (ya viene ordenado y recortado a top_n por el server).
- Observabilidad: `logger.info({ model, candidates: documents.length, returned: results.length, latencyMs }, "media.rerank")`.
- `attributionHeaders(attribution)` (de `adapters/openrouter.js`). Key en `Authorization`, nunca logueada.
- Si `chain` vacía o `documents` vacío → `[]` sin llamar.

## Config — `apps/agent/src/config.ts`
- `RERANK_MODELS: z.string().optional()` + `rerankChain(env): string[]` = `csv(env.RERANK_MODELS)` (igual que
  `speechChain`/`transcribeChain` — cadena de fallback client-side; vacío → [] → rerank OFF).
- `RERANK_CANDIDATES: positiveIntWithDefault(30)` (reusa el helper que tolera string vacío).

## Orquestación — `apps/agent/src/core/actions/search-memory.ts`
`ActionContext` (types.ts) suma: `reranker?: Reranker | null` y `rerankCandidates?: number`.
```ts
const topN = ctx.caps.memoryScope.maxK
let docs: DocChunk[]
if (ctx.reranker) {
  const cands = await memory.searchMemory(query, ctx.rerankCandidates ?? 30)   // wide-K
  if (cands.length === 0) docs = []
  else {
    const ranked = await ctx.reranker.rerank(query, cands.map(c => c.chunk), topN)
    docs = ranked.length > 0
      ? ranked.map(r => cands[r.index]).filter((d): d is DocChunk => d != null)  // reranked top-N
      : cands.slice(0, topN)                                                     // degrade: vector order
  }
} else {
  docs = await memory.searchMemory(query, topN)                                  // sin rerank (como hoy)
}
```
El resto del execute (compresión Tier 1, `tool.result`, métricas) queda igual. El `hits` del `tool.result` =
`docs.length`. La traza del rerank sale del log `media.rerank` del adapter.

## Wiring — `apps/agent/src/index.ts` (+ `core/agent.ts` si arma el ActionContext)
- Si `rerankChain(env).length > 0` y hay `OPENROUTER_API_KEY` → `createReranker({ apiKey, baseURL:
  OPENROUTER_BASE_URL, chain: rerankChain(env), logger, attribution })`; si no → `null` (degrade-safe; log "salto").
- Threadear `reranker` + `rerankCandidates: env.RERANK_CANDIDATES` al `ActionContext` (por donde hoy se pasan
  `memory`/`compressor`/`factStore` a `buildTools`/las acciones).

## `.env.example`
```
# Rerank (2ª etapa del RAG): recupera wide-K por vector → rerankea → top-N. csv de fallback client-side.
# Vacío = OFF (cae a vector top-K). Verificá slug/precio en openrouter.ai/models (tab Rerank).
RERANK_MODELS=cohere/rerank-v3.5
RERANK_CANDIDATES=
```

## Edge-cases / riesgos
- **Degradación (Invariante #1):** reranker null / `[]` / `cands` vacío → vector top-N; nunca rompe el turno.
- **`index` fuera de rango** (defensa): `cands[r.index]` + `.filter(d => d != null)` descarta índices inválidos.
- **Costo:** +1 llamada por `searchMemory` (no por turno). Pool 30 acota `search_units`. `searchMemory` no se
  dispara en saludos (grounding condicional) → costo contenido ("pocos $/mes").
- **Latencia:** +1 round-trip; aceptable (rerank es rápido). La cadena prueba en orden → si el 1º cae, suma latencia.
- **Compatibilidad:** el top-N final sigue acotado por `caps.memoryScope.maxK` (6/8) → el contexto al modelo no crece.

## Tests
- `config.test.ts`: `rerankChain` (csv→lista, vacío→[]); `RERANK_CANDIDATES` vacío→30.
- `rerank-openrouter.test.ts` (mockFetch): mapea `results`→`{index,score}`; cadena (1º 500 → 2º ok); todas fallan →
  `[]`; 200 con `{error}` → fallo; `documents` vacío → `[]` sin fetch.
- `search-memory.test.ts` (extender, fakes): fake reranker reordena+recorta a topN; reranker null → vector top-N
  (maxK); reranker `[]` → fallback vector top-N; `cands` vacío → "Sin resultados".
