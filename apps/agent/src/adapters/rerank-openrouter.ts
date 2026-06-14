// Adapter de RERANK (2ª etapa del RAG) sobre OpenRouter: REST `POST /rerank`. El
// `@openrouter/ai-sdk-provider` NO envuelve este endpoint → `fetch` directo (ver `openrouter-api-surface`).
// CADENA de fallback client-side: se prueba cada modelo en orden; el 1º que devuelve `results` gana; si
// todas fallan (o no hay modelos / documents vacío) → [] (el llamador degrada a vector top-K). La key va en
// Authorization; nunca se loguea.
//
// Ojo (mismo quirk que embeddings.ts): OpenRouter puede devolver HTTP 200 con body `{ error: {...} }` →
// lo tratamos como FALLO y seguimos con el siguiente modelo de la cadena.

import type { Attribution } from "../config.js"
import type { Logger } from "../ports/logger.js"
import type { Reranker, RerankResult } from "../ports/rerank.js"
import { attributionHeaders } from "./openrouter.js"

interface RerankResponse {
  results?: { index: number; relevance_score: number }[]
  error?: { code?: number; message?: string }
}

export function createReranker(args: {
  apiKey: string
  baseURL: string
  chain: string[]
  logger: Logger
  attribution?: Attribution
}): Reranker {
  const { apiKey, baseURL, chain, logger, attribution } = args
  return {
    async rerank(query, documents, topN): Promise<RerankResult[]> {
      if (chain.length === 0 || documents.length === 0) return []
      for (const model of chain) {
        const t0 = Date.now()
        try {
          const res = await fetch(`${baseURL}/rerank`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${apiKey}`,
              "content-type": "application/json",
              ...attributionHeaders(attribution),
            },
            body: JSON.stringify({
              model,
              query,
              documents,
              top_n: topN,
            }),
          })
          const json = (await res.json().catch(() => ({}))) as RerankResponse
          // Quirk OpenRouter: 200 con {error} cuenta como fallo. También no-ok o sin `results`.
          if (!res.ok || json.error || !Array.isArray(json.results)) {
            logger.warn(
              { model, status: res.status },
              "rerank no-ok → siguiente en la cadena"
            )
            continue
          }
          const results = json.results
          logger.info(
            {
              model,
              candidates: documents.length,
              returned: results.length,
              latencyMs: Date.now() - t0,
            },
            "media.rerank"
          )
          return results.map((r) => ({
            index: r.index,
            score: r.relevance_score,
          }))
        } catch (err) {
          logger.warn(
            { model, err: err instanceof Error ? err.message : "?" },
            "rerank falló → siguiente en la cadena"
          )
        }
      }
      return []
    },
  }
}
