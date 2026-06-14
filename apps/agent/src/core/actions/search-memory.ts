// searchMemory: RAG sobre la memoria del producto (read-only, clearance "anyone"), con `k`
// acotado por el perfil del canal. Migrado desde el viejo core/tools.ts SIN cambio de
// comportamiento: misma description, inputSchema, compresión Tier 1 y trazas tool.result.

import { tool } from "ai"
import { z } from "zod"
import type { DocChunk } from "../../ports/memory.js"
import { compressOrRaw, errMsg } from "../util.js"
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
      compressor = null,
      ragIntensity = "full",
      reranker = null,
      rerankCandidates = 30,
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
          let docs: DocChunk[]
          if (reranker) {
            const cands = await memory.searchMemory(query, rerankCandidates)
            if (cands.length === 0) {
              docs = []
            } else {
              const ranked = await reranker.rerank(
                query,
                cands.map((c) => c.chunk),
                k
              )
              docs =
                ranked.length > 0
                  ? ranked
                      .map((r) => cands[r.index])
                      .filter((d): d is (typeof cands)[number] => d != null)
                  : cands.slice(0, k)
            }
          } else {
            docs = await memory.searchMemory(query, k)
          }
          const output =
            docs.length === 0
              ? "Sin resultados relevantes en memoria."
              : docs
                  .map(
                    (d) =>
                      `[${d.source}${d.url ? ` · ${d.url}` : ""}]\n${compressOrRaw(compressor, d.chunk, ragIntensity)}`
                  )
                  .join("\n\n")
          // Métrica del ahorro Tier 1 sobre los chunks de RAG (el componente dominante,
          // `full`). Espeja el log de conversación en agent.ts para confirmar el ahorro en logs.
          if (compressor && docs.length > 0) {
            const before = docs.reduce(
              (n, d) => n + compressor.countTokens(d.chunk),
              0
            )
            const after = docs.reduce(
              (n, d) =>
                n +
                compressor.countTokens(
                  compressor.compress(d.chunk, ragIntensity)
                ),
              0
            )
            if (before > 0) {
              logger.debug(
                { before, after, saved: before - after, chunks: docs.length },
                "rag compressed"
              )
            }
          }
          emit({
            ...ids,
            type: "tool.result",
            toolCallId,
            toolName: "searchMemory",
            ok: true,
            hits: docs.length,
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
