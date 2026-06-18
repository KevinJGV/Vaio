// Adapter del FactMatcher: generateObject (structured output) sobre la cadena de chat (igual que el juez/decomposer
// — confiable para structured output). El modelo solo razona relevancia y devuelve ORDINALES; el sistema mapea a
// uuids e invalida (Inv #8). best-effort: cualquier fallo → todos los ordinales de entrada (no dropear en silencio).

import { generateObject, type LanguageModel } from "ai"
import { z } from "zod"
import type { FactMatcher } from "../ports/fact-matcher.js"
import type { Logger } from "../ports/logger.js"

const SCHEMA = z.object({
  ordinals: z
    .array(z.number().int().nonnegative())
    .describe(
      "los números de los hechos que SÍ pertenecen a lo que el owner quiere olvidar (subconjunto; vacío si ninguno)"
    ),
})

const SYSTEM_ES = [
  "Sos un filtro de relevancia para la memoria de Kevin. El owner pide OLVIDAR algo descrito en lenguaje natural.",
  "Te doy esa descripción y una lista NUMERADA de hechos guardados. Devolvé SOLO los números de los hechos que se",
  "refieren a ESO: el mismo tema, dato o preferencia. Sé inclusivo con el TEMA: una descripción de un tema abarca",
  "TODOS los hechos sobre ese mismo tema, tanto positivos como negativos. NO incluyas hechos de un tema distinto o",
  "no relacionado. Si ninguno coincide → lista vacía. No inventes números.",
].join(" ")

const SYSTEM_EN = [
  "You are a relevance filter for Kevin's memory. The owner asks to FORGET something described in natural language.",
  "I give you that description and a NUMBERED list of stored facts. Return ONLY the numbers of the facts that refer",
  "to IT: the same topic, datum or preference. Be inclusive with the TOPIC: a topic description covers ALL facts",
  "about that same topic, both positive and negative. Do NOT include facts about a different or unrelated topic.",
  "If none match → empty list. Don't invent numbers.",
].join(" ")

export function createFactMatcher(deps: {
  model: LanguageModel
  logger: Logger
}): FactMatcher {
  return {
    async match({ description, candidates, locale }) {
      const all = candidates.map((c) => c.ordinal)
      if (candidates.length === 0) return { ordinals: [] }
      try {
        const numbered = candidates
          .map((c) => `[${c.ordinal}] «${c.statement}»`)
          .join("\n")
        const { object } = await generateObject({
          model: deps.model,
          schema: SCHEMA,
          system: locale === "en" ? SYSTEM_EN : SYSTEM_ES,
          prompt:
            locale === "en"
              ? `Forget: «${description}»\nStored facts:\n${numbered}`
              : `Olvidar: «${description}»\nHechos guardados:\n${numbered}`,
        })
        // Quedarnos solo con ordinales válidos (en rango de los candidatos dados).
        const valid = new Set(all)
        const ordinals = object.ordinals.filter((o) => valid.has(o))
        return { ordinals }
      } catch (err) {
        deps.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "fact-matcher falló → confío en el corte por coseno (todos)"
        )
        return { ordinals: all }
      }
    },
  }
}
