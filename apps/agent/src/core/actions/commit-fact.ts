import { tool } from "ai"
import { z } from "zod"
import type { ActionContext, ActionDescriptor } from "./types.js"

export const commitFact: ActionDescriptor = {
  name: "commitFact",
  sideEffecting: true,
  clearance: "owner",
  build(ctx: ActionContext) {
    return tool({
      description:
        "Confirma (guarda) o rechaza una propuesta de hecho YA registrada con proposeFact. Llamala SOLO " +
        "después de que el usuario confirme/rechace explícitamente. Requiere el id de la propuesta.",
      inputSchema: z.object({
        id: z.string().min(1).describe("El id que devolvió proposeFact."),
        decision: z
          .enum(["confirm", "reject"])
          .describe("confirm = guardar; reject = descartar."),
      }),
      execute: async ({ id, decision }, { toolCallId }) => {
        const t0 = Date.now()
        if (!ctx.factStore) {
          const output =
            "No puedo guardar hechos ahora mismo (memoria no configurada)."
          ctx.emit({
            ...ctx.ids,
            type: "tool.result",
            toolCallId,
            toolName: "commitFact",
            ok: false,
            latencyMs: Date.now() - t0,
            output,
          })
          return output
        }
        try {
          const ok =
            decision === "confirm"
              ? await ctx.factStore.commit(id)
              : await ctx.factStore.reject(id)
          const output = ok
            ? decision === "confirm"
              ? "Listo, lo guardé en mi memoria."
              : "Ok, lo descarté."
            : "No encontré esa propuesta pendiente (quizá ya se resolvió)."
          ctx.emit({
            ...ctx.ids,
            type: "tool.result",
            toolCallId,
            toolName: "commitFact",
            ok,
            latencyMs: Date.now() - t0,
            output,
          })
          return output
        } catch {
          const output = "No pude resolver la propuesta ahora mismo."
          ctx.emit({
            ...ctx.ids,
            type: "tool.result",
            toolCallId,
            toolName: "commitFact",
            ok: false,
            latencyMs: Date.now() - t0,
            output,
          })
          return output
        }
      },
    })
  },
}
