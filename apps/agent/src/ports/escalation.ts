// Puerto de la memoria de ESCALACIONES: dudas que un visitante hizo y Vaio NO supo, escaladas a Kevin (owner)
// por su canal de notificación. Persiste para sobrevivir restarts (la espera humana tarda horas/días) y para
// CORRELACIONAR la respuesta de Kevin de forma determinística: Kevin responde CITANDO el DM, y el sistema casa por
// el message_id persistido — el modelo nunca toca ids (Inv #8). El core depende del puerto; el adapter es Drizzle+Neon.
// Ver docs/superpowers/specs/2026-06-16-escalate-owner-notifier-design.md.

/** Tipo de escalada → define el DEFAULT de curación (lo gestiona el sistema, no el modelo más allá del enum):
 *  knowledge=duda sobre un dato de Kevin (default: aprende) · contact=pedido de contacto/recado (default: no
 *  aprende) · claim=afirmación del visitante a validar (default: no aprende salvo que Kevin lo fuerce). Inv #8. */
export type EscalationKind = "knowledge" | "contact" | "claim"

/** Origen de la duda: a dónde retomar (si hay push) y a quién/qué canal adjudicar el cierre. */
export interface EscalationOrigin {
  channel: string // 'web' | 'telegram'
  conversationId?: string // conversations.id de origen (nullable: turno stateless)
  threadKey?: string // conversationKeyFor del visitante → reconstruye chatId/threadId
  askerPrincipalId: string // quién preguntó (telegram user id | "web")
  locale: string
}

/** Una escalada recuperada por la correlación, lista para retomar/cerrar/curar. */
export interface AnsweredEscalation {
  id: string
  question: string
  kind: EscalationKind
  origin: EscalationOrigin
}

/** Inc 2 — "hilo consciente de su razón": el contexto del ORIGEN de un hilo de escalada YA RESUELTA, para que
 *  Vaio lo lleve como nota de fondo cuando el owner sigue charlando en ese hilo (que ya NO correlaciona como
 *  pendiente). El `factId`/`statement` (del fact curado vía `linkFact`) habilitan el "ajustá/desaprendé ESO" por
 *  pronombre de forma determinística — el `factId` vive SOLO server-side, JAMÁS llega al modelo (Inv #8). */
export interface ThreadOrigin {
  /** La duda del visitante que originó la escalada. */
  question: string
  /** Lo que respondió el owner (Kevin) y cerró la escalada. */
  answer: string
  /** Statement del fact curado a partir de la respuesta (linkFact). Ausente si la curación no guardó nada. */
  statement?: string
  /** uuid del fact anclado — SOLO server-side (ancla del "desaprendé ESO"); nunca se expone al modelo (Inv #8). */
  factId?: string
  /** Origen del visitante que escaló — para retomarlo si el owner ACTUALIZA el dato (`updateVisitor`). Ausente
   *  si no es recuperable (p.ej. web stateless sin threadKey). El sistema resuelve el routing; el modelo no. */
  visitor?: {
    channel: string
    /** conversationKey con que se persistió el origen (Telegram: chatId[:threadId]; web: conversationId). */
    conversationKey: string
    locale: string
  }
}

export interface EscalationStore {
  /** Crea una escalada en estado 'pending'. Devuelve su id (el sistema lo gestiona; nunca el modelo). */
  create(input: {
    question: string
    kind: EscalationKind
    origin: EscalationOrigin
  }): Promise<{ id: string }>
  /** Marca 'notified' y guarda por qué canal + message_id + (opcional) topic del hilo se avisó al owner.
   *  Ambos son claves de correlación: el reply del owner casa por topic (responde EN el hilo) o por message_id. */
  markNotified(
    id: string,
    notifyChannel: string,
    notifyMessageId: string,
    notifyTopicId?: string
  ): Promise<void>
  /** Marca 'failed' (el DM al owner no salió). El visitante igual recibió respuesta honesta. */
  markFailed(id: string): Promise<void>
  /** Correlación determinística: la escalada PENDIENTE (status 'notified') cuyo DM tiene ese message_id.
   *  null = ese reply no corresponde a ninguna escalada (mensaje normal de Kevin). NO muta. */
  findByNotifyMessage(
    notifyChannel: string,
    notifyMessageId: string
  ): Promise<AnsweredEscalation | null>
  /** Correlación por HILO (Threaded Mode): la escalada cuyo topic_id coincide → Kevin respondió DENTRO del hilo
   *  (sin citar). null = ese topic no es de una escalada (otra conversación). NO muta. */
  findByNotifyTopic(
    notifyChannel: string,
    notifyTopicId: string
  ): Promise<AnsweredEscalation | null>
  /** Marca 'answered', guarda la respuesta + (opcional) el fact curado. UPDATE condicional
   *  (WHERE status='notified') → idempotente ante reintentos de webhook; devuelve si afectó filas. */
  markAnswered(id: string, answer: string, factId?: string): Promise<boolean>
  /** Liga un fact curado a una escalada ya respondida (el factId se conoce DESPUÉS del markAnswered, tras redactar).
   *  Linaje/auditoría: qué duda derivó en qué fact. Idempotente; no cambia el estado. */
  linkFact(id: string, factId: string): Promise<void>
  /** Inc 2 — conciencia del hilo: el contexto del origen de la escalada YA RESUELTA (status 'answered') cuyo topic
   *  coincide, con su respuesta y el fact curado (JOIN con facts → statement + id). Distinto de findByNotifyTopic
   *  (que filtra 'notified' para el inbound): acá el hilo ya está cerrado y el owner sigue charlando. null = ese
   *  topic no es de una escalada resuelta. NO muta. */
  findResolvedByTopic(
    notifyChannel: string,
    notifyTopicId: string
  ): Promise<ThreadOrigin | null>
  /** Anti-spam: cuántas escaladas sin resolver tiene este principal (pending|notified). */
  countOpenByPrincipal(principalId: string): Promise<number>
  /** Anti-spam (dedup): una escalada abierta del mismo principal con pregunta equivalente (normalizada).
   *  Dedup SEMÁNTICO = followup; v1 es por texto normalizado. null = no hay duplicado. */
  findOpenDuplicate(
    principalId: string,
    question: string
  ): Promise<{ id: string } | null>
}
