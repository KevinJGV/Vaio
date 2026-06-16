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

/** Estado de "disponibilidad" de un repo NOMBRADO por el usuario (no solo frescura: también COBERTURA).
 *  `incomplete` = trackeado y SHA-fresh pero le faltan archivos (cap-bajo); el sistema lo completa solo. */
export interface RepoReadiness {
  state: "fresh" | "stale" | "incomplete" | "untracked"
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
  /** Freshness GATE (determinístico, con TTL interno): por cada source `repo:owner/repo`, si no se chequeó dentro
   *  del TTL, verifica frescura y, si está stale, dispara el sync en BACKGROUND (nunca inline → no bloquea el turno).
   *  Los sources que no sean `repo:*` se ignoran. Devuelve `refreshed` (true solo si algo se aplicó INLINE → hoy
   *  siempre false) y `behind` (true si algún repo recuperado estaba ATRÁS y se está actualizando en background →
   *  el turno responde con el índice pre-sync; searchMemory lo surfacea para que el modelo lo flaggee). Nunca tira. */
  ensureFresh(
    sources: string[]
  ): Promise<{ refreshed: boolean; behind?: boolean }>
  /** Para un repo NOMBRADO por el usuario: clasifica su estado y DISPARA la acción derivada (Inv #9) —
   *  `incomplete` → re-index FULL en background; `stale` → sync incremental en background; `fresh`/`untracked`
   *  → no-op. Chequea COBERTURA (árbol vs indexado) además de frescura (SHA), porque un repo cap-bajo es
   *  SHA-fresh pero le faltan archivos y nunca se completaría por `ensureFresh`. TTL-gated (comparte el gate
   *  de `ensureFresh`: un repo recién sondeado no se rechequea). best-effort: nunca tira (error → `fresh`). */
  ensureRepoReady(spec: RepoSyncSpec): Promise<RepoReadiness>
}
