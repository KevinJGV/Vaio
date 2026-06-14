// Puerto de RERANK (2ª etapa del RAG): reordena candidatos recuperados por vector según su
// relevancia real a la query, vía un cross-encoder. El core depende de esta interfaz, no del
// adapter REST. Vacío → el llamador degrada a vector top-K (NUNCA tira).

export interface RerankResult {
  index: number
  score: number
}

export interface Reranker {
  /** Top-N de `documents` por relevancia a `query`, como índices+score (índice = posición en el array original).
   *  Devuelve [] si no se pudo rerankear (sin modelo / todos fallan / documents vacío) → el llamador degrada a
   *  vector. NUNCA tira. */
  rerank(
    query: string,
    documents: string[],
    topN: number
  ): Promise<RerankResult[]>
}
