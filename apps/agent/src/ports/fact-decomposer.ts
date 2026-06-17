// Puerto del DESCOMPONEDOR de facts: generaliza el FactDrafter (que emitía UN statement) a emitir una LISTA de
// hechos ATÓMICOS mono-idea en 3ª persona. Toma el texto CRUDO (y opcionalmente la pregunta que lo originó) y
// devuelve un statement por idea durable; [] si no hay nada factual o todo es sensible/privado.
//
// ⚓ INVARIANTE #8: el LLM SOLO redacta lenguaje natural (los statements); el sistema los persiste vía FactStore.
// ⚓ INVARIANTE #1 + privacidad #5: best-effort — ante cualquier fallo → { statements: [] } (no aprende ante duda).

export interface DecomposeInput {
  /** Texto CRUDO del owner/usuario — puede ser compuesto/coloquial (varias ideas en una frase). */
  rawText: string
  /** Opcional: la pregunta que originó el texto (contexto para redactar mejor los statements). */
  question?: string
  locale: "es" | "en"
}

export interface DecomposeResult {
  /** Un statement por idea durable: 1 idea, 3ª persona, autocontenido. [] si nada factual o todo sensible. */
  statements: string[]
}

export interface FactDecomposer {
  /** best-effort: ante cualquier duda o fallo → `{ statements: [] }` (no aprende; Inv #1 + privacidad #5). */
  decompose(input: DecomposeInput): Promise<DecomposeResult>
}
