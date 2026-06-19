// Adapter del Translator: traduce con un LanguageModel (la cadena OpenRouter / el modelo de chat). Lo usa
// searchMemory para llevar la query al idioma canónico de los facts. best-effort: cualquier fallo → devuelve el
// texto original (degrada al comportamiento previo; Inv #1). Prompt mínimo y abstracto (sin sujetos hardcodeados,
// Inv #2): SOLO traduce, sin agregar ni explicar.

import { generateText, type LanguageModel } from "ai"
import type { Logger } from "../ports/logger.js"
import type { Translator } from "../ports/translator.js"

const LABEL: Record<"es" | "en", string> = {
  es: "Spanish",
  en: "English",
}

export function createTranslator(deps: {
  model: LanguageModel
  logger: Logger
}): Translator {
  return {
    async translate(text, targetLocale) {
      const clean = text.trim()
      if (!clean) return text
      try {
        const { text: out } = await generateText({
          model: deps.model,
          system:
            `Translate the user's text to ${LABEL[targetLocale]}. Output ONLY the translation, nothing else: ` +
            "no quotes, no notes, no explanations. If it's already in that language, return it unchanged.",
          prompt: clean,
        })
        const t = out.trim()
        return t || text
      } catch (err) {
        deps.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "translator falló → uso el texto original"
        )
        return text
      }
    },
  }
}
