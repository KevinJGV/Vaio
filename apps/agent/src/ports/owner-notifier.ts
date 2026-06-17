// Puerto de NOTIFICACIÓN PROACTIVA AL OWNER (outbound): canal de SALIDA directo "mandale ESTO a Kevin (owner)
// por su canal de notificación, proactivamente". A diferencia de ProactiveResume (que re-entra el agente con una
// respuesta generada), esto EMPUJA un mensaje crudo, NO depende de un turno → invocable desde cualquier disparador
// (action, cron/rutina, worker, webhook). Genérico/maleable por `kind` + `payload`; extensible a WhatsApp/correo
// con otro adapter sin tocar la interfaz ni los consumidores. Devuelve una REFERENCIA opaca (el id del mensaje
// enviado) para que el consumidor (p.ej. escalate) ancle el reply-to. El core depende del puerto; el I/O en adapters
// (Inv #4). best-effort: NUNCA tira (Inv #1). Ver docs/superpowers/specs/2026-06-16-escalate-owner-notifier-design.md.

/** Categoría del aviso proactivo. Extensible: cada disparador futuro suma su kind (el adapter puede variar
 *  formato/prefijo por kind, pero NO se agregan métodos al puerto — Inv #10). */
export type OwnerNotifyKind =
  | "escalation" // Vaio escaló una duda de un visitante
  | "routine-result" // resultado de una rutina/cron
  | "task-done" // tarea larga en background terminó (variante no-conversacional)
  | "webhook" // evento externo entrante
  | "system" // aviso operativo (degradación, etc.)

export interface OwnerNotifyInput {
  kind: OwnerNotifyKind
  /** Cuerpo en TEXTO PLANO (system-authored o renderizado por el llamador). El adapter lo formatea/enmarca y lo
   *  ESCAPA por canal — el llamador NO necesita conocer el markup del canal (Telegram HTML, etc.). Puede incluir
   *  contenido no confiable (p.ej. la pregunta de un visitante): el escape del borde de salida lo neutraliza. */
  text: string
  locale?: string
  /** Título del HILO (si el canal soporta topics, p.ej. Telegram Threaded Mode). El consumidor lo pasa (escalate
   *  → la pregunta truncada); el adapter cae a un default por `kind` si falta. */
  title?: string
  /** Metadata opcional del disparador (p.ej. { escalationId }). Para logging / que el adapter decida formato;
   *  NUNCA datos que el modelo deba relayar (Inv #8). */
  payload?: Record<string, unknown>
}

export interface OwnerNotifyResult {
  /** Se entregó al owner. false = sin canal owner configurado o el envío falló (degradación limpia). */
  delivered: boolean
  /** Canal por el que se intentó/salió ('telegram' hoy). El consumidor lo persiste como `notifyChannel` para
   *  correlacionar luego la respuesta. Presente incluso si !delivered (el adapter sabe su propio canal). */
  channel: string
  /** Ancla opaca del mensaje enviado (Telegram: String(message_id); WhatsApp: wamid; correo: Message-ID).
   *  El consumidor la persiste para correlacionar la respuesta. undefined si !delivered o el canal no la expone. */
  ref?: string
  /** Ancla del HILO creado para este aviso (Telegram: String(message_thread_id)). El consumidor la persiste para
   *  correlacionar la respuesta del owner DENTRO del hilo (sin citar). undefined si el canal no usa topics. */
  topicId?: string
  /** Chat/destino donde quedó el mensaje (Telegram: String(owner chat id)). Para casar/anclar el reply-to. */
  channelChatId?: string
}

export interface OwnerNotifier {
  /** Empuja un aviso al owner por su canal de notificación. best-effort: NUNCA tira (Inv #1). Sin owner
   *  configurado → { delivered: false }. Devuelve la referencia para anclar el reply-to. */
  notify(input: OwnerNotifyInput): Promise<OwnerNotifyResult>
}
