// Adapter del derivador de tendencias: implementa TrendSummarizer con generateText (no-streaming) sobre un
// LanguageModel ya construido (cadena de fallback vía OpenRouter). Espeja `summarizer.ts`. Puede lanzar →
// el ingest cae al delta determinístico.

import { generateText, type LanguageModel } from "ai"
import type { TrendSummarizer } from "../ports/trend.js"

export function createTrendSummarizer(model: LanguageModel): TrendSummarizer {
  return {
    async summarize({ system, prompt }) {
      const { text } = await generateText({ model, system, prompt })
      return text.trim()
    },
  }
}
