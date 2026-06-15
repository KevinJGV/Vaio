// recentActivity: snapshot EN VIVO de la actividad/estado de Kevin desde los conectores habilitados (Last.fm,
// GitHub, …). Read-only, clearance "anyone" (info pública), todos los canales. Itera los `live()` best-effort
// (un fallo/null se omite). Para "¿qué escuchás/hiciste hoy?" — NO para datos estáticos (eso es searchMemory).

import { tool } from "ai"
import { z } from "zod"
import type { ActionContext, ActionDescriptor } from "./types.js"

export const recentActivity: ActionDescriptor = {
  name: "recentActivity",
  sideEffecting: false,
  clearance: "anyone",
  build(ctx: ActionContext) {
    const connectors = ctx.connectors ?? []
    return tool({
      description:
        "Actividad y estado EN VIVO de Kevin desde sus fuentes conectadas (música que escucha ahora, actividad de código reciente, etc.). Usala cuando pregunten qué está haciendo/escuchando o qué hizo hoy/recientemente. NO para datos estáticos como bio/stack (eso es searchMemory).",
      inputSchema: z.object({}),
      execute: async (_input, { toolCallId }) => {
        const t0 = Date.now()
        const snaps = (
          await Promise.all(connectors.map((c) => c.live().catch(() => null)))
        ).filter((s): s is string => Boolean(s))
        const output =
          snaps.length > 0
            ? snaps.join("\n")
            : "Ahora mismo no tengo señales de actividad de Kevin."
        ctx.emit({
          ...ctx.ids,
          type: "tool.result",
          toolCallId,
          toolName: "recentActivity",
          ok: true,
          hits: snaps.length,
          latencyMs: Date.now() - t0,
          output,
        })
        return output
      },
    })
  },
}
