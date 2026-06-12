// Arnés — capacidades POR CANAL (PURO, testeable). Cada canal resuelve a un CapabilityProfile:
// qué tools puede usar, qué alcance de memoria, y el texto de política que se inyecta al system.
// `Principal` identifica al actor del canal (seam para permisos POR-USUARIO a futuro: hoy solo se
// distingue trusted/no-trusted; mañana `resolve` puede mirar el id contra una tabla de roles).

import type { Channel } from "@vaio/contracts"

/** Tools que el registry sabe construir. Unión extensible: sumar acciones futuras acá. */
export type ToolName = "searchMemory"

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

const TELEGRAM_POLICY = [
  "Estás en Telegram, en una conversación PRIVADA y directa con Kevin (sos su asistente personal).",
  "Podés ser tan agéntico y proactivo como haga falta y hablar con confianza sobre su contexto.",
  "Por ahora tu única herramienta es consultar la memoria; más acciones llegarán pronto.",
].join(" ")

/** Perfil mínimo defensivo para principals no confiables en canales privados (no debería ocurrir:
 *  el adapter de Telegram ya filtra por allowlist antes de invocar al core). */
function untrustedTelegram(): CapabilityProfile {
  return {
    channel: "telegram",
    allowedTools: [],
    memoryScope: { sources: PUBLIC_SOURCES, maxK: 4 },
    policyText:
      "Este bot es privado. No reveles información ni ejecutes acciones.",
  }
}

export function createCapabilityResolver(): CapabilityResolver {
  return {
    resolve(channel, principal) {
      if (channel === "telegram") {
        if (!principal.trusted) return untrustedTelegram()
        return {
          channel: "telegram",
          allowedTools: ["searchMemory"],
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
