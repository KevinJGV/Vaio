// unlearnFact — desaprende hecho(s) CONFIRMADO(s) vigente(s) sobre Kevin (owner-only). Intención distinta de
// resolveFact (que adjudica PROPUESTAS pendientes); acá se olvida algo ya sabido. Invariante #8 (el modelo nunca
// toca uuids): pasa una descripción en lenguaje natural + (si hay lista) un ORDINAL o `all`; el sistema mapea e
// INVALIDA bi-temporal (reversible/auditable, no borra). RECALL TOTAL: "olvidá todo lo de [tema]" es COMPLETITUD,
// no relevancia top-K → el FactMatcher (LLM) juzga sobre TODOS los facts confirmados del owner (no un subconjunto
// por coseno, que recortaría recall). Cap `factUnlearnMax` (se loguea si se alcanza; a esa escala el norte es
// grafo/tags). Tras filtrar: 1 match → lo olvida en el turno; varios → lista por ordinal y ofrece uno (`which`) o
// todos (`all`); ninguno → "no encontré".

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
            "Qué desaprender, en lenguaje natural: un dato/preferencia puntual o un tema entero. Yo busco."
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
        thisThread: z
          .boolean()
          .optional()
          .describe(
            "true si el owner se refiere, por deixis/pronombre ('eso', 'lo que se aprendió acá'), al dato que se " +
              "curó EN ESTE hilo de escalada. El sistema sabe cuál es y lo desaprende directo; no pases ids."
          ),
      }),
      execute: async ({ about, which, all, thisThread }, { toolCallId }) => {
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
          // ANCLA determinística (Inc 2, Inv #8): el owner se refiere por deixis ("eso") al fact curado EN ESTE
          // hilo de escalada. El modelo solo pasó un booleano; el sistema mapea al uuid anclado (server-side) e
          // invalida directo (sin recall-total ni matcher). Sin ancla → cae al flujo normal por `about`.
          if (thisThread === true && ctx.threadOrigin?.factId) {
            const ok = await factStore.invalidate(ctx.threadOrigin.factId)
            return emit(
              ok,
              ok
                ? `Listo, lo olvidé: «${ctx.threadOrigin.statement ?? "ese dato"}».`
                : "No pude darlo de baja (quizá ya estaba olvidado)."
            )
          }
          const locale = ctx.locale === "en" ? "en" : "es"
          const cap = ctx.factUnlearnMax ?? 150
          // RECALL TOTAL: traer TODOS los confirmados vigentes del owner (hasta cap). No hay corte semántico previo
          // → nada del tema se escapa por estar "lejos" en el vector. Si nada hay guardado → "no encontré".
          const allFacts = await factStore.listConfirmed(
            ctx.principal.id,
            cap + 1
          )
          if (allFacts.length === 0) {
            return emit(true, "No encontré nada guardado para olvidar.")
          }
          if (allFacts.length > cap) {
            // No truncar en silencio: a esta escala el recall por LLM-sobre-todo deja de alcanzar (el norte es
            // grafo/tags). Se avisa y se sigue con los `cap` más recientes.
            ctx.logger.warn(
              { principalId: ctx.principal.id, cap },
              "unlearnFact: facts > cap → recall acotado a los más recientes (revisar paginación/grafo)"
            )
          }
          const candidates = allFacts.slice(0, cap)
          // PRECISIÓN: el matcher (LLM) juzga, sobre el conjunto COMPLETO, cuáles pertenecen al tema a olvidar.
          // Sin matcher (degradado) → no se filtra (el owner ve todo y elige).
          let matches: ConflictCandidate[] = candidates
          if (ctx.factMatcher) {
            const { ordinals } = await ctx.factMatcher.match({
              description: about,
              candidates: candidates.map((c, i) => ({
                ordinal: i,
                statement: c.statement,
              })),
              locale,
            })
            const keep = new Set(ordinals)
            matches = candidates.filter((_c, i) => keep.has(i)) // vacío → "no encontré"
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
