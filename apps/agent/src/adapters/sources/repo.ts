// Collector de fuentes CRUDAS: lee md + código de repos curados (incl. el propio repo = self-awareness)
// vía GitHub API y los trocea para la memoria RAG. "Vaio se nutre solo" pasos 1+2. El I/O vive acá; toda
// la DECISIÓN (filtros, secrets, chunking, ¿es texto?) es pura en core/. Best-effort por repo y por archivo:
// un fallo loguea y sigue (nunca tira → no rompe la ingesta del resto). Reusa el flujo clearSource+upsert.

import type { RawRepoSpec } from "../../config.js"
import { chunkText } from "../../core/chunking.js"
import { chunkCode, withProvenanceHeader } from "../../core/code-chunking.js"
import {
  DEFAULT_REPO_POLICY,
  filterTree,
  isProbablyText,
  isProseFile,
  languageOf,
  type RepoIngestPolicy,
  type TreeEntry,
} from "../../core/repo-ingest.js"
import { hasSecret } from "../../core/secret-scan.js"
import type { Logger } from "../../ports/logger.js"
import type { DocChunk } from "../../ports/memory.js"
import { githubApi, githubRaw } from "./github-api.js"

export interface RawRepoConfig {
  repos: RawRepoSpec[]
  token?: string
  policy?: RepoIngestPolicy
  logger?: Logger
}

interface RepoMeta {
  default_branch: string
}
interface TreeResponse {
  tree: TreeEntry[]
  truncated: boolean
}

/** Codifica cada segmento del path preservando los "/" (para la URL de la Contents API y el blob). */
function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/")
}

/** Collector raw multi-repo. Devuelve los chunks de todos los repos que se pudieron ingerir. */
export async function collectRawRepo(cfg: RawRepoConfig): Promise<DocChunk[]> {
  const policy = cfg.policy ?? DEFAULT_REPO_POLICY
  const out: DocChunk[] = []

  for (const spec of cfg.repos) {
    const slug = `${spec.owner}/${spec.repo}`
    try {
      // 1. branch: el del spec, o el default del repo.
      const branch =
        spec.branch ??
        (await githubApi<RepoMeta>(`/repos/${slug}`, cfg.token)).default_branch

      // 2. árbol recursivo.
      const tree = await githubApi<TreeResponse>(
        `/repos/${slug}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
        cfg.token
      )
      if (tree.truncated) {
        cfg.logger?.warn(
          { repo: slug },
          "raw-repo: árbol truncado (>100k entries) — se ingiere lo que vino"
        )
      }

      // 3. filtrar (puro). Log de descartes agregado por reason (nada silencioso).
      const decision = filterTree(tree.tree ?? [], policy)
      const byReason: Record<string, number> = {}
      for (const s of decision.skipped) {
        byReason[s.reason] = (byReason[s.reason] ?? 0) + 1
      }

      // 4. orden prosa-primero: el cap por repo prioriza docs (lo más valioso para RAG).
      const ordered = [...decision.kept].sort(
        (a, b) => Number(isProseFile(b.path)) - Number(isProseFile(a.path))
      )

      // 5. por archivo: raw → ¿texto? → ¿secret? → chunk + header. Best-effort por archivo.
      let chunkCount = 0
      const runtimeSkips: Record<string, number> = {}
      let cappedFiles = 0
      const note = (reason: string) => {
        runtimeSkips[reason] = (runtimeSkips[reason] ?? 0) + 1
      }

      for (const entry of ordered) {
        if (chunkCount >= policy.maxChunksPerRepo) {
          cappedFiles++
          continue
        }
        try {
          const raw = await githubRaw(
            `/repos/${slug}/contents/${encodePath(entry.path)}?ref=${encodeURIComponent(branch)}`,
            cfg.token
          )
          if (!isProbablyText(raw)) {
            note("binary")
            continue
          }
          // Defensa en profundidad (capa 2): secret pegado en código legítimo → descarta el archivo entero.
          if (hasSecret(raw)) {
            note("secret-detected")
            cfg.logger?.warn(
              { repo: slug, path: entry.path },
              "raw-repo: archivo descartado por contener un secret"
            )
            continue
          }

          const lang = languageOf(entry.path)
          const pieces = isProseFile(entry.path)
            ? chunkText(raw)
            : chunkCode(raw)
          let chunks = withProvenanceHeader(pieces, {
            repo: slug,
            path: entry.path,
            lang,
          })

          // cap por repo: recortar si este archivo lo cruza (y marcar que paramos).
          const remaining = policy.maxChunksPerRepo - chunkCount
          if (chunks.length > remaining) {
            chunks = chunks.slice(0, remaining)
            cappedFiles++
          }

          const url = `https://github.com/${slug}/blob/${branch}/${encodePath(entry.path)}`
          for (const chunk of chunks) {
            out.push({ source: `repo:${slug}`, url, chunk })
          }
          chunkCount += chunks.length
        } catch (err) {
          note("fetch-failed")
          cfg.logger?.warn(
            {
              repo: slug,
              path: entry.path,
              err: err instanceof Error ? err.message : String(err),
            },
            "raw-repo: fallo al bajar un archivo (se saltea)"
          )
        }
      }

      if (cappedFiles > 0) {
        cfg.logger?.warn(
          { repo: slug, maxChunks: policy.maxChunksPerRepo, cappedFiles },
          "raw-repo: alcanzado el cap de chunks por repo — archivos sin ingerir"
        )
      }
      cfg.logger?.info(
        {
          repo: slug,
          branch,
          kept: decision.kept.length,
          chunks: chunkCount,
          skipped: byReason,
          runtimeSkips,
        },
        "raw-repo ingerido"
      )
    } catch (err) {
      // Best-effort por repo: un repo que falla (404/privado/rate-limit) no rompe los demás.
      cfg.logger?.error(
        {
          repo: slug,
          err: err instanceof Error ? err.message : String(err),
        },
        "raw-repo: repo falló (se saltea)"
      )
    }
  }

  return out
}
