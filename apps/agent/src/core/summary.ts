// Arnés — resumen rodante "caveman" (PURO, testeable). Decide CUÁNDO resumir y arma el prompt;
// la llamada al modelo la hace el puerto Summarizer (adapters/summarizer.ts). Comprime el resumen
// previo + los mensajes que salieron de la ventana reciente en un running summary terso de hechos
// y contexto durable. Determinista por count (token-based = refinamiento futuro).

import type { Locale } from "@vaio/contracts"
import type { StoredMessage } from "../ports/conversation.js"

/** True cuando la conversación acumuló suficientes mensajes como para resumir lo viejo. */
export function shouldSummarize(args: {
  messageCount: number
  threshold: number
}): boolean {
  return args.messageCount >= args.threshold
}

/** Arma system+prompt para comprimir (resumen previo + mensajes salientes) en un resumen nuevo. */
export function buildSummaryPrompt(args: {
  priorSummary: string
  olderMessages: StoredMessage[]
  locale: Locale
}): { system: string; prompt: string } {
  const lang = args.locale === "en" ? "English" : "Spanish"
  const system = [
    `Sos un compresor de memoria conversacional. Escribís en ${lang}.`,
    "Produces un RESUMEN RODANTE: denso, en bullets o frases cortas, solo hechos y contexto durables",
    "(quién es el usuario, qué pidió, decisiones, preferencias, hilos abiertos). Sin saludos ni relleno.",
    "Integrás el resumen previo con los mensajes nuevos en UN solo resumen actualizado y conciso.",
  ].join(" ")
  const transcript = args.olderMessages
    .map((m) => `${m.role === "user" ? "Usuario" : "Vaio"}: ${m.content}`)
    .join("\n")
  const prompt = [
    args.priorSummary.trim()
      ? `Resumen previo:\n${args.priorSummary.trim()}`
      : "Resumen previo: (vacío)",
    "",
    "Mensajes nuevos a integrar:",
    transcript,
    "",
    "Devolvé SOLO el resumen actualizado.",
  ].join("\n")
  return { system, prompt }
}
