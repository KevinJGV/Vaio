// Conector Last.fm (faceta LIVE): qué está escuchando Kevin ahora (o lo último). Best-effort → null ante fallo.

import type { Connector } from "../../ports/connector.js"

interface RecentTracksResponse {
  recenttracks?: {
    track?: {
      name: string
      artist?: { "#text"?: string }
      "@attr"?: { nowplaying?: string }
    }[]
  }
}

export function createLastfmConnector(cfg: {
  apiKey: string
  user: string
}): Connector {
  return {
    name: "lastfm",
    async live(): Promise<string | null> {
      try {
        const base = "https://ws.audioscrobbler.com/2.0/"
        const url = `${base}?method=user.getrecenttracks&user=${encodeURIComponent(cfg.user)}&api_key=${cfg.apiKey}&format=json&limit=5`
        const res = await fetch(url)
        if (!res.ok) return null
        const json = (await res.json()) as RecentTracksResponse
        const tracks = json.recenttracks?.track ?? []
        const first = tracks[0]
        if (!first) return null
        const label = (t: NonNullable<typeof first>) =>
          `${t.artist?.["#text"] ?? "?"} — ${t.name}`
        if (first["@attr"]?.nowplaying === "true") {
          return `🎧 Kevin está escuchando ahora: ${label(first)}`
        }
        return `🎵 Lo último que escuchó Kevin: ${label(first)}`
      } catch {
        return null
      }
    },
  }
}
