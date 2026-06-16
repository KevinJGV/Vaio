// Capa de COMPLEMENTO de la memoria: "detectores de conocimiento disponible". searchMemory trae el CONTENIDO
// (chunks RAG + facts); los detectores emiten SEÑALES de disponibilidad (un repo existe pero no está indexado,
// una copia está atrás, etc.) como NOTAS DEL SISTEMA que el modelo lee y acciona (jala con learnRepo, etc.).
// El sistema detecta + informa; el modelo NO orquesta (Invariante #9). Ver
// docs/superpowers/specs/2026-06-15-knowledge-detectors-design.md.

/** Contexto del turno para el probe de un detector. */
export interface DetectContext {
  /** La query que el modelo pasó a searchMemory este turno. */
  query: string
  /** Los `source` que searchMemory YA recuperó (repo:*, github, fact, trend:*, …). */
  retrievedSources: string[]
}

/** Una señal de disponibilidad que el detector quiere surfacear al modelo. */
export interface DetectionHint {
  /** Texto "[nota del sistema: …]" que se antepone al output de searchMemory; el modelo lo lee y acciona. */
  note: string
}

export interface KnowledgeDetector {
  name: string
  /** Probe BARATO, best-effort: ¿hay una señal para este turno? `null` = nada que reportar.
   *  El detector NUNCA debe tirar (catch interno) ni bloquear (trabajo caro → background). */
  detect(ctx: DetectContext): Promise<DetectionHint | null>
}

export interface DetectorRegistry {
  /** Corre todos los detectores en paralelo (best-effort: un fallo no rompe a los demás), recorta a un cap de
   *  notas por turno (no inundar el contexto) y devuelve las notas listas para anteponer. */
  run(ctx: DetectContext): Promise<string[]>
}
