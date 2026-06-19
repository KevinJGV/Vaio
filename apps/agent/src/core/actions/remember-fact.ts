// rememberFact — guarda hechos durables sobre Kevin (owner-only). Invariante #8 (el modelo solo pasa lenguaje
// natural; el sistema gestiona ids/embeddings). Flujo (cluster ciclo-de-vida del fact):
//  1. DESCOMPONE el texto en facts ATÓMICOS mono-idea (el juez opera sobre unidades limpias, no vectores difusos).
//  2. Por cada átomo: propose → si no hay cercanos, commit. Si hay, el JUEZ decide la relación:
//       - todo coexiste/aditivo → commit (el juez limpia el ruido: «pasta» vs «fútbol» ya no molesta).
//       - duplicado (sin contradicción) → reject (ya lo tenía).
//       - contradice/dudoso → lo deja PENDIENTE (HITL): se resuelve por resolveFact (el owner está en el loop).

import { tool } from "ai"
import { z } from "zod"
import type { ConflictVerdict } from "../../ports/conflict-judge.js"
import type { ConflictCandidate } from "../../ports/facts.js"
import type { ActionContext, ActionDescriptor } from "./types.js"

type AtomOutcome =
  | { kind: "learned"; statement: string }
  | { kind: "dedup"; statement: string }
  | {
      kind: "pending"
      statement: string
      contradicts: { ordinal: number; statement: string }[]
    }
  | { kind: "error"; statement: string }

export const rememberFact: ActionDescriptor = {
  name: "rememberFact",
  sideEffecting: true,
  clearance: "owner",
  build(ctx: ActionContext) {
    return tool({
      description:
        "Guarda HECHOS nuevos y durables sobre Kevin (preferencia, dato de vida, cambio de stack…) que surgieron " +
        "en la charla. Lo separo en ideas y guardo solo las que valen; si una no choca con nada la guardo sola " +
        "(sin confirmación), si choca con un hecho previo la dejo pendiente y te aviso para que le preguntes al " +
        "usuario. Solo datos que valga la pena recordar a futuro; no para charla pasajera.",
      inputSchema: z.object({
        statement: z
          .string()
          .min(1)
          .describe(
            "El/los hecho(s), en lenguaje natural sobre Kevin. Podés pasar varias ideas; yo las separo."
          ),
      }),
      execute: async ({ statement }, { toolCallId }) => {
        const t0 = Date.now()
        const emit = (ok: boolean, output: string): string => {
          ctx.emit({
            ...ctx.ids,
            type: "tool.result",
            toolCallId,
            toolName: "rememberFact",
            ok,
            latencyMs: Date.now() - t0,
            output,
          })
          return output
        }
        if (!ctx.factStore) {
          return emit(
            false,
            "No puedo guardar hechos ahora mismo (memoria no configurada)."
          )
        }
        const factStore = ctx.factStore
        // El fact se REDACTA en el idioma CANÓNICO (no el de la conversación) → memoria consistente en un idioma
        // (dedup/juez/retrieval). El embedder multilingüe casa queries de cualquier idioma; el modelo lo conversa
        // en el idioma del usuario al responder.
        const locale = ctx.factCanonicalLocale === "en" ? "en" : "es"

        // 1. Descomponer en átomos mono-idea (degrada al statement crudo si no hay decomposer).
        let atoms: string[]
        if (ctx.factDecomposer) {
          try {
            const r = await ctx.factDecomposer.decompose({
              rawText: statement,
              locale,
            })
            atoms = r.statements
          } catch {
            atoms = [statement]
          }
        } else {
          atoms = [statement]
        }
        if (atoms.length === 0) {
          return emit(
            true,
            "No vi un dato durable para guardar (o era algo sensible que no conviene memorizar)."
          )
        }

        // 2. Procesar cada átomo: propose → juez → commit/reject/pending.
        const processAtom = async (atom: string): Promise<AtomOutcome> => {
          try {
            const { id, conflicts } = await factStore.propose({
              statement: atom,
              principalId: ctx.principal.id,
              channel: ctx.principal.channel,
              conversationId: ctx.ids.conversationId,
              turnId: ctx.ids.turnId,
            })
            if (conflicts.length === 0) {
              await factStore.commit(id)
              return { kind: "learned", statement: atom }
            }
            const numbered = conflicts.map(
              (c: ConflictCandidate, i: number) => ({
                ordinal: i,
                statement: c.statement,
              })
            )
            // Sin juez → conservador: dejar pendiente con todos los cercanos (comportamiento previo).
            if (!ctx.conflictJudge) {
              return { kind: "pending", statement: atom, contradicts: numbered }
            }
            const { decisions } = await ctx.conflictJudge.judge({
              rawText: statement,
              statement: atom,
              candidates: numbered,
              locale,
            })
            const verdictOf = new Map<number, ConflictVerdict>(
              decisions.map((d) => [d.ordinal, d.verdict])
            )
            // contradice/dudoso → HITL; duplicado → dedup; el resto coexiste.
            const contradicts = numbered.filter((c) => {
              const v = verdictOf.get(c.ordinal) ?? "coexists"
              return v === "contradicts" || v === "unsure"
            })
            if (contradicts.length > 0) {
              return { kind: "pending", statement: atom, contradicts }
            }
            const anyDuplicate = decisions.some(
              (d) => d.verdict === "duplicate"
            )
            if (anyDuplicate) {
              await factStore.reject(id)
              return { kind: "dedup", statement: atom }
            }
            await factStore.commit(id)
            return { kind: "learned", statement: atom }
          } catch {
            return { kind: "error", statement: atom }
          }
        }

        const outcomes: AtomOutcome[] = []
        for (const atom of atoms) outcomes.push(await processAtom(atom))

        // 3. Componer el feedback (intención al modelo; el sistema ya ejecutó lo seguro).
        const learned = outcomes.filter((o) => o.kind === "learned")
        const dedup = outcomes.filter((o) => o.kind === "dedup")
        const pending = outcomes.filter(
          (o): o is Extract<AtomOutcome, { kind: "pending" }> =>
            o.kind === "pending"
        )
        const errored = outcomes.filter((o) => o.kind === "error")

        const lines: string[] = []
        if (learned.length > 0) {
          lines.push(
            `Guardé: ${learned.map((o) => `«${o.statement}»`).join(", ")}.`
          )
        }
        if (dedup.length > 0) {
          lines.push(
            `Ya lo tenía: ${dedup.map((o) => `«${o.statement}»`).join(", ")}.`
          )
        }
        if (pending.length > 0) {
          for (const p of pending) {
            const list = p.contradicts
              .map((c) => `  [${c.ordinal}] «${c.statement}»`)
              .join("\n")
            lines.push(
              `Dejé pendiente «${p.statement}» porque podría contradecir:\n${list}`
            )
          }
          lines.push(
            "Preguntale al usuario si REEMPLAZA esos hechos. Cuando responda: reemplazar → " +
              "resolveFact(decision:confirm, replaces:[esos números], which:N); si conviven → " +
              "resolveFact(decision:confirm); si lo descarta → resolveFact(decision:reject). " +
              "(which 0 = la propuesta más reciente.)"
          )
        }
        if (errored.length > 0 && lines.length === 0) {
          return emit(false, "No pude registrar el hecho ahora mismo.")
        }
        if (lines.length === 0) {
          return emit(true, "No vi nada nuevo para guardar.")
        }
        return emit(true, lines.join("\n"))
      },
    })
  },
}
