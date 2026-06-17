// Adapter del ConflictJudge: usa generateObject (structured output) sobre un LanguageModel ya construido (el de
// CHAT — el de summary falla generateObject). El modelo SOLO emite intención: un verdict por ORDINAL (Inv #8); el
// sistema mapea ordinal→uuid afuera. Degradación CONSERVADORA (Inv #1): candidates:[] → sin LLM; ante error o
// decisiones faltantes/ordinales fuera de rango → un veredicto por cada candidato de entrada, default "coexists"
// (NUNCA inventa "contradicts" → jamás invalida por error). best-effort, igual estilo que fact-drafter.

import { generateObject, type LanguageModel } from "ai"
import { z } from "zod"
import type {
  ConflictJudge,
  ConflictJudgeResult,
  ConflictVerdict,
  JudgeDecision,
} from "../ports/conflict-judge.js"
import type { Logger } from "../ports/logger.js"

const SCHEMA = z.object({
  decisions: z.array(
    z.object({
      ordinal: z
        .number()
        .int()
        .nonnegative()
        .describe("el número del candidato que te di"),
      verdict: z
        .enum(["contradicts", "duplicate", "coexists", "unsure"])
        .describe(
          "contradicts = no pueden ser ambos ciertos a la vez (cambió de stack/ciudad, 'ya no le gusta X'); " +
            "duplicate = dicen lo MISMO; coexists = ambos ciertos (aditivo); unsure = no estás seguro"
        ),
    })
  ),
  suggestion: z
    .string()
    .describe("vacío salvo que tengas una recomendación útil para el owner"),
})

const SYSTEM_ES = [
  "Sos el juez de contradicción de la memoria de Kevin. Te doy un hecho NUEVO sobre Kevin + una lista numerada de",
  "hechos VIGENTES cercanos. Para CADA número decidí la relación con el hecho nuevo.",
  "Cercanía de tema NO es contradicción — distinguí dimensiones: preferencia ≠ atributo ≠ anécdota/evento.",
  "Ejemplos: «no le gusta el fútbol» + «una anécdota de fútbol» COEXISTEN; «le gusta la pasta» + «le gusta el fútbol» COEXISTEN.",
  "Solo `contradicts` cuando NO pueden ser ambos ciertos a la vez (cambió de stack o de ciudad, «ya no le gusta X»).",
  "`duplicate` = dicen lo mismo. `coexists` = ambos ciertos (aditivo). `unsure` = no estás seguro.",
  "Devolvé una decisión por cada número que te di, con su ordinal. `suggestion` vacío salvo que tengas una recomendación útil para el owner.",
].join(" ")

const SYSTEM_EN = [
  "You are the contradiction judge of Kevin's memory. I give you a NEW fact about Kevin + a numbered list of nearby",
  "CURRENT facts. For EACH number decide its relation to the new fact.",
  "Topic closeness is NOT contradiction — distinguish dimensions: preference ≠ attribute ≠ anecdote/event.",
  "Examples: «he dislikes football» + «a football anecdote» COEXIST; «he likes pasta» + «he likes football» COEXIST.",
  "Only `contradicts` when both CANNOT be true at once (changed stack or city, «he no longer likes X»).",
  "`duplicate` = they state the same thing. `coexists` = both true (additive). `unsure` = you're not sure.",
  "Return one decision per number I gave you, with its ordinal. `suggestion` empty unless you have a useful recommendation for the owner.",
].join(" ")

function numbered(
  candidates: { ordinal: number; statement: string }[]
): string {
  return candidates.map((c) => `[${c.ordinal}] «${c.statement}»`).join("\n")
}

export function createConflictJudge(deps: {
  model: LanguageModel
  logger: Logger
}): ConflictJudge {
  return {
    async judge({ rawText, statement, candidates, locale }) {
      // candidates:[] → cortocircuito conservador, sin llamar al LLM (ahorro; Inv #1).
      if (candidates.length === 0) {
        return { decisions: [] }
      }

      // Default conservador: un veredicto "coexists" por cada candidato (Inv #1 — nunca invalida por error).
      const fallback = (): ConflictJudgeResult => ({
        decisions: candidates.map((c) => ({
          ordinal: c.ordinal,
          verdict: "coexists" as const,
        })),
      })

      try {
        const { object } = await generateObject({
          model: deps.model,
          schema: SCHEMA,
          system: locale === "en" ? SYSTEM_EN : SYSTEM_ES,
          prompt:
            locale === "en"
              ? `Owner's raw words: «${rawText}»\nNew fact about Kevin: «${statement}»\nCurrent nearby facts:\n${numbered(candidates)}`
              : `Palabras crudas del owner: «${rawText}»\nHecho nuevo sobre Kevin: «${statement}»\nHechos vigentes cercanos:\n${numbered(candidates)}`,
        })

        // Reconstruir SIEMPRE una decisión por cada candidato de entrada (ordinal 0..n-1), tomando la del modelo si
        // es válida (ordinal en rango) y completando los faltantes con "coexists" (Inv #1, conservador).
        const validOrdinals = new Set(candidates.map((c) => c.ordinal))
        const byOrdinal = new Map<number, ConflictVerdict>()
        for (const d of object.decisions) {
          if (validOrdinals.has(d.ordinal) && !byOrdinal.has(d.ordinal)) {
            byOrdinal.set(d.ordinal, d.verdict)
          }
        }
        const decisions: JudgeDecision[] = candidates.map((c) => ({
          ordinal: c.ordinal,
          verdict: byOrdinal.get(c.ordinal) ?? "coexists",
        }))

        const suggestion = object.suggestion.trim()
        return suggestion === "" ? { decisions } : { decisions, suggestion }
      } catch (err) {
        deps.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "conflict-judge falló → todos coexists (conservador)"
        )
        return fallback()
      }
    },
  }
}
