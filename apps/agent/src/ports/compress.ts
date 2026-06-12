// Puerto del compresor de contexto (Tier 1, determinístico). El core depende de esta interfaz,
// no del paquete @vaio/compress. Comprime prosa preservando código/URLs/números/identificadores;
// `expand` revierte abreviaturas (para UI/progressive-disclosure futuro); `countTokens` para métricas.

export type Intensity = "lite" | "full" | "ultra"

export interface Compressor {
  compress(text: string, intensity?: Intensity): string
  expand(text: string): string
  countTokens(text: string): number
}
