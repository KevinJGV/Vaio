// Registry de detectores: corre todos en paralelo (best-effort — un fallo no rompe a los demás), recorta a un
// cap de notas por turno (no inundar el contexto del modelo) y devuelve las notas listas para anteponer al
// output de searchMemory. PURO en su orquestación; los detectores concretos viven en este mismo dir.

import type {
  DetectContext,
  DetectorRegistry,
  KnowledgeDetector,
} from "../../ports/knowledge-detector.js"

/** Máximo de notas del sistema por turno (default 3). */
const DEFAULT_MAX_NOTES = 3

export function createDetectorRegistry(
  detectors: KnowledgeDetector[],
  opts?: { maxNotes?: number }
): DetectorRegistry {
  const maxNotes = opts?.maxNotes ?? DEFAULT_MAX_NOTES
  return {
    async run(ctx: DetectContext): Promise<string[]> {
      const hints = await Promise.all(
        detectors.map((d) => d.detect(ctx).catch(() => null))
      )
      return hints.flatMap((h) => (h ? [h.note] : [])).slice(0, maxNotes)
    },
  }
}
