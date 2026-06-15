// Orquestador del SYNC INCREMENTAL de un repo (I/O). Reusa la maquinaria de la ingesta (pasos 1+2): GitHub API,
// filtros, secret-scan, chunkers. Flujo: frescura barata → si fresh, skip (0 embeddings) → si stale: árbol → diff
// (blob-SHA) → borrar lo que sobra → re-embeber SOLO lo cambiado (replaceFile atómico por archivo) → actualizar
// tracked_repos AL FINAL (idempotente ante corte). Degrada/best-effort: un fallo no corrompe el índice.

import type { RawRepoSpec } from "../../config.js"
import { chunkText } from "../../core/chunking.js"
import { chunkCode, withProvenanceHeader } from "../../core/code-chunking.js"
import {
  DEFAULT_REPO_POLICY,
  ingestPriority,
  isProbablyText,
  isProseFile,
  languageOf,
  type RepoIngestPolicy,
} from "../../core/repo-ingest.js"
import {
  compareFreshness,
  diffRepoTree,
  type FreshnessResult,
  isInlineSync,
} from "../../core/repo-sync.js"
import { hasSecret } from "../../core/secret-scan.js"
import type { Logger } from "../../ports/logger.js"
import type { DocChunk, MemoryStore } from "../../ports/memory.js"
import type { RepoSyncPort } from "../../ports/repo-sync.js"
import type { RepoTracker } from "../../ports/repo-tracker.js"
import { githubApi, githubRaw } from "./github-api.js"

/** Versión del chunker/policy. Si cambia la forma de trocear/filtrar, bump → fuerza full (el blob-SHA no
 *  cambiaría pero los chunks sí). */
export const POLICY_VERSION = 1

export interface SyncRepoDeps {
  memory: MemoryStore
  tracker: RepoTracker
  token?: string
  policy?: RepoIngestPolicy
  logger?: Logger
  /** TTL del freshness gate (ms): no rechequea un repo si lo hizo hace menos. Default 10 min. */
  freshnessTtlMs?: number
  /** Umbral de archivos para sync inline vs diferido en el gate. Default 20. */
  inlineMaxFiles?: number
}

/** Parsea un source `repo:owner/repo` → spec; null si no es un source de repo. */
function parseRepoSource(source: string): RawRepoSpec | null {
  if (!source.startsWith("repo:")) return null
  const [owner, repo] = source.slice("repo:".length).split("/")
  if (!owner || !repo) return null
  return { owner, repo }
}

export type SyncMode =
  | "full"
  | "incremental"
  | "skipped-fresh"
  | "partial"
  | "error"
  /** El diff incremental superó `inlineMaxFiles` → no se aplicó (el llamador debe correrlo en background). */
  | "deferred"

export interface SyncReport {
  source: string
  mode: SyncMode
  embedded: number
  deleted: number
  unchanged: number
}

interface RepoMeta {
  default_branch: string
}
interface CommitRef {
  sha: string
}
interface TreeResponse {
  sha: string
  tree: { path: string; type: string; size?: number; sha: string }[]
  truncated: boolean
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/")
}

/** HEAD del branch (1 request, sin contenido). */
async function remoteHead(
  slug: string,
  branch: string,
  token?: string
): Promise<string> {
  const c = await githubApi<CommitRef>(
    `/repos/${slug}/commits/${encodeURIComponent(branch)}`,
    token
  )
  return c.sha
}

/** Chequeo de frescura BARATO. `untracked` no necesita llamada (sin SHA con qué comparar → full igual). */
export async function repoFreshness(
  spec: RawRepoSpec,
  deps: { tracker: RepoTracker; token?: string }
): Promise<FreshnessResult> {
  const source = `repo:${spec.owner}/${spec.repo}`
  const tracked = await deps.tracker.get(source)
  if (!tracked?.lastCommitSha) {
    return { state: "untracked", remoteCommitSha: "" }
  }
  const branch = spec.branch ?? tracked.branch
  const slug = `${spec.owner}/${spec.repo}`
  const head = await remoteHead(slug, branch, deps.token)
  return compareFreshness(head, tracked.lastCommitSha)
}

