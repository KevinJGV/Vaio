// Helpers puros compartidos por el core (sin I/O).

/** Mensaje de error legible desde cualquier throwable. */
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Recorta un texto para previews/logs (no para el modelo). */
export function preview(text: string, n = 120): string {
  return text.length > n ? `${text.slice(0, n)}…` : text
}
