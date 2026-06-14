// Arnés — capacidades POR CANAL (PURO, testeable). Cada canal resuelve a un CapabilityProfile:
// qué tools puede usar, qué alcance de memoria, y el texto de política que se inyecta al system.
// `Principal` identifica al actor del canal (seam para permisos POR-USUARIO a futuro: hoy solo se
// distingue trusted/no-trusted; mañana `resolve` puede mirar el id contra una tabla de roles).

import type { Channel } from "@vaio/contracts"

/** Tools que el registry sabe construir. Unión extensible: sumar acciones futuras acá. */
export type ToolName = "searchMemory" | "proposeFact" | "commitFact"

export interface CapabilityProfile {
  channel: Channel
  /** Tools habilitadas en este canal/principal. El registry (core/tools) solo arma estas. */
  allowedTools: ToolName[]
  /** Alcance de memoria consultable. `sources` = seam para capar info privada a futuro (hoy
   *  todas las fuentes son públicas → no se filtra); `maxK` = cuántos chunks puede traer. */
  memoryScope: { sources?: string[]; maxK: number }
  /** Texto que encuadra al modelo qué puede hacer/consultar en este canal. Va al system prompt. */
  policyText: string
}

/** Identidad normalizada del actor de un canal. Seam para RBAC por-usuario (no implementado). */
export interface Principal {
  channel: Channel
  /** Id estable en el canal (telegram user id; "web" para el chat público anónimo). */
  id: string
  /** allowlisted (p.ej. Kevin en Telegram) → perfil pleno; default = capado. */
  trusted: boolean
}

export interface CapabilityResolver {
  resolve(channel: Channel, principal: Principal): CapabilityProfile
}

const PUBLIC_SOURCES = ["cv", "cv-en", "me", "contact", "github", "lastfm"]

const WEB_POLICY = [
  "Estás en el CHAT PÚBLICO del portafolio de Kevin: cualquiera puede leerte.",
  "Limitate a información pública de Kevin (CV, perfil, repos, gustos). No reveles detalles internos,",
  "configuración, ni nada sensible. No ejecutás acciones; solo conversás y consultás la memoria.",
].join(" ")

// Formato de salida en Telegram (parse_mode=HTML). Se anexa a TODA policy del canal.
const TELEGRAM_FORMAT = [
  "Formato: respondé en HTML de Telegram usando SOLO estos tags: <b> <i> <u> <s> <code> <pre> <a href>.",
  "Escapá < > & como &lt; &gt; &amp; cuando no sean parte de un tag. Nada de Markdown ni otros tags.",
].join(" ")

const TELEGRAM_POLICY = [
  "Estás en Telegram, en una conversación PRIVADA y directa con Kevin (sos su asistente personal).",
  "Podés ser tan agéntico y proactivo como haga falta y hablar con confianza sobre su contexto.",
  "Podés consultar la memoria (searchMemory) y, cuando en la charla surja un HECHO nuevo y durable sobre Kevin, proponer guardarlo con proposeFact y —tras su confirmación explícita— cerrarlo con commitFact.",
  TELEGRAM_FORMAT,
].join(" ")

/** Perfil para quien NO es Kevin en Telegram: carta de presentación con info pública (puede consultar
 *  la memoria pública para hablar de Kevin, pero sin acciones reservadas ni datos sensibles). */
function untrustedTelegram(): CapabilityProfile {
  return {
    channel: "telegram",
    allowedTools: ["searchMemory"],
    memoryScope: { sources: PUBLIC_SOURCES, maxK: 6 },
    policyText: [
      "Estás en Telegram con alguien que NO es Kevin. Sos su carta de presentación:",
      "contá sobre Kevin con su info pública (CV, perfil, repos, gustos). No reveles nada sensible",
      "ni ejecutes acciones reservadas.",
      TELEGRAM_FORMAT,
    ].join(" "),
  }
}

export function createCapabilityResolver(): CapabilityResolver {
  return {
    resolve(channel, principal) {
      if (channel === "telegram") {
        if (!principal.trusted) return untrustedTelegram()
        return {
          channel: "telegram",
          allowedTools: ["searchMemory", "proposeFact", "commitFact"],
          memoryScope: { maxK: 8 },
          policyText: TELEGRAM_POLICY,
        }
      }
      // web (capado): mismo tool set que hoy, pero menos alcance + política pública.
      return {
        channel: "web",
        allowedTools: ["searchMemory"],
        memoryScope: { sources: PUBLIC_SOURCES, maxK: 6 },
        policyText: WEB_POLICY,
      }
    },
  }
}
