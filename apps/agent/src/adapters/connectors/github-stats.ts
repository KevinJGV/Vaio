// Conector GitHub-stats — UNA fuente (GraphQL), dos facetas:
//  - live(): racha ACTUAL de contribuciones. Best-effort → null. (No duplica el live de `github` = pushes.)
//  - collect(): totales agregados (stars/commits/PRs/issues) + lenguajes reales por bytes + racha más larga.

import {
  aggregateLanguages,
  currentStreak,
  longestStreak,
  topByPercent,
} from "../../core/connector-stats.js"
import type { Connector } from "../../ports/connector.js"
import type { DocChunk } from "../../ports/memory.js"
import { githubGraphql } from "../sources/github-api.js"
import { toChunks } from "../sources/util.js"

const QUERY = `query($login:String!,$from:DateTime,$to:DateTime){
  user(login:$login){
    repositories(ownerAffiliations:OWNER,isFork:false,first:100){
      totalCount
      nodes{ stargazers{ totalCount }
             languages(first:10,orderBy:{field:SIZE,direction:DESC}){ edges{ size node{ name } } } }
    }
    contributionsCollection(from:$from,to:$to){
      totalCommitContributions totalPullRequestContributions totalIssueContributions
      contributionCalendar{ totalContributions weeks{ contributionDays{ contributionCount date } } }
    }
  }
}`

interface StatsResponse {
  user: {
    repositories: {
      totalCount: number
      nodes: {
        stargazers: { totalCount: number }
        languages: { edges: { size: number; node: { name: string } }[] }
      }[]
    }
    contributionsCollection: {
      totalCommitContributions: number
      totalPullRequestContributions: number
      totalIssueContributions: number
      contributionCalendar: {
        totalContributions: number
        weeks: {
          contributionDays: { contributionCount: number; date: string }[]
        }[]
      }
    }
  }
}

function flattenDays(resp: StatsResponse) {
  return resp.user.contributionsCollection.contributionCalendar.weeks.flatMap(
    (w) => w.contributionDays
  )
}

export function createGithubStatsConnector(cfg: {
  user: string
  token: string
}): Connector {
  const fetchStats = async (): Promise<StatsResponse> => {
    const now = new Date()
    const from = new Date(now)
    from.setFullYear(now.getFullYear() - 1)
    return githubGraphql<StatsResponse>(
      QUERY,
      { login: cfg.user, from: from.toISOString(), to: null },
      cfg.token
    )
  }

  return {
    name: "github-stats",

    async live(): Promise<string | null> {
      try {
        const resp = await fetchStats()
        const today = new Date().toISOString().slice(0, 10)
        const streak = currentStreak(flattenDays(resp), today)
        if (streak === 0) return null
        return `🔥 Kevin lleva ${streak} días de racha de contribuciones en GitHub`
      } catch {
        return null
      }
    },

    async collect(): Promise<DocChunk[]> {
      const resp = await fetchStats()
      const repos = resp.user.repositories
      const stars = repos.nodes.reduce(
        (acc, r) => acc + r.stargazers.totalCount,
        0
      )
      const cc = resp.user.contributionsCollection
      const langs = topByPercent(aggregateLanguages(repos.nodes), 5)
      const longest = longestStreak(flattenDays(resp))
      const text =
        `Stats de GitHub de Kevin (@${cfg.user}): ${repos.totalCount} repos públicos, ${stars} stars totales; ` +
        `el último año: ${cc.totalCommitContributions} commits, ${cc.totalPullRequestContributions} PRs, ` +
        `${cc.totalIssueContributions} issues (${cc.contributionCalendar.totalContributions} contribuciones). ` +
        `Racha más larga: ${longest} días.` +
        (langs ? ` Lenguajes top por código real: ${langs}.` : "")
      return toChunks("github-stats", `https://github.com/${cfg.user}`, text)
    },
  }
}
