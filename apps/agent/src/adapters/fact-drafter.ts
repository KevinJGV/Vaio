// Adapter del FactDrafter: usa generateObject (structured output) sobre un LanguageModel ya construido (la cadena
// OpenRouter, igual que el summarizer). El modelo SOLO produce lenguaje natural (el statement) — el sistema lo
// persiste (Inv #8). best-effort: cualquier fallo → { statement: null } (no guarda; Inv #1 + privacidad #5).

import { generateObject, type LanguageModel } from "ai"
import { z } from "zod"
import type { FactDrafter } from "../ports/fact-drafter.js"
import type { Logger } from "../ports/logger.js"

const SCHEMA = z.object({
  shouldLearn: z
    .boolean()
    .describe(
      "true SOLO si la respuesta afirma un hecho durable sobre Kevin y NO es sensible/privado"
    ),
  statement: z
    .string()
    .describe(
      "el hecho en 3ª persona ('A Kevin le …'); vacío si shouldLearn=false"
    ),
  reason: z.string().describe("una frase breve: por qué sí/no"),
})

const SYSTEM_ES = [
  "Sos el redactor de la memoria de Kevin. Te doy una pregunta de un visitante sobre Kevin y la respuesta de Kevin (el dueño).",
  "Decidí si la respuesta contiene un HECHO durable sobre Kevin que valga recordar y, si sí, redactalo en 3ª persona,",
  "autocontenido (ej. «A Kevin le gusta la pasta»).",
  "shouldLearn=false si la respuesta NO afirma un hecho durable (saludo, «no sé», una instrucción de contacto como",
  "«decile que me escriba», una opinión efímera).",
  "shouldLearn=false SIEMPRE si hay algo SENSIBLE o PRIVADO: teléfonos, direcciones, documentos, credenciales, o si",
  "Kevin pide no compartirlo («no le pases mi número», «esto no lo publiques»). Ante CUALQUIER duda de privacidad → false.",
  "El statement va en 3ª persona, sin la pregunta ni meta-comentarios; nunca inventes más de lo que Kevin dijo.",
].join(" ")

const SYSTEM_EN = [
  "You curate Kevin's memory. I give you a visitor's question about Kevin and Kevin's (the owner's) answer.",
  "Decide whether the answer states a DURABLE fact about Kevin worth remembering, and if so write it in the third",
  "person, self-contained (e.g. «Kevin likes pasta»).",
  "shouldLearn=false if the answer states no durable fact (a greeting, «I don't know», a contact instruction like",
  "«tell them to write me», an ephemeral opinion).",
  "shouldLearn=false ALWAYS if anything is SENSITIVE or PRIVATE: phone numbers, addresses, documents, credentials, or",
  "if Kevin asks not to share it («don't give them my number», «don't publish this»). Any privacy doubt → false.",
  "The statement is third-person, without the question or meta-comments; never invent beyond what Kevin said.",
].join(" ")

export function createFactDrafter(deps: {
  model: LanguageModel
  logger: Logger
}): FactDrafter {
  return {
    async draft({ question, ownerAnswer, locale }) {
      try {
        const { object } = await generateObject({
          model: deps.model,
          schema: SCHEMA,
          system: locale === "en" ? SYSTEM_EN : SYSTEM_ES,
          prompt:
            locale === "en"
              ? `Visitor's question: «${question}»\nKevin's answer: «${ownerAnswer}»`
              : `Pregunta del visitante: «${question}»\nRespuesta de Kevin: «${ownerAnswer}»`,
        })
        const statement = object.statement.trim()
        if (!object.shouldLearn || statement === "") {
          return { statement: null, reason: object.reason }
        }
        return { statement, reason: object.reason }
      } catch (err) {
        deps.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "fact-drafter falló → no guarda"
        )
        return { statement: null, reason: "drafter-error" }
      }
    },
  }
}
