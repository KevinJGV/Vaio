import { lexiconData as lex } from "./lexicon.data.js"
import { lexiconEs as es } from "./lexicon.es.js"
import type { Intensity } from "./types.js"

// Léxico = inglés (upstream, lexicon.data) + español (lexicon.es), mergeados por intensidad.

export function fillersFor(i: Intensity): string[] {
  return [...lex.fillers[i], ...es.fillers[i]]
}
export function articlesFor(i: Intensity): string[] {
  return [...lex.articles[i], ...es.articles[i]]
}
export function hedgesFor(i: Intensity): string[] {
  return [...lex.hedges[i], ...es.hedges[i]]
}
export function pleasantriesFor(i: Intensity): string[] {
  return [...lex.pleasantries[i], ...es.pleasantries[i]]
}
export function abbreviationsFor(i: Intensity): Record<string, string> {
  return { ...lex.abbreviations[i], ...es.abbreviations[i] }
}
export function expansions(): Record<string, string> {
  return { ...lex.expansions, ...es.expansions }
}
