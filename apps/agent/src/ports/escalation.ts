// Puerto de la memoria de ESCALACIONES: dudas que un visitante hizo y Vaio NO supo, escaladas a Kevin (owner)
// por su canal de notificación. Persiste para sobrevivir restarts (la espera humana tarda horas/días) y para
// CORRELACIONAR la respuesta de Kevin de forma determinística: Kevin responde CITANDO el DM, y el sistema casa por
// el message_id persistido — el modelo nunca toca ids (Inv #8). El core depende del puerto; el adapter es Drizzle+Neon.
// Ver docs/superpowers/specs/2026-06-16-escalate-owner-notifier-design.md.

/** Origen de la duda: a dónde retomar (si hay push) y a quién/qué canal adjudicar el cierre. */
export interface EscalationOrigin {
  channel: string // 'web' | 'telegram'
  conversationId?: string // conversations.id de origen (nullable: turno stateless)
  threadKey?: string // conversationKeyFor del visitante → reconstruye chatId/threadId
  askerPrincipalId: string // quién preguntó (telegram user id | "web")
  locale: string
}

/** Una escalada recuperada por la correlación reply-to, lista para retomar/cerrar. */
export interface AnsweredEscalation {
  id: string
  question: string
  origin: EscalationOrigin
}

export interface EscalationStore {
  /** Crea una escalada en estado 'pending'. Devuelve su id (el sistema lo gestiona; nunca el modelo). */
  create(input: {
    question: string
    origin: EscalationOrigin
  }): Promise<{ id: string }>
  /** Marca 'notified' y guarda por qué canal + message_id se avisó al owner (la clave de correlación). */
  markNotified(
    id: string,
    notifyChannel: string,
    notifyMessageId: string
  ): Promise<void>
  /** Marca 'failed' (el DM al owner no salió). El visitante igual recibió respuesta honesta. */
  markFailed(id: string): Promise<void>
  /** Correlación determinística: la escalada PENDIENTE (status 'notified') cuyo DM tiene ese message_id.
   *  null = ese reply no corresponde a ninguna escalada (mensaje normal de Kevin). NO muta. */
  findByNotifyMessage(
    notifyChannel: string,
    notifyMessageId: string
  ): Promise<AnsweredEscalation | null>
  /** Marca 'answered', guarda la respuesta + (opcional) el fact curado. UPDATE condicional
   *  (WHERE status='notified') → idempotente ante reintentos de webhook; devuelve si afectó filas. */
  markAnswered(id: string, answer: string, factId?: string): Promise<boolean>
  /** Anti-spam: cuántas escaladas sin resolver tiene este principal (pending|notified). */
  countOpenByPrincipal(principalId: string): Promise<number>
  /** Anti-spam (dedup): una escalada abierta del mismo principal con pregunta equivalente (normalizada).
   *  Dedup SEMÁNTICO = followup; v1 es por texto normalizado. null = no hay duplicado. */
  findOpenDuplicate(
    principalId: string,
    question: string
  ): Promise<{ id: string } | null>
}
