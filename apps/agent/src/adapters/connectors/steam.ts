// Conector Steam — UNA fuente, dos facetas:
//  - live(): qué juega Kevin ahora (o lo último). Best-effort → null.
//  - collect(): juegos favoritos por horas → DocChunk[] (snapshot). [] si el perfil de juegos es privado.

import { topByPlaytime } from "../../core/connector-stats.js"
import type { Connector } from "../../ports/connector.js"
import type { DocChunk } from "../../ports/memory.js"
import { toChunks } from "../sources/util.js"

const BASE = "https://api.steampowered.com"

interface SteamPlayer {
  gameextrainfo?: string
  personaname?: string
}
interface SteamGame {
  name: string
  playtime_forever?: number
  playtime_2weeks?: number
}

export function createSteamConnector(cfg: {
  apiKey: string
  steamId: string
}): Connector {
  // La key va por query (NUNCA se loguea).
  const url = (iface: string, method: string, version: string, extra = "") =>
    `${BASE}/${iface}/${method}/${version}/?key=${cfg.apiKey}${extra}`

  const recentlyPlayed = async (count: number): Promise<SteamGame[]> => {
    const res = await fetch(
      url(
        "IPlayerService",
        "GetRecentlyPlayedGames",
        "v1",
        `&steamid=${cfg.steamId}&count=${count}`
      )
    )
    if (!res.ok) return []
    const json = (await res.json()) as { response?: { games?: SteamGame[] } }
    return json.response?.games ?? []
  }

  return {
    name: "steam",

    async live(): Promise<string | null> {
      try {
        const res = await fetch(
          url(
            "ISteamUser",
            "GetPlayerSummaries",
            "v2",
            `&steamids=${cfg.steamId}`
          )
        )
        if (res.ok) {
          const json = (await res.json()) as {
            response?: { players?: SteamPlayer[] }
          }
          const playing = json.response?.players?.[0]?.gameextrainfo
          if (playing) return `🎮 Kevin está jugando ahora: ${playing}`
        }
        // No está jugando → lo último de las 2 semanas.
        const recent = await recentlyPlayed(1)
        const last = recent[0]
        if (!last) return null
        const hours = Math.round((last.playtime_2weeks ?? 0) / 60)
        return `🎮 Lo último que jugó Kevin: ${last.name} (${hours}h en 2 semanas)`
      } catch {
        return null
      }
    },

    async collect(): Promise<DocChunk[]> {
      const res = await fetch(
        url(
          "IPlayerService",
          "GetOwnedGames",
          "v1",
          `&steamid=${cfg.steamId}&include_appinfo=true&include_played_free_games=true`
        )
      )
      if (!res.ok) return []
      const json = (await res.json()) as { response?: { games?: SteamGame[] } }
      const games = (json.response?.games ?? []).filter(
        (g): g is SteamGame & { playtime_forever: number } =>
          typeof g.playtime_forever === "number" && g.playtime_forever > 0
      )
      if (games.length === 0) return [] // perfil privado o sin juegos
      const top = topByPlaytime(games, 10)
      const text = `Juegos favoritos de Kevin (Steam, por horas jugadas): ${top}.`
      return toChunks(
        "steam",
        `https://steamcommunity.com/profiles/${cfg.steamId}`,
        text
      )
    },
  }
}
