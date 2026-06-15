// Adapter de la serie temporal: implementa SnapshotStore con Drizzle sobre `connector_snapshots`. El dedup
// compara el hash del contenido con el último snapshot del source (el cálculo del hash es puro, en core/trends).

import { and, desc, eq, notInArray } from "drizzle-orm"
import { hashContent } from "../core/trends.js"
import type {
  ConnectorSnapshot,
  SnapshotStore,
} from "../ports/snapshot-store.js"
import type { Database } from "./db/client.js"
import { connectorSnapshots } from "./db/schema.js"

export function createSnapshotStore(db: Database): SnapshotStore {
  return {
    async append({ source, content, capturedAt }) {
      const hash = hashContent(content)
      const [last] = await db
        .select({ contentHash: connectorSnapshots.contentHash })
        .from(connectorSnapshots)
        .where(eq(connectorSnapshots.source, source))
        .orderBy(desc(connectorSnapshots.capturedAt))
        .limit(1)
      if (last?.contentHash === hash) return false // dedup: nada cambió desde la última captura
      await db.insert(connectorSnapshots).values({
        source,
        content,
        contentHash: hash,
        ...(capturedAt ? { capturedAt } : {}), // sin capturedAt → default now()
      })
      return true
    },

    async listRecent(source, n): Promise<ConnectorSnapshot[]> {
      const rows = await db
        .select({
          source: connectorSnapshots.source,
          capturedAt: connectorSnapshots.capturedAt,
          content: connectorSnapshots.content,
        })
        .from(connectorSnapshots)
        .where(eq(connectorSnapshots.source, source))
        .orderBy(desc(connectorSnapshots.capturedAt))
        .limit(n)
      return rows.map((r) => ({
        source: r.source,
        capturedAt: r.capturedAt,
        content: r.content,
      }))
    },

    async prune(source, keep): Promise<void> {
      const recent = await db
        .select({ id: connectorSnapshots.id })
        .from(connectorSnapshots)
        .where(eq(connectorSnapshots.source, source))
        .orderBy(desc(connectorSnapshots.capturedAt))
        .limit(keep)
      const keepIds = recent.map((r) => r.id)
      if (keepIds.length === 0) return
      await db
        .delete(connectorSnapshots)
        .where(
          and(
            eq(connectorSnapshots.source, source),
            notInArray(connectorSnapshots.id, keepIds)
          )
        )
    },
  }
}
