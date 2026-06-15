// Registry de CONECTORES: arma la lista de conectores habilitados (gated por keys). Sumar una fuente nueva
// = nuevo archivo con su Connector + un push acá. Espeja el registry de actions.

import type { Env } from "../../config.js"
import type { Connector } from "../../ports/connector.js"
import { createGithubConnector } from "./github.js"
import { createGithubStatsConnector } from "./github-stats.js"
import { createLastfmConnector } from "./lastfm.js"
import { createSteamConnector } from "./steam.js"
import { createWakatimeConnector } from "./wakatime.js"

export function buildConnectors(env: Env): Connector[] {
  const connectors: Connector[] = []
  if (env.LASTFM_API_KEY && env.LASTFM_USER) {
    connectors.push(
      createLastfmConnector({
        apiKey: env.LASTFM_API_KEY,
        user: env.LASTFM_USER,
      })
    )
  }
  if (env.GITHUB_USER) {
    connectors.push(
      createGithubConnector({
        user: env.GITHUB_USER,
        token: env.GITHUB_TOKEN,
      })
    )
  }
  // github-stats EXIGE token (GraphQL no acepta requests anónimas).
  if (env.GITHUB_USER && env.GITHUB_TOKEN) {
    connectors.push(
      createGithubStatsConnector({
        user: env.GITHUB_USER,
        token: env.GITHUB_TOKEN,
      })
    )
  }
  if (env.WAKATIME_API_KEY) {
    connectors.push(createWakatimeConnector({ apiKey: env.WAKATIME_API_KEY }))
  }
  if (env.STEAM_API_KEY && env.STEAM_ID) {
    connectors.push(
      createSteamConnector({ apiKey: env.STEAM_API_KEY, steamId: env.STEAM_ID })
    )
  }
  return connectors
}
