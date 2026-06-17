// unlearnFact — desaprende un hecho CONFIRMADO vigente sobre Kevin (owner-only). Intención distinta de
// resolveFact (que adjudica PROPUESTAS pendientes); acá se olvida algo ya sabido. Invariante #8 (el modelo
// nunca toca uuids): pasa una descripción en lenguaje natural + (si hay lista) un ORDINAL; el sistema busca los
// candidatos confirmados cercanos, mapea ordinal→uuid e INVALIDA bi-temporal (reversible/auditable, no borra).
// Patrón 2-fases auto-contenido: 1 match nítido → lo olvida en el acto (resolver en el turno); varios → lista.

import { tool } from "ai"
import { z } from "zod"
import type { ActionContext, ActionDescriptor } from "./types.js"

export const unlearnFact: ActionDescriptor = {
  name: "unlearnFact",
  sideEffecting: true,
  clearance: "owner",
  build(ctx: ActionContext) {
    return tool({
      description:
        "Desaprende un hecho que YA tenías guardado sobre Kevin (cuando dejó de ser cierto o pidió olvidarlo). " +
        "Pasá en lenguaje natural QUÉ olvidar; yo busco el hecho. Si hay uno claro lo olvido al toque; si hay " +
        "varios parecidos te los listo por número para que me digas cuál (pasás ese número en `which`). No borro " +
        "de verdad: lo doy de baja (reversible). NO pases ids.",
      inputSchema: z.object({
        about: z
          .string()
          .min(1)
          .describe(
            "Qué desaprender, en lenguaje natural (ej. 'que le gusta la pasta'). Yo busco los candidatos."
          ),
        which: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            "Si te mostré una lista numerada, el número del hecho a olvidar. Omitilo en la 1ª llamada."
          ),
      }),
      execute: async ({ about, which }, { toolCallId }) => {
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
        try {
          const candidates = await ctx.factStore.findConfirmedNear(
            about,
            ctx.principal.id
          )
          if (candidates.length === 0) {
            return emit(
              true,
              "No encontré nada parecido guardado para olvidar."
            )
          }
          // Fase 2: el owner ya eligió un número de la lista → invalidar ese (mapeo ordinal→uuid, Inv #8).
          if (which !== undefined) {
            const target = candidates[which]
            if (!target) {
              return emit(
                false,
                "Ese número no corresponde a ningún hecho de la lista."
              )
            }
            const ok = await ctx.factStore.invalidate(target.id)
            return emit(
              ok,
              ok
                ? `Listo, lo olvidé: «${target.statement}».`
                : "No pude darlo de baja (quizá ya estaba olvidado)."
            )
          }
          // Fase 1, 1 match nítido → resolver EN EL TURNO (reversible + el resultado nombra qué olvidó = fallo visible).
          if (candidates.length === 1) {
            const only = candidates[0]
            if (!only) {
              return emit(true, "No encontré nada parecido guardado.")
            }
            const ok = await ctx.factStore.invalidate(only.id)
            return emit(
              ok,
              ok
                ? `Listo, lo olvidé: «${only.statement}».`
                : "No pude darlo de baja (quizá ya estaba olvidado)."
            )
          }
          // Varios candidatos → listar por ordinal y pedir el número (el modelo re-llama con `which`).
          const list = candidates
            .map((c, i) => `  [${i}] «${c.statement}»`)
            .join("\n")
          return emit(
            true,
            `Encontré varios parecidos:\n${list}\n` +
              "Preguntale a Kevin cuál querés que olvide y volvé a llamar unlearnFact con ese número en `which`."
          )
        } catch {
          return emit(false, "No pude desaprender el hecho ahora mismo.")
        }
      },
    })
  },
}
