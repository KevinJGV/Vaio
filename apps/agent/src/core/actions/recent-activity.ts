// recentActivity: actividad de Kevin desde los conectores habilitados (Last.fm, GitHub, …), en DOS sentidos del
// tiempo a la vez: el AHORA (`live()` — qué escucha/hace ahora) + la EVOLUCIÓN (el último `trend:<source>`
// derivado, leído por source exacto de la memoria → determinístico, Invariante #8). Read-only, clearance
// "anyone", todos los canales. Best-effort (un fallo/null se omite). Que UNA tool cubra ambos sentidos evita que
// compita con searchMemory por la decisión (un bug real: ante "¿cómo viene?" el modelo agarraba solo lo live y
// perdía la tendencia). Inerte si no hay trends (TRENDS_ENABLED off → sin chunks `trend:*` → solo live).

import { tool } from "ai"
import { z } from "zod"
import { trendSource } from "../trends.js"
import type { ActionContext, ActionDescriptor } from "./types.js"

export const recentActivity: ActionDescriptor = {
  name: "recentActivity",
  sideEffecting: false,
  clearance: "anyone",
  build(ctx: ActionContext) {
    const connectors = ctx.connectors ?? []
    return tool({
      description:
        "Actividad de Kevin desde sus fuentes conectadas, en dos planos a la vez: lo que está haciendo/escuchando/jugando AHORA (música, código, juegos) y CÓMO VIENE últimamente (tendencias: en qué se enganchó, qué subió o bajó, hacia dónde se movió). Usala para '¿qué está/viene haciendo/escuchando/jugando?', '¿en qué anda?', '¿en qué se enganchó?', '¿cómo viene con el código/la música?'. NO para datos estáticos como bio/stack/contacto (eso es searchMemory).",
      inputSchema: z.object({}),
      execute: async (_input, { toolCallId }) => {
        const t0 = Date.now()
        // Dos sentidos del tiempo en paralelo: el AHORA (live) + la EVOLUCIÓN (trend:<source> por clave exacta).
        const [live, trends] = await Promise.all([
          Promise.all(connectors.map((c) => c.live().catch(() => null))),
          Promise.all(
            connectors.map(
              (c) =>
                ctx.memory
                  ?.getBySource?.(trendSource(c.name))
                  .catch(() => []) ?? Promise.resolve([])
            )
          ),
        ])
        const snaps = live.filter((s): s is string => Boolean(s))
        const trendLines = trends.flatMap((chunks, i) => {
          const text = chunks[0]?.chunk?.trim()
          const name = connectors[i]?.name
          return text ? [`- [${name}] ${text}`] : []
        })
        let output =
          snaps.length > 0
            ? snaps.join("\n")
            : "Ahora mismo no tengo señales de actividad de Kevin."
        if (trendLines.length > 0)
          output += `\n\n📈 Cómo viene Kevin últimamente (tendencias):\n${trendLines.join("\n")}`
        ctx.emit({
          ...ctx.ids,
          type: "tool.result",
          toolCallId,
          toolName: "recentActivity",
          ok: true,
          hits: snaps.length + trendLines.length,
          latencyMs: Date.now() - t0,
          output,
        })
        return output
      },
    })
  },
}
