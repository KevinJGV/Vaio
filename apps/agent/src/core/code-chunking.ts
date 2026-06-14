// Lógica pura de troceo de CÓDIGO (corte por líneas) + header de procedencia. Sin I/O → unit-testeable.
// Complementa a `chunking.ts` (prosa, corte por palabra): el código se trocea por líneas para no
// romper la estructura sintáctica a mitad de una línea.

/** Trocea código respetando límites de LÍNEA (nunca parte una línea). Acumula líneas hasta `maxChars`;
 *  cuando una línea sola excede maxChars, esa línea va en su propio chunk. Overlap de `overlapLines` líneas
 *  entre chunks consecutivos para no perder contexto. */
export function chunkCode(
  text: string,
  opts?: { maxChars?: number; overlapLines?: number }
): string[] {
  const maxChars = opts?.maxChars ?? 900
  const overlapLines = opts?.overlapLines ?? 8
  if (!text) return []

  const lines = text.split("\n")
  const chunks: string[] = []

  let start = 0
  while (start < lines.length) {
    let end = start // índice exclusivo del corte
    let len = 0
    while (end < lines.length) {
      const line = lines[end] as string
      // +1 por el "\n" entre líneas (no para la primera del chunk)
      const add = end > start ? line.length + 1 : line.length
      // si ya hay al menos una línea y agregar esta excede el límite → cerrá el chunk
      if (end > start && len + add > maxChars) break
      len += add
      end++
    }
    // garantía de progreso: una línea sola más larga que maxChars igual avanza (va sola)
    if (end === start) end = start + 1

    chunks.push(lines.slice(start, end).join("\n"))

    if (end >= lines.length) break

    // siguiente arranque con solapamiento; clamp para asegurar progreso (anti-loop):
    // nunca retroceder al/antes del start actual aunque overlapLines sea enorme.
    const next = end - overlapLines
    start = Math.max(next, start + 1)
  }

  return chunks
}

/** Antepone un header de procedencia a cada chunk (load-bearing para el recall: inyecta repo/path/lang
 *  al espacio de embeddings). Código → comentario "//"; prosa → comentario HTML "<!-- -->". */
export function withProvenanceHeader(
  chunks: string[],
  ctx: { repo: string; path: string; lang: string }
): string[] {
  const meta = `repo: ${ctx.repo} · path: ${ctx.path} · lang: ${ctx.lang}`
  // prosa-vs-código por lang (simple y testeable)
  const header = ctx.lang === "markdown" ? `<!-- ${meta} -->` : `// ${meta}`
  return chunks.map((chunk) => `${header}\n${chunk}`)
}
