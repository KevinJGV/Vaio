// Puerto de TRADUCCIÓN: traduce un texto corto a un idioma objetivo. Lo usa searchMemory para llevar la query al
// idioma CANÓNICO de los facts antes de embeber/buscar (el coseno cross-idioma es débil: el embedder agrupa por
// idioma por encima del significado → una query en otro idioma no recupera los facts canónicos). best-effort: ante
// fallo devuelve el texto original (degrada al comportamiento previo, Inv #1). El core depende del puerto; el
// adapter lo implementa con un modelo. Ver docs/superpowers/specs/2026-06-18-update-visitor-design.md (followup).

export interface Translator {
  /** Traduce `text` a `targetLocale`. Best-effort: si falla o ya está en ese idioma, puede devolver el original. */
  translate(text: string, targetLocale: "es" | "en"): Promise<string>
}
