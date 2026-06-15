// rememberFact — guarda un hecho durable sobre Kevin (owner-only). Invariante #8 (el modelo solo pasa el
// statement en lenguaje natural; el sistema gestiona ids/embeddings):
//  - sin conflicto → el sistema lo guarda EN EL ACTO (propose+commit server-side; sin id ni 2ª llamada).
//  - con conflicto → lo deja pendiente y devuelve los conflictos NUMERADOS por ordinal (sin uuids) para que el
//    modelo le pregunte al usuario; la resolución va por resolveFact.

import { tool } from "ai"
import { z } from "zod"
import type { ActionContext, ActionDescriptor } from "./types.js"

export const rememberFact: ActionDescriptor = {
  name: "rememberFact",
  sideEffecting: true,
  clearance: "owner",
  build(ctx: ActionContext) {
    return tool({
      description:
        "Guarda un HECHO nuevo y durable sobre Kevin (preferencia, dato de vida, cambio de stack…) que surgió " +
        "en la charla. Si no choca con nada, lo guardo solo (no hace falta confirmación). Si choca con un hecho " +
        "previo, lo dejo pendiente y te aviso para que le preguntes al usuario si reemplaza. Solo datos que " +
        "valga la pena recordar a futuro; no para charla pasajera.",
      inputSchema: z.object({
        statement: z
          .string()
          .min(1)
          .describe(
            "El hecho, en una frase clara y autocontenida (3ª persona sobre Kevin)."
          ),
      }),
      execute: async ({ statement }, { toolCallId }) => {
        const t0 = Date.now()
        const emit = (ok: boolean, output: string): string => {
          ctx.emit({
            ...ctx.ids,
            type: "tool.result",
            toolCallId,
            toolName: "rememberFact",
            ok,
            latencyMs: Date.now() - t0,
            output,
          })
          return output
        }
        if (!ctx.factStore) {
          return emit(
            false,
            "No puedo guardar hechos ahora mismo (memoria no configurada)."
          )
        }
        try {
          const { id, conflicts } = await ctx.factStore.propose({
            statement,
            principalId: ctx.principal.id,
            channel: ctx.principal.channel,
            conversationId: ctx.ids.conversationId,
            turnId: ctx.ids.turnId,
          })
          if (conflicts.length === 0) {
            // Sin choque → guardar en el acto (el sistema gestiona el id, no el modelo).
            await ctx.factStore.commit(id)
            return emit(true, "Listo, lo guardé en mi memoria.")
          }
          const list = conflicts
            .map((c, i) => `  [${i}] «${c.statement}»`)
            .join("\n")
          return emit(
            true,
            `Lo dejé pendiente porque podría chocar con:\n${list}\n` +
              "Preguntale al usuario si REEMPLAZA alguno (vos juzgás si de verdad se contradicen). Cuando " +
              "responda: reemplazar → resolveFact(decision:confirm, replaces:[esos números]); si conviven → " +
              "resolveFact(decision:confirm); si lo descarta → resolveFact(decision:reject)."
          )
        } catch {
          return emit(false, "No pude registrar el hecho ahora mismo.")
        }
      },
    })
  },
}
