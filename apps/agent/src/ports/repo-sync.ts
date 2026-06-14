// Puerto de sincronización de repos (frescura + sync incremental). Las tools del harness (core/actions)
// dependen de esta interfaz, NO del adapter; el wiring (index.ts) inyecta la implementación
// (adapters/sources/repo-sync) con sus deps (memory + tracker + token + policy) ya atadas.

export interface RepoSyncSpec {
  owner: string
  repo: string
  branch?: string
}

export interface RepoFreshness {
  state: "fresh" | "stale" | "untracked"
}

export interface RepoSyncResult {
  mode:
    | "full"
    | "incremental"
    | "skipped-fresh"
    | "partial"
    | "error"
    | "deferred"
  embedded: number
  deleted: number
  unchanged: number
}

export interface RepoSyncPort {
  /** Chequeo barato de frescura (1 request; untracked sin request). */
  freshness(spec: RepoSyncSpec): Promise<RepoFreshness>
  /** Sync incremental. `inlineMaxFiles` → si el diff incremental lo supera, devuelve `deferred` (no aplica nada). */
  sync(
    spec: RepoSyncSpec,
    opts?: { inlineMaxFiles?: number }
  ): Promise<RepoSyncResult>
  /** ¿El repo ya está trackeado? (los repos nuevos/arbitrarios se deniegan en parte 1). */
  isTracked(spec: RepoSyncSpec): Promise<boolean>
}
