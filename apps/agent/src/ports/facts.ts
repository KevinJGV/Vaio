// Puerto de la memoria de HECHOS curados (write + listado de pendientes). El core depende de esta
// interfaz; el adapter Neon (adapters/neon-facts) embebe e implementa contra pgvector.

/** Una propuesta de hecho pendiente de confirmación (para retomarla en el prompt). */
export interface PendingFact {
  id: string
  statement: string
  createdAt: Date | null
}

export interface FactStore {
  /** Registra una propuesta (status pending, sin embedding). Devuelve su id. */
  propose(input: {
    statement: string
    principalId: string
    channel: string
    conversationId?: string
    turnId?: string
  }): Promise<{ id: string }>
  /** Confirma una propuesta pendiente: embebe statement → confirmed, validAt=now.
   *  false si el id no existe o no está pending (idempotente). */
  commit(id: string): Promise<boolean>
  /** Rechaza una propuesta pendiente. false si no existe/no pending. */
  reject(id: string): Promise<boolean>
  /** Propuestas pendientes de un principal (más recientes primero). */
  listPending(principalId: string, limit?: number): Promise<PendingFact[]>
}
