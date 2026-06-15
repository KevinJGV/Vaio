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
          let docs = await retrieve()
          // FRESHNESS GATE (determinístico, TTL interno): si los chunks vienen de un repo:* stale, sincronizar
          // ANTES de responder (no a criterio del modelo). Si algo se sincronizó inline → re-recuperar una vez.
          // Degrada SIEMPRE (Invariante #1): sin repoSync o ante error → responde con lo indexado.
          const repoSources = [
            ...new Set(
              docs.map((d) => d.source).filter((s) => s.startsWith("repo:"))
            ),
          ]
          if (repoSources.length > 0 && ctx.repoSync) {
            try {
              const { refreshed } = await ctx.repoSync.ensureFresh(repoSources)
              if (refreshed) docs = await retrieve()
            } catch (err) {
              logger.warn(
                { err: errMsg(err) },
                "freshness gate falló (se responde con lo indexado)"
              )
            }
          }
          // Facts PRIMERO (verdad curada que lidera el contexto), luego los docs del repo.
          const combined = [...facts, ...docs]
          const output =
            combined.length === 0
              ? "Sin resultados relevantes en memoria."
              : combined
                  .map(
                    (d) =>
                      `[${d.source}${d.url ? ` · ${d.url}` : ""}]\n${compressOrRaw(compressor, d.chunk, ragIntensity)}`
                  )
                  .join("\n\n")
          // Métrica del ahorro Tier 1 sobre los chunks de RAG (el componente dominante,
          // `full`). Espeja el log de conversación en agent.ts para confirmar el ahorro en logs.
          if (compressor && combined.length > 0) {
            const before = combined.reduce(
              (n, d) => n + compressor.countTokens(d.chunk),
              0
            )
            const after = combined.reduce(
              (n, d) =>
                n +
                compressor.countTokens(
                  compressor.compress(d.chunk, ragIntensity)
                ),
              0
            )
            if (before > 0) {
              logger.debug(
                {
                  before,
                  after,
                  saved: before - after,
                  chunks: combined.length,
                },
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
