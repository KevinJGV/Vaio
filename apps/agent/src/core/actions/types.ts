// Contratos del HARNESS de acciones. Una "acción" es una tool del agente descrita por un
// `ActionDescriptor` (metadata de gating + cómo construir la tool del AI SDK). El registry
// (core/actions/registry) arma el ToolSet aplicando el gating de 2 capas. PURO (sin I/O):
// el core depende de puertos, nunca de adapters.

import type { TraceEvent } from "@vaio/contracts"
import type { Tool } from "ai"
import type { Connector } from "../../ports/connector.js"
import type { FactStore } from "../../ports/facts.js"
import type { DetectorRegistry } from "../../ports/knowledge-detector.js"
import type { Logger } from "../../ports/logger.js"
import type { MemoryStore } from "../../ports/memory.js"
import type {
  OwnerRepoActivity,
  OwnerRepoCatalog,
} from "../../ports/owner-repos.js"
import type { RepoSyncPort, RepoSyncSpec } from "../../ports/repo-sync.js"
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
  /** Memoria de hechos curados (write-actions). null = sin DB → las acciones degradan. */
  factStore?: FactStore | null
  /** Rerank de la 2ª etapa del RAG. null = sin rerank → searchMemory cae a vector top-K. */
  reranker?: Reranker | null
  /** Pool de candidatos (wide-K) a recuperar por vector antes de rerankear. Default 30. */
  rerankCandidates?: number
  /** Facts curados a recuperar SIEMPRE (aparte de los docs) y anteponer al contexto. Default 4. */
  factRetrieveMax?: number
  /** Distancia coseno máx para que un fact cuente como relevante a la query. Default 0.7. */
  factRetrieveDistance?: number
  /** Sync de repos (frescura + sync incremental). null = sin DB/token → las tools de sync degradan. */
  repoSync?: RepoSyncPort | null
  /** Repos curados que Vaio conoce (de RAW_SOURCE_REPOS): el SET CERRADO que ofrece checkRepoFreshness como enum
   *  (Invariante #8: el modelo elige uno, no tipea owner/repo libre). Vacío → la tool de freshness degrada. */
  knownRepos?: RepoSyncSpec[]
  /** Conectores de actividad/estado en vivo (Last.fm, GitHub, …) para la tool recentActivity. */
  connectors?: Connector[]
  /** Catálogo de repos PÚBLICOS del owner (para resolver nombres en learnRepo). null = sin token/DB → degrada. */
  ownerRepos?: OwnerRepoCatalog | null
  /** Estado VIVO de los repos del owner (PRs abiertos, …) para los params vivos de findRepos. null = sin token → degrada. */
  repoActivity?: OwnerRepoActivity | null
  /** Owner de los repos (env GITHUB_USER): el sistema arma el spec con esto, NUNCA con un string del modelo. */
  ownerUser?: string
  /** Capa de COMPLEMENTO de la memoria: detectores que emiten señales de disponibilidad (notas del sistema)
   *  que searchMemory antepone a su output. null = sin detectores → solo contenido. */
  detectors?: DetectorRegistry | null
}

/** Descriptor de una acción: metadata de gating + cómo construir su tool del AI SDK.
 *  Sumar una acción = nuevo archivo con su `ActionDescriptor` + listarlo en `ACTIONS` (registry).
 *
 *  ⚓ INVARIANTE #8 (CLAUDE.md) — el modelo TRIGGEREA, el sistema gestiona los DATOS: el `inputSchema` de la
 *  tool expone SOLO intención (lenguaje natural) + opciones preestablecidas (enum / ordinal pequeño / boolean).
 *  NUNCA pidas que el modelo pase ids/uuids/objetos/arrays que el sistema pueda resolver determinísticamente
 *  (cache/persistencia) — los LLM fallan emitiendo estructuras. Excepción: datos de baja cardinalidad con fallo
 *  VISIBLE. Ej.: `resolveFact` toma ordinales y el sistema mapea ordinal→uuid; nunca el uuid directo. */
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
