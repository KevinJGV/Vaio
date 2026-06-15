// Conector GitHub (faceta LIVE): actividad de código reciente de Kevin (pushes/commits). Best-effort → null.
// ⚠️ La API de eventos de GitHub tiene latencia 30s–6h → frasear "reciente", no "justo ahora".

import type { Connector } from "../../ports/connector.js"
import { githubApi } from "../sources/github-api.js"

interface GhEvent {
  type: string
  repo: { name: string }
  // `commits[].message` viene en el shape documentado, pero la API puede devolver PushEvents SIN commits
  // (solo `ref`) → fallback a repo+branch. Defensivo ante ambos shapes.
  payload: { commits?: { message: string }[]; ref?: string }
}

/** "refs/heads/main" → "main". */
function branchOf(ref?: string): string | null {
  return ref?.replace(/^refs\/heads\//, "") ?? null
}

export function createGithubActivityConnector(cfg: {
  user: string
  token?: string
}): Connector {
  return {
    name: "github",
    async live(): Promise<string | null> {
      try {
        const events = await githubApi<GhEvent[]>(
          `/users/${cfg.user}/events/public?per_page=30`,
          cfg.token
        )
        const items: string[] = []
        const seenRepoBranch = new Set<string>()
        for (const e of events) {
          if (e.type !== "PushEvent") continue
          const messages = (e.payload.commits ?? [])
            .map((c) => c.message.split("\n")[0]?.trim())
            .filter((m): m is string => Boolean(m))
          if (messages.length > 0) {
            for (const m of messages) {
              items.push(`${e.repo.name}: ${m}`)
              if (items.length >= 5) break
            }
          } else {
            // PushEvent sin commits en el payload → al menos "empujó a repo (branch)" (dedup por repo+branch).
            const branch = branchOf(e.payload.ref)
            const key = `${e.repo.name}@${branch ?? ""}`
            if (!seenRepoBranch.has(key)) {
              seenRepoBranch.add(key)
              items.push(
                branch ? `${e.repo.name} (${branch})` : e.repo.name
              )
            }
          }
          if (items.length >= 5) break
        }
        if (items.length === 0) return null
        return `💻 Actividad de código reciente de Kevin (pushes a): ${items.join("; ")}`
      } catch {
        return null
      }
    },
  }
}
