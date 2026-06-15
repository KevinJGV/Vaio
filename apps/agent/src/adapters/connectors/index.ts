// Registry de CONECTORES: arma la lista de conectores habilitados (gated por keys). Sumar una fuente nueva
// (WakaTime, Steam, GitHub-stats, …) = nuevo archivo con su Connector + un push acá. Espeja el registry de actions.

import type { Env } from "../../config.js"
import type { Connector } from "../../ports/connector.js"
import { createGithubConnector } from "./github.js"
import { createLastfmConnector } from "./lastfm.js"

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
  return connectors
}
