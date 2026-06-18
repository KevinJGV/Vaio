// Puerto de la memoria de HECHOS curados (write + listado de pendientes). El core depende de esta
// interfaz; el adapter Neon (adapters/neon-facts) embebe e implementa contra pgvector.

/** Una propuesta de hecho pendiente de confirmación (para retomarla en el prompt). `conflicts` = facts
 *  confirmados cercanos (recomputados con el embedding guardado) → el turno de confirmación tiene los ids para
 *  pasar a `supersedes` (el modelo decide si REALMENTE se contradicen). */
export interface PendingFact {
  id: string
  statement: string
  createdAt: Date | null
  conflicts: ConflictCandidate[]
}

/** Un hecho confirmado vigente que el nuevo PODRÍA estar contradiciendo (cercanía vectorial; el modelo decide
 *  si realmente choca). Se le presenta a Vaio al proponer para que pueda ofrecer reemplazarlo. */
export interface ConflictCandidate {
  id: string
  statement: string
  validAt: Date | null
}

export interface FactStore {
  /** Registra una propuesta (status pending). Embebe el statement (para detectar conflictos) y devuelve su id
   *  + los facts confirmados cercanos (candidatos a reemplazar). Si el embed falla → `conflicts: []`. */
  propose(input: {
    statement: string
    principalId: string
    channel: string
    conversationId?: string
    turnId?: string
  }): Promise<{ id: string; conflicts: ConflictCandidate[] }>
  /** Confirma una propuesta pendiente → confirmed, validAt=now. `opts.supersedes` = ids de facts vigentes que
   *  este reemplaza: se invalidan (invalidAt=now, bi-temporal) y se guarda el linaje en `supersedes`.
   *  false si el id no existe o no está pending (idempotente). */
  commit(id: string, opts?: { supersedes?: string[] }): Promise<boolean>
  /** Rechaza una propuesta pendiente. false si no existe/no pending. */
  reject(id: string): Promise<boolean>
  /** Propuestas pendientes de un principal (más recientes primero). */
  listPending(principalId: string, limit?: number): Promise<PendingFact[]>
  /** Desaprende un fact CONFIRMADO vigente: invalidAt=now, expiredAt=now, decidedAt=now; SIN supersede.
   *  Reversible/auditable (la fila queda). false si no existe o no está confirmed-vigente (idempotente). */
  invalidate(id: string): Promise<boolean>
  /** Facts CONFIRMADOS vigentes de un principal, los más cercanos por coseno a `query` (para desaprender por
   *  similitud → el owner los ve por ordinal, Inv #8). best-effort: embed falla → []. */
  findConfirmedNear(
    query: string,
    principalId: string,
    opts?: { limit?: number; maxDistance?: number }
  ): Promise<ConflictCandidate[]>
}
