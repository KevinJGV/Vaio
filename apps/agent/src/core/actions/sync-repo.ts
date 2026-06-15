// syncRepo: sincroniza (re-indexa SOLO lo cambiado) la copia de un repo que Vaio YA conoce, para responder con
// su estado actual. Autónoma (sin HITL). Diff chico → inline; diff grande → refresco en background (sin colgar el
// turno; la reanudación proactiva en el mismo hilo es el incremento 2). Repo nuevo/ajeno → denegado (parte 2).
// sideEffecting (escribe en la memoria). La mención al usuario la decide el prompt según el canal (natural/silencio).

import { tool } from "ai"
import { z } from "zod"
import { repoSlug, resolveKnownRepo } from "./repo-select.js"
import type { ActionContext, ActionDescriptor } from "./types.js"

export const syncRepoAction: ActionDescriptor = {
  name: "syncRepo",
  sideEffecting: true,
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
        "Pone al día (re-indexa lo cambiado) tu copia de un repo que YA conocés, para responder con su estado actual. Elegí el repo de la lista. Llamala cuando checkRepoFreshness dé 'desactualizado'. NO sirve para repos nuevos/ajenos.",
      inputSchema,
      execute: async (args, { toolCallId }) => {
        const t0 = Date.now()
        const done = (ok: boolean, output: string, denied?: boolean) => {
          ctx.emit({
            ...ctx.ids,
            type: "tool.result",
            toolCallId,
            toolName: "syncRepo",
            ok,
            ...(denied ? { denied: true } : {}),
            latencyMs: Date.now() - t0,
            output,
          })
          return output
        }
        if (!ctx.repoSync) {
          return done(false, "No puedo sincronizar repos ahora mismo.")
        }
        const spec = resolveKnownRepo(repos, (args as { repo?: string }).repo)
        if (!spec) {
          return done(
            false,
            "Por ahora no tengo repos que conozca para poner al día."
          )
        }
        const { owner, repo } = spec
        try {
          if (!(await ctx.repoSync.isTracked({ owner, repo }))) {
            return done(
              false,
              `No tengo ${owner}/${repo} en memoria; por ahora solo puedo poner al día los repos que ya conozco.`,
              true
            )
          }
          const r = await ctx.repoSync.sync(
            { owner, repo },
            { inlineMaxFiles: ctx.syncInlineMaxFiles ?? 20 }
          )
          if (r.mode === "deferred") {
            // Diff grande → no colgar el turno: refresco completo en background (fire-and-forget). La
            // reanudación proactiva ("ya te respondo cuando termine") es el incremento 2 (turnos proactivos).
            void ctx.repoSync.sync({ owner, repo }).catch(() => {})
            return done(
              true,
              `Mi copia de ${owner}/${repo} está bastante atrás; la estoy poniendo al día en segundo plano. Por ahora te respondo con lo que tengo.`
            )
          }
          const output =
            r.mode === "skipped-fresh"
              ? `Ya estaba al día con ${owner}/${repo}.`
              : `Actualicé mi copia de ${owner}/${repo}: ${r.embedded} archivo(s) nuevos/cambiados, ${r.deleted} borrado(s).`
          return done(true, output)
        } catch {
          return done(false, "No pude sincronizar ahora mismo.")
        }
      },
    })
  },
}
