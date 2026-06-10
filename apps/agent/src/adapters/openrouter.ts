// Adapter de proveedor de modelo: construye un LanguageModel de OpenRouter con la
// cadena de fallback. El array `models` (extraBody) hace que OpenRouter recorra los
// candidatos server-side: primario barato → fallback → free de última instancia.

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

export function createModel(apiKey: string, models: string[]): LanguageModel {
  const [primary] = models;
  if (!primary) throw new Error("createModel requiere al menos un modelo.");
  const openrouter = createOpenRouter({ apiKey });
  return openrouter.chat(primary, { extraBody: { models } });
}
