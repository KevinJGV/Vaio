// checkRepoFreshness: chequeo BARATO (1 request) de si la copia indexada de un repo que Vaio conoce está al día
// con GitHub. clearance "anyone", todos los canales. Vaio la usa cuando la respuesta depende del ESTADO ACTUAL
// del código de un repo. Si está desactualizado, dispara el refresco en BACKGROUND (fire-and-forget) y responde
// YA: el modelo solo CONSULTA y reporta, el SISTEMA gestiona el sync (Invariante #8) — nunca se bloquea el turno
// re-embebiendo (se midió un sync inline de 191s). La frescura llega al próximo turno (futuro: turnos proactivos
// avisan al completar). Degrada limpio si no hay sync configurado.

import { tool } from "ai"
import { z } from "zod"
import { repoSlug, resolveKnownRepo } from "./repo-select.js"
import type { ActionContext, ActionDescriptor } from "./types.js"

export const checkRepoFreshness: ActionDescriptor = {
  name: "checkRepoFreshness",
  sideEffecting: false,
  clearance: "anyone",
  build(ctx: ActionContext) {
    // Invariante #8: el modelo ELIGE el repo de un set cerrado (enum), no tipea owner/repo libre.
    const repos = ctx.knownRepos ?? []
    const slugs = repos.map(repoSlug)
    const inputSchema =
      slugs.length > 0
        ? z.object({
            repo: z
              .enum(slugs as [string, ...string[]])
              .describe("Elegí el repo de la lista (de los que conocés)."),
          })
        : z.object({})
    return tool({
      description:
        "Verifica si tu copia indexada de un repo que conocés (p.ej. tu propio KevinJGV/Vaio) está al día con GitHub. Es barato. Elegí el repo de la lista. Usala cuando la respuesta dependa del ESTADO ACTUAL del código/arquitectura de un repo. Si da desactualizado, el sistema ya lo pone al día solo en segundo plano (no bloquea, no necesitás hacer nada): respondé con lo que tengas y, si querés, mencionalo al pasar.",
      inputSchema,
      execute: async (args, { toolCallId }) => {
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
        const spec = resolveKnownRepo(repos, (args as { repo?: string }).repo)
        if (!spec) {
          return done(
            false,
            "Por ahora no tengo repos que conozca para revisar."
          )
        }
        const { owner, repo } = spec
        try {
          const { state } = await ctx.repoSync.freshness({ owner, repo })
          if (state === "stale") {
            // Stale → refresco en BACKGROUND (fire-and-forget): NUNCA bloquea el turno re-embebiendo. El guard
            // de in-flight (en el adapter) evita duplicar si ya hay uno corriendo (p.ej. el del freshness gate).
            void ctx.repoSync.sync({ owner, repo }).catch(() => {})
          }
          const output =
            state === "fresh"
              ? `Tu copia de ${owner}/${repo} está al día.`
              : state === "stale"
                ? `Tu copia de ${owner}/${repo} estaba un poco atrás; ya la estoy poniendo al día sola en segundo plano. Te respondo con lo que tengo indexado.`
                : `No tenés ${owner}/${repo} en memoria (no es un repo que conozcas).`
          return done(true, output)
        } catch {
          return done(false, "No pude verificar la frescura ahora mismo.")
        }
      },
    })
  },
}
