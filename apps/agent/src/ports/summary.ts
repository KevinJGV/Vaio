// Puerto del resumidor: genera texto (no-streaming) para comprimir conversaciones viejas en un
// resumen rodante (LLM, lossy — Tier 2). El core arma el prompt (core/summary.ts, puro) y delega la llamada
// al modelo a esta interfaz; el adapter concreto (adapters/summarizer.ts) usa generateText con un
// modelo barato. Separar el prompt (puro/testeable) de la llamada (I/O) mantiene el core limpio.

/** Genera el resumen a partir de un system+prompt ya armados. Debe degradar con gracia
 *  (lanzar es aceptable: el caller lo envuelve en try/catch y conserva la ventana cruda). */
export interface Summarizer {
  summarize(input: { system: string; prompt: string }): Promise<string>
}