/** Sincroniza UN repo incrementalmente. */
export async function syncRepo(
  spec: RawRepoSpec,
  deps: SyncRepoDeps,
  opts?: { inlineMaxFiles?: number; forceFull?: boolean }
): Promise<SyncReport> {
  const { memory, tracker, token, logger } = deps
  const policy = deps.policy ?? DEFAULT_REPO_POLICY
  const slug = `${spec.owner}/${spec.repo}`
  const source = `repo:${slug}`

  try {
    const tracked = await tracker.get(source)
    const branch =
      spec.branch ??
      tracked?.branch ??
      (await githubApi<RepoMeta>(`/repos/${slug}`, token)).default_branch

    // Frescura: si el HEAD no cambió Y la policy es la misma → skip total (0 embeddings).
    const head = await remoteHead(slug, branch, token)
    const fresh =
      compareFreshness(head, tracked?.lastCommitSha).state === "fresh"
    const samePolicy =
      (tracked?.policyVersion ?? POLICY_VERSION) === POLICY_VERSION
    if (fresh && samePolicy && !opts?.forceFull) {
      return {
        source,
        mode: "skipped-fresh",
        embedded: 0,
        deleted: 0,
        unchanged: 0,
      }
    }

    // Árbol recursivo.
    const tree = await githubApi<TreeResponse>(
      `/repos/${slug}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      token
    )
    if (tree.truncated) {
      logger?.warn(
        { repo: slug },
        "sync: árbol truncado — sin borrar por ausencia"
      )
    }

    // Manifest + reconciliación legacy: si está vacío pero el source tiene filas viejas (path NULL), clearSource
    // one-shot y full. (clearSource sobre un source vacío es no-op → seguro para repos nuevos.)
    const manifest = await memory.listIndexedFiles(source)
    const isFull =
      manifest.length === 0 || !samePolicy || opts?.forceFull === true
    if (isFull) await memory.clearSource(source)

    // Tombstones: archivos descartados antes (secret/no-texto). Se cuentan como "ya procesados" en el diff
    // (mismo blob_sha → no se re-intentan); en full se descartan (re-evaluar todo desde cero).
    const prevSkipped = isFull ? [] : (tracked?.skipped ?? [])
    const skippedMap = new Map(prevSkipped.map((s) => [s.path, s.blobSha]))

    const diff = diffRepoTree(
      tree.tree.map((e) => ({
        path: e.path,
        type: e.type as "blob" | "tree" | "commit",
        ...(e.size != null ? { size: e.size } : {}),
        sha: e.sha,
      })),
      isFull ? [] : [...manifest, ...prevSkipped],
      policy
    )

    // Diferir si el diff incremental es grande (caso "sync largo" del chat): no aplicar nada acá; el llamador
    // lo corre en background. No aplica a full (legacy/primer sync, que va por el entrypoint offline sin opts).
    if (
      !isFull &&
      opts?.inlineMaxFiles != null &&
      !isInlineSync(diff, opts.inlineMaxFiles)
    ) {
      return {
        source,
        mode: "deferred",
        embedded: 0,
        deleted: 0,
        unchanged: diff.unchanged,
      }
    }

    // Borrar lo que sobra (salvo árbol truncado: una ausencia puede ser truncamiento, no borrado).
    if (!tree.truncated && diff.toDelete.length > 0) {
      await memory.deleteFiles(source, diff.toDelete)
      for (const path of diff.toDelete) skippedMap.delete(path) // si era tombstone, ya no aplica
    }

    // Re-embeber solo lo cambiado. Orden por prioridad: contenido (prosa→código) ANTES que los docs de proceso
    // (`docs/superpowers/`), para que el cap por repo no descarte el contenido real (i18n/cv.ts) por los logs de dev.
    const ordered = [...diff.toEmbed].sort(
      (a, b) => ingestPriority(a.path) - ingestPriority(b.path)
    )
    let embedded = 0
    let chunkCount = 0
    for (const entry of ordered) {
      if (chunkCount >= policy.maxChunksPerRepo) break
      try {
        const raw = await githubRaw(
          `/repos/${slug}/contents/${encodePath(entry.path)}?ref=${encodeURIComponent(branch)}`,
          token
        )
        // Si dejó de ser texto o trae un secret → quitar lo que hubiera, no indexar, y TOMBSTONE (registrar su
        // blob_sha) para no re-intentarlo en cada sync hasta que el archivo cambie.
        if (!isProbablyText(raw) || hasSecret(raw)) {
          await memory.deleteFiles(source, [entry.path])
          skippedMap.set(entry.path, entry.sha)
          if (hasSecret(raw)) {
            logger?.warn(
              { repo: slug, path: entry.path },
              "sync: archivo con secret → descartado (tombstone)"
            )
          }
          continue
        }
        const lang = languageOf(entry.path)
        const pieces = isProseFile(entry.path) ? chunkText(raw) : chunkCode(raw)
        const headers = withProvenanceHeader(pieces, {
          repo: slug,
          path: entry.path,
          lang,
        })
        const remaining = policy.maxChunksPerRepo - chunkCount
        const used = headers.slice(0, remaining)
        const url = `https://github.com/${slug}/blob/${branch}/${encodePath(entry.path)}`
        const rows: DocChunk[] = used.map((chunk) => ({
          source,
          url,
          chunk,
          path: entry.path,
          blobSha: entry.sha,
        }))
        await memory.replaceFile(source, entry.path, rows)
        skippedMap.delete(entry.path) // se indexó bien → ya no es tombstone
        chunkCount += used.length
        embedded++
      } catch (err) {
        logger?.warn(
          {
            repo: slug,
            path: entry.path,
            err: err instanceof Error ? err.message : "?",
          },
          "sync: fallo al bajar/embeber un archivo (se saltea)"
        )
      }
    }

    const status = tree.truncated ? "partial" : "ok"
    // Truncado → NO avanzar el commit sha (forzar reintento la próxima).
    await tracker.upsert({
      source,
      owner: spec.owner,
      repo: spec.repo,
      branch,
      lastCommitSha: tree.truncated ? (tracked?.lastCommitSha ?? null) : head,
      lastTreeSha: tree.sha,
      policyVersion: POLICY_VERSION,
      status,
      embedded,
      deleted: diff.toDelete.length,
      skipped: [...skippedMap].map(([path, blobSha]) => ({ path, blobSha })),
    })

    logger?.info(
      {
        repo: slug,
        mode: isFull ? "full" : "incremental",
        embedded,
        deleted: diff.toDelete.length,
        unchanged: diff.unchanged,
        status,
      },
      "repo sync"
    )
    return {
      source,
      mode: tree.truncated ? "partial" : isFull ? "full" : "incremental",
      embedded,
      deleted: diff.toDelete.length,
      unchanged: diff.unchanged,
    }
  } catch (err) {
    // Best-effort: un 404/red no corrompe el índice (no se borró nada por ausencia).
    logger?.error(
      { repo: slug, err: err instanceof Error ? err.message : String(err) },
      "sync: repo falló (se saltea)"
    )
    return { source, mode: "error", embedded: 0, deleted: 0, unchanged: 0 }
  }
}

