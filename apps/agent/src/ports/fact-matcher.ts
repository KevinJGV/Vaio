// Puerto del FactMatcher: dado lo que el owner quiere OLVIDAR (descripción en lenguaje natural) + una lista de
// candidatos (facts confirmados cercanos por coseno), decide cuáles PERTENECEN a esa descripción (relevancia/
// aboutness — más amplio que "duplicado": una descripción de un tema matchea los facts de ese tema aunque estén
// redactados distinto). Emite ORDINALES
// (Inv #8: el sistema mapea a uuids). Es la pieza de PRECISIÓN del híbrido de unlearnFact (umbral coseno = recall).

export interface MatchInput {
  /** Lo que el owner quiere olvidar, en lenguaje natural (ej. "lo de la pizza", "que le gusta el fútbol"). */
  description: string
  /** Candidatos cercanos por coseno (orden estable). */
  candidates: { ordinal: number; statement: string }[]
  locale: "es" | "en"
}

export interface MatchResult {
  /** Ordinales de los candidatos que PERTENECEN a la descripción (subconjunto). Vacío = ninguno coincide. */
  ordinals: number[]
}

export interface FactMatcher {
  /** best-effort: ante fallo → devuelve TODOS los ordinales de entrada (no dropear en silencio; confía en el corte
   *  por coseno previo). */
  match(input: MatchInput): Promise<MatchResult>
}
