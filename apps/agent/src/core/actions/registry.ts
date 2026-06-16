// Registry del HARNESS: arma el ToolSet para streamText con GATING DE 2 CAPAS.
//   (1) canal OCULTA   → name ∉ caps.allowedTools ⇒ la tool ni se expone al modelo.
//   (2) principal DENIEGA → no cumple clearance ⇒ se expone, pero su execute deniega limpio
//        con traza (seam HITL DELGADO: punto de decisión, sin maquinaria async).
// Sumar una acción = nuevo ActionDescriptor + listarlo en ACTIONS.

import { type Tool, type ToolSet, tool } from "ai"
import { z } from "zod"
import { checkRepoFreshness } from "./check-repo-freshness.js"
import { escalate } from "./escalate.js"
import { findRepos } from "./find-repos.js"
import { learnRepo } from "./learn-repo.js"
import { recentActivity } from "./recent-activity.js"
import { rememberFact } from "./remember-fact.js"
import { resolveFact } from "./resolve-fact.js"
import { searchMemory } from "./search-memory.js"
import type { ActionContext, ActionDescriptor } from "./types.js"

/** Único lugar donde se listan las acciones que el harness sabe construir. */
export const ACTIONS: ActionDescriptor[] = [
  searchMemory,
  rememberFact,
  resolveFact,
  checkRepoFreshness,
  learnRepo,
  findRepos,
  recentActivity,
  escalate,
]

/** ¿El principal cumple el clearance de la acción? */
function meetsClearance(
  clearance: ActionDescriptor["clearance"],
  principal: ActionContext["principal"]
): boolean {
  if (clearance === "anyone") return true
  return principal.trusted // "owner"
}

/** Punto de decisión del seam HITL (delgado): NO ejecuta la acción; emite traza de denegación
 *  (`ok:false, denied:true`) y devuelve cortesía. Nunca throw (invariante "siempre responde"). */
function deniedTool(d: ActionDescriptor, ctx: ActionContext): Tool {
  return tool({
    description: "Acción no disponible en este contexto.",
    inputSchema: z.object({}).passthrough(),
    execute: async (_input, { toolCallId }) => {
      const output =
        "No puedo ejecutar esa acción en este canal o para este interlocutor."
      ctx.emit({
        ...ctx.ids,
        type: "tool.result",
        toolCallId,
        toolName: d.name,
        ok: false,
        denied: true,
        output,
      })
      return output
    },
  })
}

/** Construye el ToolSet para `streamText` aplicando el gating de 2 capas. `actions` es inyectable
 *  para tests (deny path sin write-actions reales); en prod siempre usa `ACTIONS`. */
export function buildTools(
  ctx: ActionContext,
  actions: ActionDescriptor[] = ACTIONS
): ToolSet {
  const tools: ToolSet = {}
  for (const d of actions) {
    if (!ctx.caps.allowedTools.includes(d.name)) continue // capa 1: canal oculta
    tools[d.name] = meetsClearance(d.clearance, ctx.principal)
      ? d.build(ctx) // permitido
      : deniedTool(d, ctx) // capa 2: principal deniega (seam HITL)
  }
  return tools
}
