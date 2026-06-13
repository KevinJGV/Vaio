// Helpers puros compartidos por el core (sin I/O).

import type { Compressor, Intensity } from "../ports/compress.js"

/** Mensaje de error legible desde cualquier throwable. */
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** True si `s` es un UUID (para columnas uuid: los ids stateless/no-conversación no lo son). */
export function isUuid(s: string): boolean {
  return UUID_RE.test(s)
}

/** Comprime `text` si hay compresor; si es null o el texto está vacío, devuelve el crudo
 *  (degradación: la compresión nunca debe romper un turno). */
export function compressOrRaw(
  c: Compressor | null,
  text: string,
  intensity?: Intensity
): string {
  if (!c || !text) return text
  return c.compress(text, intensity)
}

/** Recorta un texto para previews/logs (no para el modelo). */
export function preview(text: string, n = 120): string {
  return text.length > n ? `${text.slice(0, n)}…` : text
}
