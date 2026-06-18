// Adapter del FactDecomposer: usa generateObject (structured output) sobre un LanguageModel ya construido (la
// cadena OpenRouter / el modelo de chat — el de summary falla generateObject). El modelo SOLO produce lenguaje
// natural (los statements atómicos) — el sistema los persiste (Inv #8). best-effort: cualquier fallo →
// { statements: [] } (no aprende ante duda; Inv #1 + privacidad #5). Espeja el estilo de adapters/fact-drafter.ts.

import { generateObject, type LanguageModel } from "ai"
import { z } from "zod"
import type { FactDecomposer } from "../ports/fact-decomposer.js"
import type { Logger } from "../ports/logger.js"

const SCHEMA = z.object({
  statements: z
    .array(z.string())
    .describe(
      "un hecho atómico por elemento (1 idea, 3ª persona, autocontenido); [] si nada factual o todo es sensible"
    ),
})

const SYSTEM_ES = [
  "Sos el redactor de la memoria de Kevin. Te doy un texto (y opcionalmente la pregunta que lo originó).",
  "Descomponelo en hechos ATÓMICOS: UNA idea por hecho, en 3ª persona, autocontenido (cada uno una afirmación",
  "completa que se entienda por sí sola). NO mezcles dos ideas en un mismo hecho.",
  "DESCARTÁ lo sensible/privado (teléfonos, direcciones, documentos, credenciales, o si Kevin pide no compartirlo) y",
  "lo no-factual (saludos, «no sé», opiniones efímeras): no los incluyas.",
  "Si no hay ningún hecho durable → lista vacía. Nunca inventes más de lo que el texto dice.",
].join(" ")

const SYSTEM_EN = [
  "You curate Kevin's memory. I give you a text (and optionally the question that originated it).",
  "Decompose it into ATOMIC facts: ONE idea per fact, in the third person, self-contained (each a complete statement",
  "that stands on its own). Do NOT mix two ideas within a single fact.",
  "DISCARD anything sensitive/private (phone numbers, addresses, documents, credentials, or if Kevin asks not to share it) and",
  "anything non-factual (greetings, «I don't know», ephemeral opinions): do not include them.",
  "If there is no durable fact → empty list. Never invent beyond what the text says.",
].join(" ")

export function createFactDecomposer(deps: {
  model: LanguageModel
  logger: Logger
}): FactDecomposer {
  return {
    async decompose({ rawText, question, locale }) {
      try {
        const prompt =
          locale === "en"
            ? question
              ? `Question that originated it: «${question}»\nText: «${rawText}»`
              : `Text: «${rawText}»`
            : question
              ? `Pregunta que lo originó: «${question}»\nTexto: «${rawText}»`
              : `Texto: «${rawText}»`
        const { object } = await generateObject({
          model: deps.model,
          schema: SCHEMA,
          system: locale === "en" ? SYSTEM_EN : SYSTEM_ES,
          prompt,
        })
        const statements = object.statements
          .map((s) => s.trim())
          .filter(Boolean)
        return { statements }
      } catch (err) {
        deps.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "fact-decomposer falló → no aprende"
        )
        return { statements: [] }
      }
    },
  }
}
