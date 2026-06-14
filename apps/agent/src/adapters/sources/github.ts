import type { DocChunk } from "../../ports/memory.js"
import { githubApi } from "./github-api.js"
import { toChunks } from "./util.js"

export interface GithubConfig {
  user: string
  token?: string
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

/** Perfil + repos públicos (no forks/archivados) de GitHub. */
export async function collectGithub(cfg: GithubConfig): Promise<DocChunk[]> {
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
  return toChunks("github", `https://github.com/${cfg.user}`, lines.join("\n"))
}
