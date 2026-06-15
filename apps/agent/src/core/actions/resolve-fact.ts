// resolveFact — resuelve la propuesta de hecho PENDIENTE que dejó rememberFact al detectar un choque
// (owner-only). Invariante #8: el modelo SOLO pasa enum + ordinales pequeños; NUNCA un uuid. El sistema:
//  - resuelve la pendiente determinísticamente (la más reciente, o `which` ordinal),
//  - mapea los ordinales de `replaces` → los uuids de los conflictos que él MISMO computó (target.conflicts).

import { tool } from "ai"
import { z } from "zod"
import type { ActionContext, ActionDescriptor } from "./types.js"

export const resolveFact: ActionDescriptor = {
  name: "resolveFact",
  sideEffecting: true,
  clearance: "owner",
  build(ctx: ActionContext) {
    return tool({
      description:
        "Resuelve la propuesta de hecho PENDIENTE (la que dejó rememberFact al detectar un choque). " +
        "decision:confirm la guarda; reject la descarta. Para reemplazar hechos viejos que se contradicen, pasá " +
        "sus NÚMEROS (los que te mostré) en `replaces` — yo me encargo de invalidarlos. NO pases ids/uuids.",
      inputSchema: z.object({
        decision: z
          .enum(["confirm", "reject"])
          .describe("confirm = guardar; reject = descartar."),
        replaces: z
          .array(z.number().int().nonnegative())
          .optional()
          .describe(
            "Números de los hechos que ESTE reemplaza/contradice (los que te mostré). Solo si el usuario " +
              "confirmó reemplazarlos. Si solo coexisten, no lo pases."
          ),
        which: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            "Si hay varias propuestas pendientes, el número de cuál resolver (0 = la más reciente). Default 0."
          ),
      }),
      execute: async ({ decision, replaces, which }, { toolCallId }) => {
        const t0 = Date.now()
        const emit = (ok: boolean, output: string): string => {
          ctx.emit({
            ...ctx.ids,
            type: "tool.result",
            toolCallId,
            toolName: "resolveFact",
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
          const pend = await ctx.factStore.listPending(ctx.principal.id)
          const target = pend[which ?? 0]
          if (!target) {
            return emit(
              false,
              "No tengo ninguna propuesta pendiente para resolver."
            )
          }
          if (decision === "reject") {
            await ctx.factStore.reject(target.id)
            return emit(true, "Ok, lo descarté.")
          }
          // confirm: mapear ordinales → uuids de los conflictos que el SISTEMA conoce (el modelo no toca uuids).
          const supersedes = (replaces ?? [])
            .map((i) => target.conflicts[i]?.id)
            .filter((id): id is string => Boolean(id))
          const ok = await ctx.factStore.commit(target.id, { supersedes })
          if (!ok) {
            return emit(
              false,
              "No encontré esa propuesta pendiente (quizá ya se resolvió)."
            )
          }
          return emit(
            true,
            supersedes.length > 0
              ? "Listo, lo guardé y reemplacé el anterior."
              : "Listo, lo guardé en mi memoria."
          )
        } catch {
          return emit(false, "No pude resolver la propuesta ahora mismo.")
        }
      },
    })
  },
}
