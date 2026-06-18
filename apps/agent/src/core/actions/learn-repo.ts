// learnRepo: ingesta ON-DEMAND de un repo PÚBLICO de Kevin que Vaio aún no tiene indexado (paso 3 parte 2 de
// "Vaio se nutre solo"). OWNER-ONLY, sideEffecting. Escenario conversacional: Kevin nombra un repo suyo → Vaio
// lo trae a su memoria en BACKGROUND para responder.
//
// ⚓ INVARIANTE #8 — el modelo pasa un NOMBRE (string de BAJA CARDINALIDAD) con FALLO VISIBLE: el sistema lo
// VALIDA contra los repos públicos REALES del owner (no confía en el string como id). Match claro → procede sin
// doble confirmación; ambiguo → desambigua; sin match → reporta sugerencias (nunca ingiere lo equivocado en
// silencio). El `owner` y el RepoSyncSpec los arma el SISTEMA (env GITHUB_USER), nunca el modelo. Es la excepción
// explícitamente permitida del #8 (baja cardinalidad + fallo visible).
//
// ⚓ INVARIANTE #9 — UNA tool auto-contenida: resuelve + dispara el sync en un solo execute (el sistema gestiona
// el sync en background; el modelo no orquesta). ⚓ #1 — toda rama responde; el sync va fire-and-forget (no bloquea).

import { tool } from "ai"
import { z } from "zod"
import { resolveRepoName } from "../repo-resolve.js"
import type { ActionContext, ActionDescriptor } from "./types.js"

export const learnRepo: ActionDescriptor = {
  name: "learnRepo",
  sideEffecting: true,
  clearance: "owner",
  build(ctx: ActionContext) {
    return tool({
      description:
        "Traé a tu memoria un repo PÚBLICO de Kevin que todavía no tenés indexado (cuando él menciona uno suyo y searchMemory no lo trae). Pasá solo el NOMBRE que dijo (no 'owner/'); el sistema lo valida contra sus repos públicos reales y lo ingiere en segundo plano. Si hay varios parecidos te los lista para desambiguar; si no existe, te avisa.",
      inputSchema: z.object({
        repo: z
          .string()
          .min(1)
          .describe(
            "El nombre del repo de Kevin que mencionó: solo el nombre del repo, sin el 'owner/' adelante."
          ),
      }),
      execute: async ({ repo }, { toolCallId }) => {
        const t0 = Date.now()
        const done = (ok: boolean, output: string) => {
          ctx.emit({
            ...ctx.ids,
            type: "tool.result",
            toolCallId,
            toolName: "learnRepo",
            ok,
            latencyMs: Date.now() - t0,
            output,
          })
          return output
        }
        if (!ctx.ownerRepos || !ctx.repoSync || !ctx.ownerUser) {
          return done(false, "No puedo aprender repos nuevos ahora mismo.")
        }
        const repos = await ctx.ownerRepos.listPublic()
        if (repos.length === 0) {
          return done(
            false,
            "No pude consultar tus repos ahora mismo; probá de nuevo en un rato."
          )
        }
        const res = resolveRepoName(repo, repos)
        if (res.kind === "ambiguous") {
          const names = res.candidates.map((c) => c.name).join(", ")
          return done(
            true,
            `Tengo varios repos tuyos que se parecen a "${repo}": ${names}. ¿Cuál es?`
          )
        }
        if (res.kind === "none") {
          const hint = res.suggestions.length
            ? ` ¿Quisiste decir: ${res.suggestions.join(", ")}?`
            : ""
          return done(
            true,
            `No te encuentro un repo público con un nombre como "${repo}".${hint}`
          )
        }
        // match: el sistema arma el spec con el owner del env (NUNCA del modelo).
        const spec = { owner: ctx.ownerUser, repo: res.repo.name }
        if (await ctx.repoSync.isTracked(spec)) {
          return done(
            true,
            `Ese ya lo tengo indexado (${res.repo.name}); preguntame directo sobre él.`
          )
        }
        // Ingest full en background, no bloquea el turno (Invariante #1). Turnos proactivos (Nivel C): si el
        // canal soporta push (Telegram), registramos la tarea para que Vaio RETOME solo al terminar y responda la
        // duda original (1er trigger user-waiting del seam `resume`). Sin push (web) → fire-and-forget como antes.
        const task = ctx.repoSync.sync(spec)
        if (ctx.resume) {
          ctx.resume.resume(task, { label: "learnRepo" })
          return done(
            true,
            `Dale, estoy trayendo ${res.repo.name} a mi memoria ahora (toma un momentito). En cuanto termine te retomo acá mismo con su contenido.`
          )
        }
        void task.catch(() => {}) // best-effort: el .catch traga un fallo de ingesta (ya respondimos).
        return done(
          true,
          `Dale, estoy trayendo ${res.repo.name} a mi memoria ahora (toma un momentito); preguntame de nuevo en un rato y ya lo tengo fresco.`
        )
      },
    })
  },
}
