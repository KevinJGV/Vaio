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
        supersedes: z
          .array(z.string())
          .optional()
          .describe(
            "Solo con decision:confirm. id(s) de hechos ya guardados que ESTE reemplaza/contradice — se " +
              "invalidan. Pasalos SOLO si proposeFact los marcó como choque Y el usuario confirmó reemplazarlos."
          ),
      }),
      execute: async ({ id, decision, supersedes }, { toolCallId }) => {
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
              ? await ctx.factStore.commit(id, { supersedes })
              : await ctx.factStore.reject(id)
          const replaced =
            decision === "confirm" && (supersedes?.length ?? 0) > 0
          const output = ok
            ? decision === "confirm"
              ? replaced
                ? "Listo, lo guardé y reemplacé el anterior."
                : "Listo, lo guardé en mi memoria."
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
