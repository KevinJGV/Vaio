// Puerto del JUEZ de contradicción: dado un hecho NUEVO sobre Kevin + una lista de hechos VIGENTES cercanos (por
// coseno), decide la RELACIÓN de cada vigente con el nuevo (contradice / duplica / coexiste / no-seguro). La
// cercanía coseno acota el ruido lejano; el JUICIO de contradicción lo hace el LLM (LEARNINGS "cercanía vectorial
// ≠ contradicción", opción B). Un solo juez compartido por el camino conversacional y el determinístico (curate).
//
// ⚓ INVARIANTE #8: el LLM SOLO emite intención (verdict por ordinal); el sistema mapea ordinal→uuid. El modelo NO
// relaya ids. ⚓ INVARIANTE #1: degradación CONSERVADORA — ante error/datos faltantes el adapter reconstruye un
// veredicto por cada candidato con default "coexists" (NUNCA inventa "contradicts"); jamás invalida por error.

export type ConflictVerdict =
  | "contradicts"
  | "duplicate"
  | "coexists"
  | "unsure"

export interface JudgeCandidate {
  /** Índice estable del candidato (NO uuid; Inv #8). El sistema mapea ordinal→id real. */
  ordinal: number
  /** El statement del hecho VIGENTE cercano, en 3ª persona. */
  statement: string
}

export interface ConflictJudgeInput {
  /** Texto CRUDO del usuario/owner — preserva el "ya no…" que la redacción en 3ª persona pierde. */
  rawText: string
  /** El statement redactado en 3ª persona (el átomo NUEVO a juzgar). */
  statement: string
  candidates: JudgeCandidate[]
  locale: "es" | "en"
}

export interface JudgeDecision {
  ordinal: number
  verdict: ConflictVerdict
}

export interface ConflictJudgeResult {
  /** 1 por candidato de entrada; faltantes/error → "coexists" (conservador, Inv #1). */
  decisions: JudgeDecision[]
  /** Recomendación accionable al owner (costura cross-fuente). Vacío/ausente → se ignora. */
  suggestion?: string
}

export interface ConflictJudge {
  /** candidates:[] → { decisions: [] } sin llamar al LLM. best-effort conservador (Inv #1). */
  judge(input: ConflictJudgeInput): Promise<ConflictJudgeResult>
}
