// findRepos: lista los repos PÚBLICOS de Kevin filtrando por metadata (lenguaje y/o topic). Read, clearance
// "anyone" (metadata de repos públicos = pública → todos los canales). Es la ÚNICA tool de "consultar mis repos":
// EXTENSIBLE por params (mañana filtros de estado: CI/PRs/deploy) en vez de tools nuevas (filosofía anti-tool-bloat).
//
// ⚓ INVARIANTE #8: el modelo pasa language/topic (strings de BAJA CARDINALIDAD); el sistema los VALIDA contra los
// valores REALES del catálogo → FALLO VISIBLE si no existen (lista los disponibles). #9: UNA intención (consultar
// repos), no un god-tool. #1: degrada limpio si no hay catálogo.

import { tool } from "ai"
import { z } from "zod"
import { filterRepos } from "../repo-filter.js"
import type { ActionContext, ActionDescriptor } from "./types.js"

const MAX_LIST = 30

export const findRepos: ActionDescriptor = {
  name: "findRepos",
  sideEffecting: false,
  clearance: "anyone",
  build(ctx: ActionContext) {
    return tool({
      description:
        "Listá los repos PÚBLICOS de Kevin filtrando por lenguaje y/o topic (p.ej. '¿qué proyectos tiene en Java?', 'repos con topic X'). Sin filtros, lista todos. Devuelve nombre + descripción + lenguaje + URL.",
      inputSchema: z.object({
        language: z
          .string()
          .optional()
          .describe("Lenguaje de programación (p.ej. 'Java', 'TypeScript')."),
        topic: z.string().optional().describe("Topic/tema del repo."),
      }),
      execute: async ({ language, topic }, { toolCallId }) => {
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
        const list = res.matched
          .slice(0, MAX_LIST)
          .map(
            (r) =>
              `• ${r.name}${r.language ? ` [${r.language}]` : ""}${r.description ? ` — ${r.description}` : ""} (https://github.com/${owner}/${r.name})`
          )
          .join("\n")
        const filt = [
          language ? `en ${language}` : "",
          topic ? `con topic ${topic}` : "",
        ]
          .filter(Boolean)
          .join(" ")
        return done(
          true,
          `Repos públicos de Kevin${filt ? ` ${filt}` : ""}:\n${list}`
        )
      },
    })
  },
}
