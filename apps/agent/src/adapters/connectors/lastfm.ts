// Conector Last.fm — UNA fuente, dos facetas:
//  - live(): qué está escuchando Kevin ahora (o lo último). Best-effort → null.
//  - collect(): gustos musicales (artistas más escuchados) → DocChunk[] para la memoria (persist, snapshot).

import type { Connector } from "../../ports/connector.js"
import type { DocChunk } from "../../ports/memory.js"
import { toChunks } from "../sources/util.js"

const BASE = "https://ws.audioscrobbler.com/2.0/"

interface RecentTracksResponse {
  recenttracks?: {
    track?: {
      name: string
      artist?: { "#text"?: string }
      "@attr"?: { nowplaying?: string }
    }[]
  }
}
interface TopArtistsResponse {
  topartists?: { artist?: { name: string }[] }
}

export function createLastfmConnector(cfg: {
  apiKey: string
  user: string
}): Connector {
  const q = (method: string, extra = "") =>
    `${BASE}?method=${method}&user=${encodeURIComponent(cfg.user)}&api_key=${cfg.apiKey}&format=json${extra}`

  return {
    name: "lastfm",

    async live(): Promise<string | null> {
      try {
        const res = await fetch(q("user.getrecenttracks", "&limit=5"))
        if (!res.ok) return null
        const json = (await res.json()) as RecentTracksResponse
        const first = json.recenttracks?.track?.[0]
        if (!first) return null
        const label = `${first.artist?.["#text"] ?? "?"} — ${first.name}`
        return first["@attr"]?.nowplaying === "true"
          ? `🎧 Kevin está escuchando ahora: ${label}`
          : `🎵 Lo último que escuchó Kevin: ${label}`
      } catch {
        return null
      }
    },

    async collect(): Promise<DocChunk[]> {
      const res = await fetch(q("user.gettopartists", "&limit=30"))
      if (!res.ok) throw new Error(`Last.fm → ${res.status}`)
      const json = (await res.json()) as TopArtistsResponse
      const artists = (json.topartists?.artist ?? []).map((a) => a.name)
      if (artists.length === 0) return []
      const text = `Gustos musicales de Kevin (Last.fm, artistas más escuchados): ${artists.join(", ")}.`
      return toChunks("lastfm", `https://www.last.fm/user/${cfg.user}`, text)
    },
  }
}
