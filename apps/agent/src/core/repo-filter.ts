// Filtrado PURO de repos del catálogo enriquecido por metadata (lenguaje/topic). Lo usa la tool `findRepos`.
// Si un filtro dado no corresponde a NINGÚN valor real del catálogo → lo reporta (fallo visible, Invariante #8:
// el modelo pasó un string de baja cardinalidad y el sistema valida contra valores reales). Extensible: sumar un
// filtro nuevo (p.ej. estado de CI a futuro) = un campo más acá, NO una tool nueva.

import type { OwnerRepo } from "./repo-resolve.js"

export interface RepoFilter {
  language?: string
  topic?: string
}

export interface FilterResult {
  matched: OwnerRepo[]
  /** El filtro dado no matchea ningún valor real → fallo visible (con los valores disponibles). */
  unknownLanguage?: string
  unknownTopic?: string
  availableLanguages: string[]
  availableTopics: string[]
}

/** Únicos preservando el case, dedup case-insensitive (para listar valores reales en el fallo visible). */
function uniqueCi(values: string[]): string[] {
  const seen = new Map<string, string>()
  for (const v of values) {
    const k = v.toLowerCase()
    if (!seen.has(k)) seen.set(k, v)
  }
  return [...seen.values()]
}

export function filterRepos(repos: OwnerRepo[], f: RepoFilter): FilterResult {
  const availableLanguages = uniqueCi(
    repos.map((r) => r.language).filter((l): l is string => Boolean(l))
  )
  const availableTopics = uniqueCi(repos.flatMap((r) => r.topics ?? []))

  const lang = f.language?.toLowerCase()
  const topic = f.topic?.toLowerCase()
  const unknownLanguage =
    lang && !availableLanguages.some((l) => l.toLowerCase() === lang)
      ? f.language
      : undefined
  const unknownTopic =
    topic && !availableTopics.some((t) => t.toLowerCase() === topic)
      ? f.topic
      : undefined

  const matched = repos.filter((r) => {
    const okLang = !lang || r.language?.toLowerCase() === lang
    const okTopic =
      !topic || (r.topics ?? []).some((t) => t.toLowerCase() === topic)
    return okLang && okTopic
  })

  return {
    matched,
    ...(unknownLanguage ? { unknownLanguage } : {}),
    ...(unknownTopic ? { unknownTopic } : {}),
    availableLanguages,
    availableTopics,
  }
}
