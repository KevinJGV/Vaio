// Puerto de logging operativo. El core y los adapters dependen de esta interfaz, no de pino.
// La implementación concreta (adapters/logger.ts) la inyecta el wiring (index.ts). Mantener
// el core desacoplado del backend permite cambiarlo (pino → otro) sin tocar la lógica.

export type LogFields = Record<string, unknown>

/** Logger estructurado con niveles y child loggers (para atar bindings como requestId). */
export interface Logger {
  trace(fields: LogFields, msg?: string): void
  trace(msg: string): void
  debug(fields: LogFields, msg?: string): void
  debug(msg: string): void
  info(fields: LogFields, msg?: string): void
  info(msg: string): void
  warn(fields: LogFields, msg?: string): void
  warn(msg: string): void
  error(fields: LogFields, msg?: string): void
  error(msg: string): void
  /** Deriva un logger que incluye `bindings` en cada línea (p.ej. { requestId }). */
  child(bindings: LogFields): Logger
}
