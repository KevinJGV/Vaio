// Extensión ES del léxico (NO viene del upstream cavemem — ver NOTICE). Se mergea con el léxico
// inglés en lexicon.ts. Gotcha: las regex de compresión usan `\b` (ASCII) → toda entrada debe
// EMPEZAR y TERMINAR en letra ASCII, o no matchea (acentos al borde rompen el boundary). Por eso
// se usa "quizás" (no "quizá"), "perdón" (termina en n, ok), etc. Acentos en medio sí matchean.

import type { Intensity } from "./types.js"

type Tiered<T> = Record<Intensity, T>

const fillersLite = ["o sea", "este", "pues", "tipo", "digamos", "bueno"]
const fillersFull = [
  ...fillersLite,
  "la verdad",
  "en realidad",
  "más bien",
  "como que",
  "vale",
]
const fillersUltra = [
  ...fillersFull,
  "básicamente",
  "literalmente",
  "obviamente",
]

const articlesFull = [
  "el",
  "la",
  "los",
  "las",
  "un",
  "una",
  "unos",
  "unas",
  "lo",
]

const hedgesFull = [
  "creo que",
  "me parece",
  "tal vez",
  "quizás",
  "en general",
  "supongo que",
]
const hedgesUltra = [...hedgesFull, "probablemente", "posiblemente"]

const pleasantriesLite = [
  "hola",
  "gracias",
  "por favor",
  "dale",
  "buenas",
  "perdón",
]
const pleasantriesFull = [...pleasantriesLite, "con gusto", "de nada"]

const abbreviationsFull: Record<string, string> = {
  también: "tmb",
  porque: "pq",
  mensaje: "msg",
  aplicación: "app",
  configuración: "config",
}
const abbreviationsUltra: Record<string, string> = {
  ...abbreviationsFull,
  que: "q",
  por: "x",
  para: "pa",
}

export const lexiconEs: {
  fillers: Tiered<string[]>
  articles: Tiered<string[]>
  hedges: Tiered<string[]>
  pleasantries: Tiered<string[]>
  abbreviations: Tiered<Record<string, string>>
  expansions: Record<string, string>
} = {
  fillers: { lite: fillersLite, full: fillersFull, ultra: fillersUltra },
  articles: { lite: [], full: articlesFull, ultra: articlesFull },
  hedges: { lite: [], full: hedgesFull, ultra: hedgesUltra },
  pleasantries: {
    lite: pleasantriesLite,
    full: pleasantriesFull,
    ultra: pleasantriesFull,
  },
  abbreviations: {
    lite: {},
    full: abbreviationsFull,
    ultra: abbreviationsUltra,
  },
  expansions: { tmb: "también", pq: "porque" },
}
