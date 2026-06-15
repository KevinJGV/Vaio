// Puerto del derivador de TENDENCIAS (LLM). El prompt lo arma `core/trends.buildTrendPrompt` (puro); este puerto
// solo lo ejecuta contra un modelo. Puede lanzar: el llamador (ingest) lo envuelve en try/catch y cae al delta
// determinístico (Invariante #1: el ingest nunca rompe).

export interface TrendSummarizer {
  summarize(input: { system: string; prompt: string }): Promise<string>
}
