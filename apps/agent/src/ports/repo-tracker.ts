// Puerto del estado de sync por repo (frescura). El core/orquestador depende de esta interfaz; el adapter
// (adapters/neon-tracker) la implementa sobre la tabla `tracked_repos`. Separado de MemoryStore porque es
// estado por-repo (1 fila), no memoria RAG.

/** Estado persistido de un repo trackeado (para frescura + observabilidad del sync). */
export interface TrackedRepo {
  source: string // 'repo:owner/repo'
  owner: string
  repo: string
  branch: string
  /** HEAD del branch en el último sync OK → comparación de frescura. null = nunca sincronizado. */
  lastCommitSha: string | null
  lastTreeSha: string | null
  /** Si cambian los chunkers/policy, bump → fuerza full (el blob-SHA no cambiaría pero los chunks sí). */
  policyVersion: number
  /** Archivos DESCARTADOS al sincronizar (secret/no-texto) con su blob_sha (tombstones). Sin esto, el diff los
   *  re-intentaría en cada sync (no tienen chunks en `documents`). Opcional/ausente → []. */
  skipped?: { path: string; blobSha: string }[]
}

export interface RepoTracker {
  get(source: string): Promise<TrackedRepo | null>
  upsert(
    rec: TrackedRepo & { status: string; embedded: number; deleted: number }
  ): Promise<void>
}
