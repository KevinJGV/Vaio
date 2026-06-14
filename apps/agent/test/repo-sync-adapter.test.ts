import { afterEach, describe, expect, it, vi } from "vitest"
import { syncRepo } from "../src/adapters/sources/repo-sync.js"
import { DEFAULT_REPO_POLICY } from "../src/core/repo-ingest.js"
import type { DocChunk, IndexedFile, MemoryStore } from "../src/ports/memory.js"
import type { RepoTracker, TrackedRepo } from "../src/ports/repo-tracker.js"

/** Mock de fetch que rutea por URL (JSON para githubApi, texto para githubRaw). */
function mockGithub(
  routes: (url: string) => { json?: unknown; text?: string }
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const r = routes(String(input))
      return {
        ok: true,
        status: 200,
        json: async () => r.json ?? {},
        text: async () => r.text ?? "",
      }
    })
  )
}

afterEach(() => vi.unstubAllGlobals())

function fakeMemory(initial: Record<string, IndexedFile[]> = {}) {
  const indexed: Record<string, IndexedFile[]> = { ...initial }
  const calls = {
    replaceFile: [] as string[],
    deleteFiles: [] as string[][],
    clearSource: [] as string[],
  }
  const mem: MemoryStore = {
    searchMemory: async () => [],
    upsertDocuments: async () => {},
    clearSource: async (s) => {
      calls.clearSource.push(s)
      indexed[s] = []
    },
    listIndexedFiles: async (s) => indexed[s] ?? [],
    deleteFiles: async (_s, paths) => {
      calls.deleteFiles.push(paths)
    },
    replaceFile: async (_s, path, _rows: DocChunk[]) => {
      calls.replaceFile.push(path)
    },
  }
  return { mem, calls }
}

function fakeTracker(initial: TrackedRepo | null) {
  let rec = initial
  const upserts: unknown[] = []
  const tracker: RepoTracker = {
    get: async () => rec,
    upsert: async (r) => {
      upserts.push(r)
      rec = r
    },
  }
  return { tracker, upserts }
}

const tree = (entries: { path: string; sha: string }[]) => ({
  sha: "treeSha",
  truncated: false,
  tree: entries.map((e) => ({
    path: e.path,
    type: "blob",
    size: 10,
    sha: e.sha,
  })),
})

describe("syncRepo", () => {
  it("fresh (HEAD == last_commit_sha, misma policy) → skipped-fresh, sin bajar árbol", () => {
    return (async () => {
      let treeFetched = false
      mockGithub((url) => {
        if (url.includes("/commits/")) return { json: { sha: "c1" } }
        if (url.includes("/git/trees/")) {
          treeFetched = true
          return { json: tree([]) }
        }
        return {}
      })
      const { mem } = fakeMemory()
      const { tracker } = fakeTracker({
        source: "repo:kev/vaio",
        owner: "kev",
        repo: "vaio",
        branch: "main",
        lastCommitSha: "c1",
        lastTreeSha: "t",
        policyVersion: 1,
      })
      const r = await syncRepo(
        { owner: "kev", repo: "vaio", branch: "main" },
        { memory: mem, tracker, policy: DEFAULT_REPO_POLICY }
      )
      expect(r.mode).toBe("skipped-fresh")
      expect(treeFetched).toBe(false)
    })()
  })

  it("stale incremental → re-embebe SOLO el archivo cambiado", async () => {
    mockGithub((url) => {
      if (url.includes("/commits/")) return { json: { sha: "c2" } }
      if (url.includes("/git/trees/"))
        return {
          json: tree([
            { path: "README.md", sha: "a" },
            { path: "src/x.ts", sha: "b2" },
          ]),
        }
      if (url.includes("/contents/src/x.ts")) return { text: "const x = 2" }
      return { text: "" }
    })
    const { mem, calls } = fakeMemory({
      "repo:kev/vaio": [
        { path: "README.md", blobSha: "a" },
        { path: "src/x.ts", blobSha: "b" },
      ],
    })
    const { tracker, upserts } = fakeTracker({
      source: "repo:kev/vaio",
      owner: "kev",
      repo: "vaio",
      branch: "main",
      lastCommitSha: "c1",
      lastTreeSha: "t",
      policyVersion: 1,
    })
    const r = await syncRepo(
      { owner: "kev", repo: "vaio", branch: "main" },
      { memory: mem, tracker, policy: DEFAULT_REPO_POLICY }
    )
    expect(r.mode).toBe("incremental")
    expect(calls.replaceFile).toEqual(["src/x.ts"]) // README sin cambio → no se toca
    expect(r.unchanged).toBe(1)
    expect(upserts).toHaveLength(1)
  })

  it("untracked + manifest vacío (legacy) → clearSource one-shot + full", async () => {
    mockGithub((url) => {
      if (url.endsWith("/repos/kev/vaio"))
        return { json: { default_branch: "main" } }
      if (url.includes("/commits/")) return { json: { sha: "c1" } }
      if (url.includes("/git/trees/"))
        return { json: tree([{ path: "README.md", sha: "a" }]) }
      if (url.includes("/contents/")) return { text: "# hi" }
      return {}
    })
    const { mem, calls } = fakeMemory() // manifest vacío
    const { tracker } = fakeTracker(null) // untracked
    const r = await syncRepo(
      { owner: "kev", repo: "vaio" },
      { memory: mem, tracker, policy: DEFAULT_REPO_POLICY }
    )
    expect(r.mode).toBe("full")
    expect(calls.clearSource).toEqual(["repo:kev/vaio"])
    expect(calls.replaceFile).toEqual(["README.md"])
  })

  it("diff grande con inlineMaxFiles → deferred (no aplica nada)", async () => {
    mockGithub((url) => {
      if (url.includes("/commits/")) return { json: { sha: "c2" } }
      if (url.includes("/git/trees/"))
        return {
          json: tree([
            { path: "a.ts", sha: "1" },
            { path: "b.ts", sha: "2" },
            { path: "c.ts", sha: "3" },
          ]),
        }
      return { text: "x" }
    })
    const { mem, calls } = fakeMemory({
      "repo:kev/vaio": [{ path: "z.ts", blobSha: "0" }],
    })
    const { tracker } = fakeTracker({
      source: "repo:kev/vaio",
      owner: "kev",
      repo: "vaio",
      branch: "main",
      lastCommitSha: "c1",
      lastTreeSha: "t",
      policyVersion: 1,
    })
    const r = await syncRepo(
      { owner: "kev", repo: "vaio", branch: "main" },
      { memory: mem, tracker, policy: DEFAULT_REPO_POLICY },
      { inlineMaxFiles: 2 }
    )
    expect(r.mode).toBe("deferred")
    expect(calls.replaceFile).toEqual([]) // no aplicó nada
  })
})
