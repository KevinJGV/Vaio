// findRepos: lista los repos PÚBLICOS de Kevin filtrando por metadata (lenguaje y/o topic). Read, clearance
// "anyone" (metadata de repos públicos = pública → todos los canales). Es la ÚNICA tool de "consultar mis repos":
// EXTENSIBLE por params (mañana filtros de estado: CI/PRs/deploy) en vez de tools nuevas (filosofía anti-tool-bloat).
//
// ⚓ INVARIANTE #8: el modelo pasa language/topic (strings de BAJA CARDINALIDAD); el sistema los VALIDA contra los
// valores REALES del catálogo → FALLO VISIBLE si no existen (lista los disponibles). #9: UNA intención (consultar
// repos), no un god-tool. #1: degrada limpio si no hay catálogo.

import { tool } from "ai"
import { z } from "zod"
import { groupPRsByRepo, type OpenPR } from "../repo-activity.js"
import { filterRepos } from "../repo-filter.js"
import type { OwnerRepo } from "../repo-resolve.js"
import type { ActionContext, ActionDescriptor } from "./types.js"

const MAX_LIST = 30
/** Máximo de PRs a listar por repo en el enriquecido (no inundar el contexto). */
const MAX_PRS_PER_REPO = 5

/** Línea de un repo en el output: `• name [lang] — desc`. */
function repoLine(r: OwnerRepo, owner: string): string {
  return `• ${r.name}${r.language ? ` [${r.language}]` : ""}${r.description ? ` — ${r.description}` : ""} (https://github.com/${owner}/${r.name})`
}

/** Línea enriquecida con los PRs abiertos del repo: `• name [lang] — N PR(s) sin mergear: #12 "t", …`. */
function repoLineWithPRs(r: OwnerRepo, owner: string, prs: OpenPR[]): string {
  const shown = prs
    .slice(0, MAX_PRS_PER_REPO)
    .map((p) => `#${p.number} "${p.title}"`)
    .join(", ")
  const more =
    prs.length > MAX_PRS_PER_REPO
      ? ` (+${prs.length - MAX_PRS_PER_REPO} más)`
      : ""
  return `• ${r.name}${r.language ? ` [${r.language}]` : ""} — ${prs.length} PR(s) sin mergear: ${shown}${more} (https://github.com/${owner}/${r.name})`
}

export const findRepos: ActionDescriptor = {
  name: "findRepos",
  sideEffecting: false,
  clearance: "anyone",
  build(ctx: ActionContext) {
    return tool({
      description:
        "Listá los repos PÚBLICOS de Kevin filtrando por lenguaje, topic y/o por PRs sin mergear (consultas tipo '¿qué proyectos tiene en [lenguaje]?', 'repos con cierto topic', '¿qué repos tienen PRs sin mergear?'). Sin filtros, lista todos. Devuelve nombre + descripción + lenguaje + URL (+ los PRs abiertos si filtrás por hasOpenPRs).",
      inputSchema: z.object({
        language: z
          .string()
          .optional()
          .describe(
            "Lenguaje de programación por el que filtrar (el nombre del lenguaje)."
          ),
        topic: z.string().optional().describe("Topic/tema del repo."),
        hasOpenPRs: z
          .boolean()
          .optional()
          .describe(
            "Filtrar a los repos con PRs sin mergear (abiertos); enriquece cada uno con sus PRs."
          ),
      }),
      execute: async ({ language, topic, hasOpenPRs }, { toolCallId }) => {
        const t0 = Date.now()
        const done = (ok: boolean, output: string) => {
          ctx.emit({
            ...ctx.ids,
            type: "tool.result",
            toolCallId,
            toolName: "findRepos",
            ok,
            latencyMs: Date.now() - t0,
            output,
          })
          return output
        }
        if (!ctx.ownerRepos) {
          return done(false, "No puedo consultar tus repos ahora mismo.")
        }
        const repos = await ctx.ownerRepos.listPublic()
        if (repos.length === 0) {
          return done(false, "No pude consultar tus repos ahora mismo.")
        }
        const res = filterRepos(repos, { language, topic })
        // Fallo VISIBLE: el filtro no corresponde a ningún valor real (Invariante #8).
        if (res.unknownLanguage) {
          return done(
            true,
            `No tenés repos públicos en "${res.unknownLanguage}". Tus lenguajes: ${res.availableLanguages.join(", ") || "(ninguno)"}.`
          )
        }
        if (res.unknownTopic) {
          const ts = res.availableTopics.slice(0, MAX_LIST).join(", ")
          return done(
            true,
            `No tenés repos públicos con el topic "${res.unknownTopic}". Topics disponibles: ${ts || "(ninguno)"}.`
          )
        }
        if (res.matched.length === 0) {
          return done(true, "No encontré repos con esos filtros.")
        }
        const owner = ctx.ownerUser ?? ""
        const filt = [
          language ? `en ${language}` : "",
          topic ? `con topic ${topic}` : "",
        ]
          .filter(Boolean)
          .join(" ")

        // Filtro VIVO: PRs sin mergear. Camino que suma 1 llamada (Search API) SOLO cuando se pide.
        if (hasOpenPRs) {
          const prs = await ctx.repoActivity?.openPullRequests()
          if (prs == null) {
            return done(true, "No pude consultar el estado de PRs ahora.")
          }
          const byRepo = groupPRsByRepo(prs)
          // Intersección con el catálogo público (res.matched) = guard de privacidad: un repo privado no está acá.
          const withPRs = res.matched.filter((r) => byRepo.has(r.name))
          if (withPRs.length === 0) {
            return done(
              true,
              `No tenés PRs sin mergear${filt ? ` (${filt})` : ""}.`
            )
          }
          const list = withPRs
            .slice(0, MAX_LIST)
            .map((r) => repoLineWithPRs(r, owner, byRepo.get(r.name) ?? []))
            .join("\n")
          return done(
            true,
            `Repos de Kevin con PRs sin mergear${filt ? ` ${filt}` : ""}:\n${list}`
          )
        }

        const list = res.matched
          .slice(0, MAX_LIST)
          .map((r) => repoLine(r, owner))
          .join("\n")
        return done(
          true,
          `Repos públicos de Kevin${filt ? ` ${filt}` : ""}:\n${list}`
        )
      },
    })
  },
}
