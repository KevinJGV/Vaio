// Contratos del HARNESS de acciones. Una "acción" es una tool del agente descrita por un
// `ActionDescriptor` (metadata de gating + cómo construir la tool del AI SDK). El registry
// (core/actions/registry) arma el ToolSet aplicando el gating de 2 capas. PURO (sin I/O):
// el core depende de puertos, nunca de adapters.

import type { TraceEvent } from "@vaio/contracts"
import type { Tool } from "ai"
import type { Compressor, Intensity } from "../../ports/compress.js"
import type { FactStore } from "../../ports/facts.js"
import type { Logger } from "../../ports/logger.js"
import type { MemoryStore } from "../../ports/memory.js"
import type { Reranker } from "../../ports/rerank.js"
import type { CapabilityProfile, Principal, ToolName } from "../capabilities.js"

/** Ids base de traza del turno (se esparcen en cada evento emitido por una acción). */
export interface TraceIds {
  requestId: string
  turnId: string
  conversationId?: string
}

/** Quién (principal) puede invocar la acción. Hoy binario, alineado con `Principal.trusted`
 *  (seam para RBAC por-rol a futuro). */
export type Clearance = "anyone" | "owner"

/** Contexto del turno inyectado a cada acción (puertos + identidad + traza). */
export interface ActionContext {
  caps: CapabilityProfile
  /** Identidad del actor; habilita el gating por principal (capa 2 / seam HITL). */
  principal: Principal
  memory: MemoryStore | null
  emit: (e: TraceEvent) => void
  ids: TraceIds
  logger: Logger
  /** Tier 1: comprime los chunks de RAG antes de inyectarlos al modelo. null = sin comprimir. */
  compressor?: Compressor | null
  ragIntensity?: Intensity
  /** Memoria de hechos curados (write-actions). null = sin DB → las acciones degradan. */
  factStore?: FactStore | null
  /** Rerank de la 2ª etapa del RAG. null = sin rerank → searchMemory cae a vector top-K. */
  reranker?: Reranker | null
  /** Pool de candidatos (wide-K) a recuperar por vector antes de rerankear. Default 30. */
  rerankCandidates?: number
}

/** Descriptor de una acción: metadata de gating + cómo construir su tool del AI SDK.
 *  Sumar una acción = nuevo archivo con su `ActionDescriptor` + listarlo en `ACTIONS` (registry). */
export interface ActionDescriptor {
  name: ToolName
  /** Marca write-actions (efecto fuera de la conversación). Hoy todas false. */
  sideEffecting: boolean
  /** Principal mínimo que puede invocarla. `searchMemory` = "anyone". */
  clearance: Clearance
  /** Construye la `tool()` del AI SDK con el contexto del turno; encapsula
   *  description + inputSchema + execute (typing por-tool intacto adentro). */
  build(ctx: ActionContext): Tool
}