/** Implementación del puerto `RepoSyncPort` con las deps atadas (para inyectar a las tools del harness). */
export function createRepoSync(deps: SyncRepoDeps): RepoSyncPort {
  const ttlMs = deps.freshnessTtlMs ?? 10 * 60 * 1000
  const inlineMaxFiles = deps.inlineMaxFiles ?? 20
  // Cache TTL del freshness gate (vida de proceso): source → último chequeo (ms epoch via performance.now base).
  const lastChecked = new Map<string, number>()
  return {
    async freshness(spec) {
      const r = await repoFreshness(spec, {
        tracker: deps.tracker,
        token: deps.token,
      })
      return { state: r.state }
    },
    async sync(spec, opts) {
      const r = await syncRepo(spec, deps, opts)
      return {
        mode: r.mode,
        embedded: r.embedded,
        deleted: r.deleted,
        unchanged: r.unchanged,
      }
    },
    async isTracked(spec) {
      return (
        (await deps.tracker.get(`repo:${spec.owner}/${spec.repo}`)) !== null
      )
    },
    async ensureFresh(sources) {
      let refreshed = false
      const now = Date.now()
      for (const source of sources) {
        const spec = parseRepoSource(source)
        if (!spec) continue // no-repo (cv/me/github/lastfm/fact) → no fresh-able acá
        const seen = lastChecked.get(source)
        if (seen != null && now - seen < ttlMs) continue // TTL: chequeado hace poco → confiar
        lastChecked.set(source, now)
        try {
          const f = await repoFreshness(spec, {
            tracker: deps.tracker,
            token: deps.token,
          })
          if (f.state !== "stale") continue
          const r = await syncRepo(spec, deps, { inlineMaxFiles })
          if (r.mode === "incremental" || r.mode === "full") {
            refreshed = true // se aplicó inline → re-recuperar para incluir lo fresco
          } else if (r.mode === "deferred") {
            // Diff grande → refresco completo en background (sin reanudación proactiva = incremento 2).
            void syncRepo(spec, deps).catch(() => {})
          }
        } catch (err) {
          deps.logger?.warn(
            { source, err: err instanceof Error ? err.message : "?" },
            "ensureFresh: chequeo de frescura falló (se ignora)"
          )
        }
      }
      return { refreshed }
    },
  }
}
