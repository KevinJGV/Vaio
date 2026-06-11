// Adapter de logging: implementa el puerto Logger con pino. JSON en prod (lo captura Railway),
// pretty con colores en dev (transport pino-pretty). `redact` actúa de red de seguridad para que
// ninguna key se filtre nunca, aunque por convención no logueamos secrets directamente.

import { type LogFn, type Logger as PinoLogger, pino } from "pino"
import { resolveLogFormat } from "../core/logging.js"
import type { LogFields, Logger } from "../ports/logger.js"

export interface LoggerOptions {
  /** trace|debug|info|warn|error|silent (default info). */
  level?: string
  /** pretty|json|auto (default auto). */
  format?: string
  /** development|production|test — decide auto → pretty/json. */
  nodeEnv?: string
}

// Keys/paths que NUNCA deben aparecer en los logs (defensa en profundidad).
const REDACT_PATHS = [
  "OPENROUTER_API_KEY",
  "EMBEDDINGS_API_KEY",
  "AGENT_API_KEY",
  "DATABASE_URL",
  "GITHUB_TOKEN",
  "LASTFM_API_KEY",
  "apiKey",
  "authorization",
  "*.apiKey",
  "*.authorization",
  "headers.authorization",
]

export function createLogger(opts: LoggerOptions = {}): Logger {
  const format = resolveLogFormat(opts.format, opts.nodeEnv)
  const p = pino({
    level: opts.level ?? "info",
    base: { service: "vaio" },
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    ...(format === "pretty"
      ? {
          transport: {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "SYS:HH:MM:ss.l",
              ignore: "pid,hostname,service",
            },
          },
        }
      : {}),
  })
  return wrap(p)
}

/** Adapta una función de log de pino (obj, msg) | (msg) a la firma del puerto. */
function method(fn: LogFn) {
  return (a: LogFields | string, b?: string): void => {
    if (typeof a === "string") fn(a)
    else fn(a, b)
  }
}

function wrap(p: PinoLogger): Logger {
  return {
    trace: method(p.trace.bind(p)),
    debug: method(p.debug.bind(p)),
    info: method(p.info.bind(p)),
    warn: method(p.warn.bind(p)),
    error: method(p.error.bind(p)),
    child: (bindings: LogFields) => wrap(p.child(bindings)),
  }
}
