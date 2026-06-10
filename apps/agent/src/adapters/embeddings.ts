// Adapter de embeddings: implementa el puerto Embedder vía un endpoint compatible con
// OpenAI (`POST /embeddings`). Fetch directo para no acoplar un provider extra.

import type { Embedder } from "../ports/memory.js";

export interface EmbeddingsConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

export function createEmbedder(cfg: EmbeddingsConfig): Embedder {
  return {
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      const res = await fetch(`${cfg.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({ model: cfg.model, input: texts }),
      });
      if (!res.ok) {
        throw new Error(`Embeddings API ${res.status}: ${await res.text()}`);
      }
      const json = (await res.json()) as { data: { embedding: number[] }[] };
      return json.data.map((d) => d.embedding);
    },
  };
}
