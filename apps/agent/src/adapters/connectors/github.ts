// Conector GitHub — UNA fuente, dos facetas:
//  - live(): actividad de código reciente (pushes/commits). Best-effort → null. Latencia eventos 30s–6h.
//  - collect(): perfil + repos públicos → DocChunk[] para la memoria (persist, snapshot).

import type { Connector } from "../../ports/connector.js"
import type { DocChunk } from "../../ports/memory.js"
import { githubApi } from "../sources/github-api.js"
import { toChunks } from "../sources/util.js"

interface GhEvent {
  type: string
  repo: { name: string }
  payload: { commits?: { message: string }[]; ref?: string }
}
interface GithubProfile {
  name: string | null
  bio: string | null
  public_repos: number
  followers: number
}
interface GithubRepo {
  name: string
  description: string | null
  language: string | null
  stargazers_count: number
  topics?: string[]
  html_url: string
  fork: boolean
  archived: boolean
}

function branchOf(ref?: string): string | null {
  return ref?.replace(/^refs\/heads\//, "") ?? null
}

export function createGithubConnector(cfg: {
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
        const seen = new Set<string>()
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
            // PushEvent sin commits en el payload → "empujó a repo (branch)" (dedup por repo+branch).
            const branch = branchOf(e.payload.ref)
            const key = `${e.repo.name}@${branch ?? ""}`
            if (!seen.has(key)) {
              seen.add(key)
              items.push(branch ? `${e.repo.name} (${branch})` : e.repo.name)
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

    async collect(): Promise<DocChunk[]> {
      const profile = await githubApi<GithubProfile>(
        `/users/${cfg.user}`,
        cfg.token
      )
      const repos = await githubApi<GithubRepo[]>(
        `/users/${cfg.user}/repos?sort=updated&per_page=100`,
        cfg.token
      )
      const lines: string[] = [
        `Perfil GitHub de ${profile.name ?? cfg.user} (@${cfg.user}): ${profile.bio ?? "sin bio"}. ${profile.public_repos} repos públicos, ${profile.followers} seguidores.`,
      ]
      for (const r of repos) {
        if (r.fork || r.archived) continue
        const topics = r.topics?.length ? ` Temas: ${r.topics.join(", ")}.` : ""
        const lang = r.language ? ` Lenguaje: ${r.language}.` : ""
        lines.push(
          `Repo "${r.name}" (${r.stargazers_count}★): ${r.description ?? "sin descripción"}.${lang}${topics} ${r.html_url}`
        )
      }
      return toChunks(
        "github",
        `https://github.com/${cfg.user}`,
        lines.join("\n")
      )
    },
  }
}
