// Adapter del resumidor: implementa Summarizer con generateText (no-streaming) sobre un LanguageModel
// ya construido (el wiring lo arma con un modelo barato vía OpenRouter, con su cadena de fallback).
// Puede lanzar: el core lo invoca dentro de un try/catch en background y conserva la ventana cruda.

import { generateText, type LanguageModel } from "ai"
import type { Summarizer } from "../ports/summary.js"

export function createSummarizer(model: LanguageModel): Summarizer {
  return {
    async summarize({ system, prompt }) {
      const { text } = await generateText({ model, system, prompt })
      return text.trim()
    },
  }
}
