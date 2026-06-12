// Extensión ES del léxico (NO viene del upstream cavemem — ver NOTICE). Se mergea con el léxico
// inglés en lexicon.ts. Cobertura paritaria con el inglés (lite/full/ultra), con equivalentes ES
// correctos por intensidad.
//
// Gotcha (\b ASCII): toda entrada debe EMPEZAR y TERMINAR en letra ASCII, o la regex `\b…\b` no
// matchea (acentos AL BORDE rompen el boundary). Acentos EN MEDIO sí matchean ("configuración" ok;
// "quizás" ok porque termina en s; pero "quizá"/"disculpá" NO → se usan variantes terminadas en ASCII).

import type { Intensity } from "./types.js"

type Tiered<T> = Record<Intensity, T>

// — Muletillas / intensificadores —
const fillersLite = [
  "o sea",
  "viste",
  "pues",
  "bueno",
  "digamos",
  "tipo",
  "como que",
  "en plan",
  "la verdad",
  "realmente",
  "simplemente",
  "muy",
]
const fillersFull = [
  ...fillersLite,
  "en realidad",
  "más bien",
  "vale",
  "básicamente",
  "literalmente",
  "obviamente",
  "de hecho",
  "cabe destacar que",
]
const fillersUltra = [
  ...fillersFull,
  "quizás",
  "posiblemente",
  "probablemente",
  "generalmente",
  "típicamente",
  "usualmente",
]

// — Artículos (el español tiene más que el inglés; correcto) —
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

// — Atenuadores / hedges —
const hedgesFull = [
  "te recomendaría",
  "deberíamos",
  "podría ser",
  "tal vez quieras",
  "podría llegar a",
  "es posible que",
]
const hedgesUltra = [
  ...hedgesFull,
  "creo que",
  "me parece",
  "supongo que",
  "diría que",
  "en mi opinión",
]

// — Cortesías —
const pleasantriesLite = [
  "por favor",
  "gracias",
  "muchas gracias",
  "perdón",
  "disculpa",
  "claro",
  "por supuesto",
  "dale",
]
const pleasantriesFull = [
  ...pleasantriesLite,
  "con gusto",
  "encantado de ayudar",
]

// — Abreviaturas (palabra ES → forma corta) —
const abbreviationsFull: Record<string, string> = {
  configuración: "config",
  implementación: "impl",
  documentación: "docs",
  repositorio: "repo",
  repositorios: "repos",
  "base de datos": "db",
  aplicación: "app",
  aplicaciones: "apps",
  entorno: "env",
  entornos: "envs",
  dependencia: "dep",
  dependencias: "deps",
  directorio: "dir",
  directorios: "dirs",
  parámetro: "param",
  parámetros: "params",
  argumento: "arg",
  argumentos: "args",
  función: "fn",
  funciones: "fns",
  variable: "var",
  variables: "vars",
  referencia: "ref",
  referencias: "refs",
  autenticación: "auth",
  autorización: "authz",
  mensaje: "msg",
  mensajes: "msgs",
  solicitud: "req",
  respuesta: "resp",
  número: "num",
  transacción: "tx",
  transacciones: "txs",
  asíncrono: "async",
  síncrono: "sync",
  también: "tmb",
  porque: "pq",
}
const abbreviationsUltra: Record<string, string> = {
  ...abbreviationsFull,
  que: "q",
  por: "x",
  para: "pa",
  desde: "dsd",
  hasta: "hsta",
  cuando: "cdo",
  entonces: "ent",
  verdad: "vdd",
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
  // expand() es aproximado/no se usa en runtime hoy → solo las abreviaturas ES no ambiguas.
  expansions: {
    tmb: "también",
    pq: "porque",
    pa: "para",
    dsd: "desde",
    hsta: "hasta",
    cdo: "cuando",
    vdd: "verdad",
  },
}
