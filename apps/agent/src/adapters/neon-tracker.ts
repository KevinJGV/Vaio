// Adapter del RepoTracker: estado de sync por repo (tabla `tracked_repos`) con Drizzle sobre Neon.
// upsert idempotente por `source` (PK) → cada sync actualiza la fila.

import { eq, sql } from "drizzle-orm"
import type { RepoTracker, TrackedRepo } from "../ports/repo-tracker.js"
import type { Database } from "./db/client.js"
import { trackedRepos } from "./db/schema.js"

export function createRepoTracker(db: Database): RepoTracker {
  return {
    async get(source: string): Promise<TrackedRepo | null> {
      const [row] = await db
        .select()
        .from(trackedRepos)
        .where(eq(trackedRepos.source, source))
        .limit(1)
      if (!row) return null
      return {
        source: row.source,
        owner: row.owner,
        repo: row.repo,
        branch: row.branch,
        lastCommitSha: row.lastCommitSha,
        lastTreeSha: row.lastTreeSha,
        policyVersion: row.policyVersion,
      }
    },

    async upsert(rec): Promise<void> {
      const set = {
        owner: rec.owner,
        repo: rec.repo,
        branch: rec.branch,
        lastCommitSha: rec.lastCommitSha,
        lastTreeSha: rec.lastTreeSha,
        policyVersion: rec.policyVersion,
        lastSyncedAt: sql`now()`,
        lastStatus: rec.status,
        embeddedCount: rec.embedded,
        deletedCount: rec.deleted,
      }
      await db
        .insert(trackedRepos)
        .values({ source: rec.source, ...set })
        .onConflictDoUpdate({ target: trackedRepos.source, set })
    },
  }
}
