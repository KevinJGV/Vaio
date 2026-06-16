// FreshnessDetector: si algún `repo:*` recuperado este turno está ATRÁS del remoto, avisa al modelo (nota del
// sistema) y deja que el gate dispare el sync en background. EXTRAÍDO de searchMemory (era el `behindNote`
// embebido) → searchMemory queda solo-contenido. El sync caro va en background; este probe solo consulta+informa.

import type { KnowledgeDetector } from "../../ports/knowledge-detector.js"
import type { RepoSyncPort } from "../../ports/repo-sync.js"

const BEHIND_NOTE =
  "[nota del sistema: tu copia indexada de uno de estos repos estaba un poco atrás de GitHub; ya se está actualizando sola en segundo plano. Respondé con lo que tenés, pero si la pregunta depende de cambios MUY recientes, aclaralo al pasar (que puede que aún no los tengas), sin dramatizar.]"

export function createFreshnessDetector(
  repoSync: RepoSyncPort
): KnowledgeDetector {
  return {
    name: "freshness",
    async detect({ retrievedSources }) {
      const repoSources = [
        ...new Set(retrievedSources.filter((s) => s.startsWith("repo:"))),
      ]
      if (repoSources.length === 0) return null
      try {
        // `ensureFresh` dispara el sync en background si está stale (no bloquea) y reporta `behind`.
        const { behind } = await repoSync.ensureFresh(repoSources)
        return behind ? { note: BEHIND_NOTE } : null
      } catch {
        return null // best-effort: la frescura nunca rompe el turno (Invariante #1)
      }
    },
  }
}
