// searchMemory: RAG sobre la memoria del producto (read-only, clearance "anyone"), con `k`
// acotado por el perfil del canal. El contexto recuperado va al modelo VERBATIM (no se comprime:
// comprimir RAG mutilaba el grounding por un ahorro marginal — ver el comentario en `output`).

import { tool } from "ai"
import { z } from "zod"
import type { DocChunk } from "../../ports/memory.js"
import { errMsg } from "../util.js"
import type { ActionContext, ActionDescriptor } from "./types.js"

export const searchMemory: ActionDescriptor = {
  name: "searchMemory",
  sideEffecting: false,
  clearance: "anyone",
  build(ctx: ActionContext) {
    const {
      memory,
      emit,
      ids,
      logger,
      reranker = null,
      rerankCandidates = 30,
      factRetrieveMax = 4,
      factRetrieveDistance = 0.7,
    } = ctx
    const k = ctx.caps.memoryScope.maxK
    return tool({
      description:
        "Memoria de Kevin (sus datos reales: bio/origen, stack, proyectos (GitHub), gustos (música), contacto) Y tu propio código/arquitectura (el repo público de Vaio): cómo estás construido, tus módulos, decisiones de diseño. Úsala cuando la respuesta dependa de un hecho concreto de Kevin o de cómo funcionás vos; no para saludos ni charla.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("Consulta de búsqueda semántica, en lenguaje natural."),
      }),
      execute: async ({ query }, { toolCallId }) => {
        const t0 = Date.now()
        if (!memory) {
          const output = "La memoria todavía no está configurada."
          emit({
            ...ids,
            type: "tool.result",
            toolCallId,
            toolName: "searchMemory",
            ok: false,
            hits: 0,
            latencyMs: Date.now() - t0,
            output,
          })
          return output
        }
        try {
          // 2ª etapa del RAG: si hay reranker, recuperar un K ANCHO por vector → rerankear → recortar al
          // top-K del canal. Degrada SIEMPRE (Invariante #1): sin reranker, o si devuelve [], o si no hay
          // candidatos → vector top-K como antes. El reranker nunca tira (devuelve [] ante fallo).
          // Recuperación (vector wide-K → rerank → trim). Extraída para poder re-recuperar tras el freshness gate.
          const retrieve = async (): Promise<DocChunk[]> => {
            if (!reranker) return memory.searchMemory(query, k)
            const cands = await memory.searchMemory(query, rerankCandidates)
            if (cands.length === 0) return []
            const ranked = await reranker.rerank(
              query,
              cands.map((c) => c.chunk),
              k
            )
            return ranked.length > 0
              ? ranked
                  .map((r) => cands[r.index])
                  .filter((d): d is (typeof cands)[number] => d != null)
              : cands.slice(0, k)
          }

          // FACTS curados: tan importantes como los repos para la naturalidad → se recuperan SIEMPRE aparte
          // (no compiten con los chunks del repo) y se ANTEPONEN al contexto. Degrada si el store no los soporta.
          const facts = memory.searchFacts
            ? await memory.searchFacts(query, {
                k: factRetrieveMax,
                maxDistance: factRetrieveDistance,
              })
            : []
          const docs = await retrieve()
          // Facts PRIMERO (verdad curada que lidera el contexto), luego los docs del repo.
          // El contexto recuperado va al modelo CRUDO (verbatim): NO se comprime. Comprimir RAG
          // mutilaba la fidelidad de grounding (prosa perdía artículos: 'le gusta el fútbol'→'le
          // gusta fútbol'; el código del repo perdía espacios/operadores: 'a ?? b'→'a?? b') a cambio
          // de un ahorro marginal (~3.5%, no es la palanca de costo). Ver LEARNINGS.md.
          const combined = [...facts, ...docs]
          const body =
            combined.length === 0
              ? "Sin resultados relevantes en memoria."
              : combined
                  .map(
                    (d) =>
                      `[${d.source}${d.url ? ` · ${d.url}` : ""}]\n${d.chunk}`
                  )
                  .join("\n\n")
          // CAPA DE COMPLEMENTO: searchMemory trae el CONTENIDO; los DETECTORES emiten SEÑALES de disponibilidad
          // (repo:* atrás → FreshnessDetector; repo del owner sin indexar → UnindexedRepoDetector) como notas del
          // sistema que se anteponen. El sistema detecta+informa; el modelo lee y acciona (Invariante #9).
          // Best-effort: un fallo de detección nunca rompe la respuesta. Ver knowledge-detectors-design.md.
          let notes: string[] = []
          if (ctx.detectors) {
            try {
              notes = await ctx.detectors.run({
                query,
                retrieved: combined.map((d) => ({
                  source: d.source,
                  chunk: d.chunk,
                })),
              })
            } catch (err) {
              logger.warn(
                { err: errMsg(err) },
                "detectores fallaron (se ignora)"
              )
            }
          }
          const output = notes.length ? `${notes.join("\n")}\n\n${body}` : body
          emit({
            ...ids,
            type: "tool.result",
            toolCallId,
            toolName: "searchMemory",
            ok: true,
            hits: combined.length,
            latencyMs: Date.now() - t0,
            output,
          })
          return output
        } catch (err) {
          logger.error({ err: errMsg(err) }, "searchMemory falló")
          emit({
            ...ids,
            type: "tool.result",
            toolCallId,
            toolName: "searchMemory",
            ok: false,
            hits: 0,
            latencyMs: Date.now() - t0,
            output: errMsg(err),
          })
          return "La memoria no está disponible ahora mismo."
        }
      },
    })
  },
}
