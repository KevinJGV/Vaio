import type { DocChunk } from "../../ports/memory.js"
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

async function githubApi<T>(path: string, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "vaio-ingest",
  }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch(`https://api.github.com${path}`, { headers })
  if (!res.ok) {
    // El body de error de GitHub (rate-limit, permisos) va en el mensaje → visible al loguear aguas arriba.
    const body = await res.text().catch(() => "")
    throw new Error(
      `GitHub ${path} → ${res.status}${body ? ` · ${body.slice(0, 200)}` : ""}`
    )
  }
  return (await res.json()) as T
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
