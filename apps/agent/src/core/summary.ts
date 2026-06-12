// Arnés — resumen rodante LLM (Tier 2, lossy; PURO, testeable). Decide CUÁNDO resumir y arma el
// prompt; la llamada al modelo la hace el puerto Summarizer (adapters/summarizer.ts). Condensa el
// resumen previo + los mensajes que salieron de la ventana reciente en un running summary terso de
// hechos y contexto durable. Determinista por count (token-based = refinamiento futuro).
// (La compresión determinística sin LLM = Tier 1, @vaio/compress — no confundir.)

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
  const en = args.locale === "en"
  const transcript = args.olderMessages
    .map(
      (m) =>
        `${m.role === "user" ? (en ? "User" : "Usuario") : "Vaio"}: ${m.content}`
    )
    .join("\n")
  if (en) {
    const system = [
      "You are a conversational-memory compressor. You write in English.",
      "You produce a ROLLING SUMMARY: dense, in bullets or short phrases, only durable facts and context",
      "(who the user is, what they asked, decisions, preferences, open threads). No greetings or filler.",
      "You integrate the prior summary with the new messages into ONE concise, updated summary.",
    ].join(" ")
    const prompt = [
      args.priorSummary.trim()
        ? `Prior summary:\n${args.priorSummary.trim()}`
        : "Prior summary: (empty)",
      "",
      "New messages to integrate:",
      transcript,
      "",
      "Return ONLY the updated summary.",
    ].join("\n")
    return { system, prompt }
  }
  const system = [
    "Sos un compresor de memoria conversacional. Escribís en español.",
    "Producís un RESUMEN RODANTE: denso, en bullets o frases cortas, solo hechos y contexto durables",
    "(quién es el usuario, qué pidió, decisiones, preferencias, hilos abiertos). Sin saludos ni relleno.",
    "Integrás el resumen previo con los mensajes nuevos en UN solo resumen actualizado y conciso.",
  ].join(" ")
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
