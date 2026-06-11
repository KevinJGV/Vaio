// Adapter de proveedor de modelo: construye un LanguageModel de OpenRouter con la
// cadena de fallback. El array `models` (extraBody) hace que OpenRouter recorra los
// candidatos server-side: primario barato → fallback → free de última instancia.

import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import type { LanguageModel } from "ai"
import type { Logger } from "../ports/logger.js"

export function createModel(
  apiKey: string,
  models: string[],
  logger?: Logger
): LanguageModel {
  // OpenRouter limita el array `models` (cadena de fallback) a 3 ítems → capamos y avisamos.
  const chain = models.slice(0, 3)
  const [primary] = chain
  if (!primary) throw new Error("createModel requiere al menos un modelo.")
  if (models.length > 3) {
    logger?.warn(
      { provided: models.length, used: chain },
      "OPENROUTER_MODELS > 3; OpenRouter limita la cadena de fallback a 3"
    )
  }
  const openrouter = createOpenRouter({ apiKey })
  return openrouter.chat(primary, { extraBody: { models: chain } })
}
