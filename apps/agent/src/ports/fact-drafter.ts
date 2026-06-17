// Puerto del REDACTOR de facts: convierte la respuesta de Kevin a una escalada (lenguaje conversacional,
// contextual — "sí, me encanta") en un STATEMENT durable en 3ª persona ("A Kevin le gusta la pasta"), o null si
// la respuesta no es un hecho durable o huele a SENSIBLE/PRIVADO (números, direcciones, "no le pases…"). Es la
// salvaguarda anti-fuga del análisis adversarial (los facts los sirve searchMemory a TODOS los visitantes).
//
// ⚓ INVARIANTE #8: el LLM SOLO redacta lenguaje natural (el statement); el sistema lo persiste vía FactStore.
// La curación es ejecución DETERMINÍSTICA del sistema (el inbound llama esto + FactStore) — NO una tool que el
// modelo conversacional deba decidir llamar → no reintroduce el gap "dice pero no hace".

export interface FactDraftInput {
  /** Lo que el visitante preguntó (contexto para redactar el statement). */
  question: string
  /** La respuesta de Kevin (owner) — puede ser contextual/coloquial. */
  ownerAnswer: string
  locale: "es" | "en"
}

export interface FactDraftResult {
  /** El hecho durable en 3ª persona, o null si no es factual/durable o es sensible/privado (no se guarda). */
  statement: string | null
  /** Por qué (para logging/observabilidad; nunca al usuario). */
  reason?: string
}

export interface FactDrafter {
  /** best-effort: ante cualquier duda o fallo → `{ statement: null }` (no guarda; Inv #1 + privacidad #5). */
  draft(input: FactDraftInput): Promise<FactDraftResult>
}
