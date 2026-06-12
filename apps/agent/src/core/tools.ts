// Arnés — registry de tools GATED por capacidad. Arma solo las tools que el CapabilityProfile
// habilita (hoy `searchMemory`). Sumar una acción futura = nuevo builder acá + listar su nombre
// en el perfil del canal (core/capabilities). El core (agent.ts) inyecta memory/emit/ids/logger.

import type { TraceEvent } from "@vaio/contracts"
import { type ToolSet, tool } from "ai"
import { z } from "zod"
import type { Logger } from "../ports/logger.js"
import type { MemoryStore } from "../ports/memory.js"
import type { CapabilityProfile } from "./capabilities.js"
import { errMsg } from "./util.js"

/** Ids base de traza del turno (se esparcen en cada evento emitido por una tool). */
export interface TraceIds {
  requestId: string
  turnId: string
  conversationId?: string
}

export interface ToolDeps {
  caps: CapabilityProfile
  memory: MemoryStore | null
  emit: (e: TraceEvent) => void
  ids: TraceIds
  logger: Logger
}

/** searchMemory: RAG sobre la memoria del producto, con `k` acotado por el perfil del canal. */
function searchMemoryTool({ caps, memory, emit, ids, logger }: ToolDeps) {
  const k = caps.memoryScope.maxK
  return tool({
    description:
      "Busca en la memoria de Kevin (CV, perfil, repos de GitHub, gustos musicales) los fragmentos más relevantes para responder con datos reales. Úsala SIEMPRE que la pregunta sea sobre Kevin.",
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
        const docs = await memory.searchMemory(query, k)
        const output =
          docs.length === 0
            ? "Sin resultados relevantes en memoria."
            : docs
                .map(
                  (d) =>
                    `[${d.source}${d.url ? ` · ${d.url}` : ""}]\n${d.chunk}`
                )
                .join("\n\n")
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
}

/** Construye el ToolSet para `streamText`, incluyendo SOLO las tools habilitadas por el perfil. */
export function buildTools(deps: ToolDeps): ToolSet {
  const tools: ToolSet = {}
  if (deps.caps.allowedTools.includes("searchMemory")) {
    tools.searchMemory = searchMemoryTool(deps)
  }
  return tools
}
