import { tool } from "ai"
import { z } from "zod"
import type { ActionContext, ActionDescriptor } from "./types.js"

export const proposeFact: ActionDescriptor = {
  name: "proposeFact",
  sideEffecting: true,
  clearance: "owner",
  build(ctx: ActionContext) {
    return tool({
      description:
        "Propone guardar un HECHO nuevo y durable sobre Kevin (preferencia, dato de vida, cambio de stack…) " +
        "que surgió en la charla. NO lo guarda: registra la propuesta y debés pedirle confirmación al usuario " +
        "antes de commitear. Solo datos que valga la pena recordar; no para charla pasajera.",
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
        if (!ctx.factStore) {
          const output =
            "No puedo guardar hechos ahora mismo (memoria no configurada)."
          ctx.emit({
            ...ctx.ids,
            type: "tool.result",
            toolCallId,
            toolName: "proposeFact",
            ok: false,
            latencyMs: Date.now() - t0,
            output,
          })
          return output
        }
        try {
          const { id, conflicts } = await ctx.factStore.propose({
            statement,
            principalId: ctx.principal.id,
            channel: ctx.principal.channel,
            conversationId: ctx.ids.conversationId,
            turnId: ctx.ids.turnId,
          })
          let output: string
          if (conflicts.length === 0) {
            // Sin choque: si el owner lo pidió explícitamente, no hace falta pedir confirmación → guardalo ya.
            output =
              `Propuesta registrada (id ${id}). No choca con nada guardado. Si el usuario lo pidió explícitamente, ` +
              `llamá commitFact con id ${id} AHORA MISMO para guardarlo (no necesitás pedirle confirmación). ` +
              `Solo preguntá si fuiste vos quien dedujo el dato sin que lo pidiera.`
          } else {
            const list = conflicts
              .map((c) => {
                const when = c.validAt
                  ? ` (guardado el ${c.validAt.toLocaleDateString("es")})`
                  : ""
                return `  - [${c.id}] «${c.statement}»${when}`
              })
              .join("\n")
            output =
              `Propuesta registrada (id ${id}).\n⚠️ Puede chocar con hechos ya guardados:\n${list}\n` +
              "Preguntale al usuario si REEMPLAZA el/los anterior(es). Si confirma reemplazar, llamá commitFact " +
              `con id ${id} y supersedes:[esos id(s)]. Si en realidad conviven (no se contradicen), commitFact sin supersedes.`
          }
          ctx.emit({
            ...ctx.ids,
            type: "tool.result",
            toolCallId,
            toolName: "proposeFact",
            ok: true,
            latencyMs: Date.now() - t0,
            output,
          })
          return output
        } catch {
          const output = "No pude registrar la propuesta ahora mismo."
          ctx.emit({
            ...ctx.ids,
            type: "tool.result",
            toolCallId,
            toolName: "proposeFact",
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
