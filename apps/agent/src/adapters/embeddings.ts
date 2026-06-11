// Adapter de embeddings: implementa el puerto Embedder vía un endpoint compatible con
// OpenAI (`POST /embeddings`). Fetch directo para no acoplar un provider extra.
//
// Ojo: OpenRouter puede devolver HTTP 200 con un body `{ error: { code, message } }`
// (p.ej. un 429 de cap de gasto upstream). Detectamos eso y reintentamos con backoff
// en 429/5xx; el resto falla con mensaje claro.

import type { Embedder } from "../ports/memory.js"

export interface EmbeddingsConfig {
  apiKey: string
  model: string
  baseUrl: string
  /** Trunca la salida a N dims (Matryoshka). Debe coincidir con EMBEDDING_DIM del schema. */
  dimensions?: number
}

interface EmbeddingsResponse {
  data?: { embedding: number[] }[]
  error?: { message?: string; code?: number }
}

async function postWithRetry(
  cfg: EmbeddingsConfig,
  body: string,
  attempts = 3
): Promise<{ embedding: number[] }[]> {
  let lastErr = "desconocido"
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(`${cfg.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body,
    })
    const json = (await res.json().catch(() => ({}))) as EmbeddingsResponse
    if (res.ok && json.data) return json.data
    const code = json.error?.code ?? res.status
    lastErr = `${code}: ${json.error?.message ?? "respuesta sin data"}`
    // Reintentar solo en 429 / 5xx (transitorios); otros errores fallan de una.
    if (code !== 429 && code < 500) break
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i))
    }
  }
  throw new Error(`Embeddings API ${lastErr}`)
}

export function createEmbedder(cfg: EmbeddingsConfig): Embedder {
  const dim = cfg.dimensions
  // OpenRouter no documenta `dimensions` → puede devolver la dim nativa (3072). Truncamos
  // al prefijo Matryoshka (válido como embedding) para que entre en vector(N). Coseno no
  // necesita renormalizar.
  const truncate = (e: number[]) =>
    dim && e.length > dim ? e.slice(0, dim) : e

  return {
    async embed(texts: string[]): Promise<number[][]> {
      // De a UNO: el batch (input array) dispara 429 de cap upstream en OpenRouter→Google;
      // el input único pasa. Más requests, pero confiable para una ingesta puntual.
      const out: number[][] = []
      for (const text of texts) {
        const body = JSON.stringify({
          model: cfg.model,
          input: text,
          ...(dim ? { dimensions: dim } : {}),
        })
        const data = await postWithRetry(cfg, body)
        const embedding = data[0]?.embedding
        if (!embedding)
          throw new Error("Embeddings API: respuesta sin embedding")
        out.push(truncate(embedding))
      }
      return out
    },
  }
}
