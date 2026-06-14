// checkRepoFreshness: chequeo BARATO (1 request) de si la copia indexada de un repo que Vaio conoce está al día
// con GitHub. Read-only, clearance "anyone", todos los canales. Vaio la usa cuando la respuesta depende del
// ESTADO ACTUAL del código de un repo. Degrada limpio si no hay sync configurado.

import { tool } from "ai"
import { z } from "zod"
import type { ActionContext, ActionDescriptor } from "./types.js"

export const checkRepoFreshness: ActionDescriptor = {
  name: "checkRepoFreshness",
  sideEffecting: false,
  clearance: "anyone",
  build(ctx: ActionContext) {
    return tool({
      description:
        "Verifica si tu copia indexada de un repo que conocés (p.ej. tu propio KevinJGV/Vaio) está al día con GitHub. Es barato. Usala cuando la respuesta dependa del ESTADO ACTUAL del código/arquitectura de un repo; si da desactualizado, sincronizá con syncRepo antes de responder.",
      inputSchema: z.object({
        owner: z.string().describe("Dueño del repo, p.ej. KevinJGV."),
        repo: z.string().describe("Nombre del repo, p.ej. Vaio."),
      }),
      execute: async ({ owner, repo }, { toolCallId }) => {
        const t0 = Date.now()
        const done = (ok: boolean, output: string) => {
          ctx.emit({
            ...ctx.ids,
            type: "tool.result",
            toolCallId,
            toolName: "checkRepoFreshness",
            ok,
            latencyMs: Date.now() - t0,
            output,
          })
          return output
        }
        if (!ctx.repoSync) {
          return done(false, "No puedo verificar repos ahora mismo.")
        }
        try {
          const { state } = await ctx.repoSync.freshness({ owner, repo })
          const output =
            state === "fresh"
              ? `Tu copia de ${owner}/${repo} está al día.`
              : state === "stale"
                ? `Tu copia de ${owner}/${repo} está desactualizada: hay cambios nuevos en GitHub.`
                : `No tenés ${owner}/${repo} en memoria (no es un repo que conozcas).`
          return done(true, output)
        } catch {
          return done(false, "No pude verificar la frescura ahora mismo.")
        }
      },
    })
  },
}
