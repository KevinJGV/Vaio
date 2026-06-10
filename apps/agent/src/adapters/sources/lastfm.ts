import type { DocChunk } from "../../ports/memory.js"
import { toChunks } from "./util.js"

export interface LastfmConfig {
  apiKey: string
  user: string
}

interface TopArtistsResponse {
  topartists?: { artist?: { name: string }[] }
}

/** Gustos musicales: artistas más escuchados en Last.fm. */
export async function collectLastfm(cfg: LastfmConfig): Promise<DocChunk[]> {
  const base = "https://ws.audioscrobbler.com/2.0/"
  const url = `${base}?method=user.gettopartists&user=${encodeURIComponent(cfg.user)}&api_key=${cfg.apiKey}&format=json&limit=30`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Last.fm → ${res.status}`)
  const json = (await res.json()) as TopArtistsResponse

  const artists = (json.topartists?.artist ?? []).map((a) => a.name)
  if (artists.length === 0) return []

  const text = `Gustos musicales de Kevin (Last.fm, artistas más escuchados): ${artists.join(", ")}.`
  return toChunks("lastfm", `https://www.last.fm/user/${cfg.user}`, text)
}
