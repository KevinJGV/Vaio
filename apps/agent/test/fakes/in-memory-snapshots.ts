import { hashContent } from "../../src/core/trends.js"
import type {
  ConnectorSnapshot,
  SnapshotStore,
} from "../../src/ports/snapshot-store.js"

const FIXED = new Date(0) // determinístico (sin Date.now)

/** Fake en memoria del SnapshotStore (contrato; el SQL real va por e2e). Dedup por hash del último del source. */
export function inMemorySnapshots(): SnapshotStore & {
  rows: () => ConnectorSnapshot[]
} {
  const rows: (ConnectorSnapshot & { hash: string })[] = []
  return {
    rows: () => rows.map((r) => ({ ...r })),
    async append({ source, content, capturedAt }) {
      const hash = hashContent(content)
      const last = [...rows]
        .filter((r) => r.source === source)
        .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())[0]
      if (last?.hash === hash) return false
      rows.push({ source, content, capturedAt: capturedAt ?? FIXED, hash })
      return true
    },
    async listRecent(source, n) {
      return [...rows]
        .filter((r) => r.source === source)
        .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())
        .slice(0, n)
        .map((r) => ({
          source: r.source,
          capturedAt: r.capturedAt,
          content: r.content,
        }))
    },
    async prune(source, keep) {
      const keepSet = new Set(
        [...rows]
          .filter((r) => r.source === source)
          .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())
          .slice(0, keep)
      )
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i]
        if (r && r.source === source && !keepSet.has(r)) rows.splice(i, 1)
      }
    },
  }
}
