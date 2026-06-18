// unlearnFact — desaprende hecho(s) CONFIRMADO(s) vigente(s) sobre Kevin (owner-only). Intención distinta de
// resolveFact (que adjudica PROPUESTAS pendientes); acá se olvida algo ya sabido. Invariante #8 (el modelo nunca
// toca uuids): pasa una descripción en lenguaje natural + (si hay lista) un ORDINAL o `all`; el sistema mapea e
// INVALIDA bi-temporal (reversible/auditable, no borra). HÍBRIDO de matching: (1) corte ESTRICTO por coseno
// (rápido, recall acotado: "olvidá el fútbol" no trae pizza/pasta); (2) si quedan ≥2, el FactMatcher (LLM) los
// filtra por RELEVANCIA/tema (precisión: "lo de la pizza" matchea todas las pizzas). 1 match → lo olvida en el
// turno; varios → lista por ordinal y ofrece elegir uno (`which`) o todos (`all`).

import { tool } from "ai"
import { z } from "zod"
import type { ConflictCandidate } from "../../ports/facts.js"
import type { ActionContext, ActionDescriptor } from "./types.js"

export const unlearnFact: ActionDescriptor = {
  name: "unlearnFact",
  sideEffecting: true,
  clearance: "owner",
  build(ctx: ActionContext) {
    return tool({
      description:
        "Desaprende hecho(s) que YA tenías guardado(s) sobre Kevin (cuando dejaron de ser ciertos o pidió " +
        "olvidarlos). Pasá en lenguaje natural QUÉ olvidar; yo busco. Si hay uno claro lo olvido al toque; si hay " +
        "varios del mismo tema te los listo por número para que elijas uno (`which`) o todos (`all`). No borro de " +
        "verdad: lo doy de baja (reversible). NO pases ids.",
      inputSchema: z.object({
        about: z
          .string()
          .min(1)
          .describe(
            "Qué desaprender, en lenguaje natural (ej. 'que le gusta la pasta', 'lo de la pizza'). Yo busco."
          ),
        which: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            "Si te mostré una lista numerada y el owner eligió UNO, su número. Omitilo en la 1ª llamada."
          ),
        all: z
          .boolean()
          .optional()
          .describe(
            "true SOLO si el owner confirmó olvidar TODOS los de la lista que te mostré."
          ),
      }),
      execute: async ({ about, which, all }, { toolCallId }) => {
        const t0 = Date.now()
        const emit = (ok: boolean, output: string): string => {
          ctx.emit({
            ...ctx.ids,
            type: "tool.result",
            toolCallId,
            toolName: "unlearnFact",
            ok,
            latencyMs: Date.now() - t0,
            output,
          })
          return output
        }
        if (!ctx.factStore) {
          return emit(
            false,
            "No puedo tocar la memoria ahora mismo (no configurada)."
          )
        }
        const factStore = ctx.factStore
        try {
          const locale = ctx.locale === "en" ? "en" : "es"
          // (1) Corte ESTRICTO por coseno (rápido, sin LLM): si nada está cerca → "no encontré" (no gasta el matcher).
          const near = await factStore.findConfirmedNear(
            about,
            ctx.principal.id,
            {
              maxDistance: ctx.factUnlearnDistance,
            }
          )
          // (2) Si quedan ≥2, el matcher desambigua por relevancia (precisión). 0/1 → confío en el corte estricto.
          let matches: ConflictCandidate[] = near
          if (near.length >= 2 && ctx.factMatcher) {
            const { ordinals } = await ctx.factMatcher.match({
              description: about,
              candidates: near.map((c, i) => ({
                ordinal: i,
                statement: c.statement,
              })),
              locale,
            })
            const keep = new Set(ordinals)
            const filtered = near.filter((_c, i) => keep.has(i))
            matches = filtered.length > 0 ? filtered : []
          }
          if (matches.length === 0) {
            return emit(
              true,
              "No encontré nada parecido guardado para olvidar."
            )
          }

          // Fase 2a: olvidar TODOS los de la lista (el owner lo confirmó).
          if (all === true) {
            const done: string[] = []
            for (const m of matches) {
              if (await factStore.invalidate(m.id)) done.push(m.statement)
            }
            return emit(
              done.length > 0,
              done.length > 0
                ? `Listo, olvidé: ${done.map((s) => `«${s}»`).join(", ")}.`
                : "No pude darlos de baja (quizá ya estaban olvidados)."
            )
          }
          // Fase 2b: el owner eligió UN número de la lista (mapeo ordinal→uuid, Inv #8).
          if (which !== undefined) {
            const target = matches[which]
            if (!target) {
              return emit(
                false,
                "Ese número no corresponde a ningún hecho de la lista."
              )
            }
            const ok = await factStore.invalidate(target.id)
            return emit(
              ok,
              ok
                ? `Listo, lo olvidé: «${target.statement}».`
                : "No pude darlo de baja (quizá ya estaba olvidado)."
            )
          }
          // Fase 1: 1 match nítido → resolver EN EL TURNO (reversible + nombra qué olvidó = fallo visible).
          if (matches.length === 1) {
            const only = matches[0]
            if (!only) {
              return emit(true, "No encontré nada parecido guardado.")
            }
            const ok = await factStore.invalidate(only.id)
            return emit(
              ok,
              ok
                ? `Listo, lo olvidé: «${only.statement}».`
                : "No pude darlo de baja (quizá ya estaba olvidado)."
            )
          }
          // ≥2 matches del mismo tema → listar por ordinal y ofrecer uno (`which`) o todos (`all`).
          const list = matches
            .map((c, i) => `  [${i}] «${c.statement}»`)
            .join("\n")
          return emit(
            true,
            `Encontré varios del mismo tema:\n${list}\n` +
              "Preguntale a Kevin si querés olvidar uno (re-llamá unlearnFact con su número en `which`) o TODOS " +
              "(re-llamá con all:true)."
          )
        } catch {
          return emit(false, "No pude desaprender el hecho ahora mismo.")
        }
      },
    })
  },
}
