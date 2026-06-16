import { afterEach, describe, expect, it, vi } from "vitest"
import { createRepoSync, syncRepo } from "../src/adapters/sources/repo-sync.js"
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

  it("archivo tombstoned (skipped) al mismo blob_sha → NO se re-intenta", async () => {
    let leakyFetched = false
    mockGithub((url) => {
      if (url.includes("/commits/")) return { json: { sha: "c2" } } // stale
      if (url.includes("/git/trees/"))
        return {
          json: tree([
            { path: "README.md", sha: "a" }, // unchanged (en manifest)
            { path: "src/leaky.ts", sha: "s1" }, // tombstoned al sha s1 → NO re-intentar
          ]),
        }
      if (url.includes("/contents/src/leaky.ts")) {
        leakyFetched = true
        return { text: "no debería bajarse" }
      }
      return { text: "" }
    })
    const { mem, calls } = fakeMemory({
      "repo:kev/vaio": [{ path: "README.md", blobSha: "a" }],
    })
    const { tracker, upserts } = fakeTracker({
      source: "repo:kev/vaio",
      owner: "kev",
      repo: "vaio",
      branch: "main",
      lastCommitSha: "c1",
      lastTreeSha: "t",
      policyVersion: 1,
      skipped: [{ path: "src/leaky.ts", blobSha: "s1" }],
    })
    const r = await syncRepo(
      { owner: "kev", repo: "vaio", branch: "main" },
      { memory: mem, tracker, policy: DEFAULT_REPO_POLICY }
    )
    expect(leakyFetched).toBe(false) // ni se baja
    expect(calls.replaceFile).not.toContain("src/leaky.ts")
    expect(r.unchanged).toBe(2) // README + tombstone ambos "ya procesados"
    const up = upserts[0] as { skipped: { path: string }[] }
    expect(up.skipped.map((s) => s.path)).toContain("src/leaky.ts") // se preserva
  })

  it("archivo con secret → se descarta y queda como tombstone", async () => {
    mockGithub((url) => {
      if (url.includes("/commits/")) return { json: { sha: "c2" } }
      if (url.includes("/git/trees/"))
        return { json: tree([{ path: "src/leaky.ts", sha: "s9" }]) }
      if (url.includes("/contents/"))
        return { text: 'const token = "supersecretvalue123"' }
      return {}
    })
    const { mem, calls } = fakeMemory({
      "repo:kev/vaio": [{ path: "old.ts", blobSha: "o" }],
    })
    const { tracker, upserts } = fakeTracker({
      source: "repo:kev/vaio",
      owner: "kev",
      repo: "vaio",
      branch: "main",
      lastCommitSha: "c1",
      lastTreeSha: "t",
      policyVersion: 1,
      skipped: [],
    })
    await syncRepo(
      { owner: "kev", repo: "vaio", branch: "main" },
      { memory: mem, tracker, policy: DEFAULT_REPO_POLICY }
    )
    expect(calls.replaceFile).not.toContain("src/leaky.ts") // descartado, no indexado
    const up = upserts[0] as { skipped: { path: string; blobSha: string }[] }
    expect(up.skipped).toContainEqual({ path: "src/leaky.ts", blobSha: "s9" }) // tombstone
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

describe("createRepoSync.ensureFresh (freshness gate)", () => {
  function trackedFresh(): TrackedRepo {
    return {
      source: "repo:kev/vaio",
      owner: "kev",
      repo: "vaio",
      branch: "main",
      lastCommitSha: "c1",
      lastTreeSha: "t",
      policyVersion: 1,
    }
  }

  it("ignora sources que no sean repo:* (sin fetch)", async () => {
    let fetches = 0
    mockGithub(() => {
      fetches++
      return {}
    })
    const { mem } = fakeMemory()
    const { tracker } = fakeTracker(null)
    const rs = createRepoSync({
      memory: mem,
      tracker,
      policy: DEFAULT_REPO_POLICY,
    })
    const r = await rs.ensureFresh(["cv", "lastfm", "fact"])
    expect(r.refreshed).toBe(false)
    expect(fetches).toBe(0)
  })

  it("fresh → refreshed:false; y el TTL evita un 2º chequeo", async () => {
    let commitFetches = 0
    mockGithub((url) => {
      if (url.includes("/commits/")) {
        commitFetches++
        return { json: { sha: "c1" } } // == lastCommitSha → fresh
      }
      return {}
    })
    const { mem } = fakeMemory({
      "repo:kev/vaio": [{ path: "a", blobSha: "x" }],
    })
    const { tracker } = fakeTracker(trackedFresh())
    const rs = createRepoSync({
      memory: mem,
      tracker,
      policy: DEFAULT_REPO_POLICY,
      freshnessTtlMs: 60_000,
    })
    expect((await rs.ensureFresh(["repo:kev/vaio"])).refreshed).toBe(false)
    expect((await rs.ensureFresh(["repo:kev/vaio"])).refreshed).toBe(false)
    expect(commitFetches).toBe(1) // 2ª llamada cae en el TTL → no rechequea
  })

  it("guard de in-flight: una 2ª sync concurrente del mismo repo se saltea", async () => {
    mockGithub((url) => {
      if (url.includes("/commits/")) return { json: { sha: "c2" } }
      if (url.includes("/git/trees/"))
        return { json: tree([{ path: "README.md", sha: "a2" }]) }
      if (url.includes("/contents/")) return { text: "# x" }
      return {}
    })
    // replaceFile que se cuelga hasta soltar el gate → mantiene el 1er sync "en vuelo".
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const { mem } = fakeMemory({
      "repo:kev/vaio": [{ path: "README.md", blobSha: "a" }],
    })
    const slowMem = {
      ...mem,
      replaceFile: async () => {
        await gate
      },
    }
    const { tracker } = fakeTracker(trackedFresh())
    const rs = createRepoSync({
      memory: slowMem,
      tracker,
      policy: DEFAULT_REPO_POLICY,
    })
    const spec = { owner: "kev", repo: "vaio", branch: "main" }
    const p1 = rs.sync(spec) // arranca, se cuelga en replaceFile (in-flight)
    await new Promise((r) => setTimeout(r, 5)) // dejar que p1 entre a replaceFile
    const r2 = await rs.sync(spec) // 2ª concurrente → guard → skipped
    expect(r2.mode).toBe("skipped-fresh")
    release()
    await p1
  })

  it("stale → NUNCA inline: refreshed:false (responde con lo indexado) y dispara el sync en BACKGROUND", async () => {
    mockGithub((url) => {
      if (url.includes("/commits/")) return { json: { sha: "c2" } } // != c1 → stale
      if (url.includes("/git/trees/"))
        return { json: tree([{ path: "README.md", sha: "a2" }]) }
      if (url.includes("/contents/")) return { text: "# nuevo" }
      return {}
    })
    const { mem, calls } = fakeMemory({
      "repo:kev/vaio": [{ path: "README.md", blobSha: "a" }],
    })
    const { tracker } = fakeTracker(trackedFresh())
    const rs = createRepoSync({
      memory: mem,
      tracker,
      policy: DEFAULT_REPO_POLICY,
    })
    const r = await rs.ensureFresh(["repo:kev/vaio"])
    // NO se aplicó inline → el turno NO re-recupera (responde rápido con el índice actual).
    expect(r.refreshed).toBe(false)
    // pero MARCA `behind` (el repo estaba atrás + se está actualizando) → searchMemory lo surfacea al modelo.
    expect(r.behind).toBe(true)
    // y el sync SÍ se disparó en background (no se esperó); converge fuera del hot path.
    await vi.waitFor(() => expect(calls.replaceFile).toEqual(["README.md"]))
  })

  it("fresh → behind:false (no avisa de staleness si está al día)", async () => {
    mockGithub((url) => {
      if (url.includes("/commits/")) return { json: { sha: "c1" } } // == lastCommitSha → fresh
      return {}
    })
    const { mem } = fakeMemory({
      "repo:kev/vaio": [{ path: "a", blobSha: "x" }],
    })
    const { tracker } = fakeTracker(trackedFresh())
    const rs = createRepoSync({
      memory: mem,
      tracker,
      policy: DEFAULT_REPO_POLICY,
    })
    const r = await rs.ensureFresh(["repo:kev/vaio"])
    expect(r.behind).toBe(false)
  })
})

describe("createRepoSync.ensureRepoReady (repo nombrado)", () => {
  function trackedFresh(): TrackedRepo {
    return {
      source: "repo:kev/vaio",
      owner: "kev",
      repo: "vaio",
      branch: "main",
      lastCommitSha: "c1",
      lastTreeSha: "t",
      policyVersion: 1,
    }
  }
  const spec = { owner: "kev", repo: "vaio", branch: "main" }

  it("sin lastCommitSha (untracked) → 'untracked', 0 requests GitHub", async () => {
    let fetches = 0
    mockGithub(() => {
      fetches++
      return {}
    })
    const { mem } = fakeMemory()
    const { tracker } = fakeTracker(null)
    const rs = createRepoSync({
      memory: mem,
      tracker,
      policy: DEFAULT_REPO_POLICY,
    })
    expect((await rs.ensureRepoReady(spec)).state).toBe("untracked")
    expect(fetches).toBe(0)
  })

  it("cap-bajo (faltan archivos) → 'incomplete' + dispara FULL en background (clearSource)", async () => {
    mockGithub((url) => {
      if (url.includes("/commits/")) return { json: { sha: "c1" } }
      if (url.includes("/git/trees/"))
        return {
          json: tree([
            { path: "README.md", sha: "a" },
            { path: "src/x.ts", sha: "b" }, // NO indexado → faltante
          ]),
        }
      if (url.includes("/contents/")) return { text: "const x = 1" }
      return {}
    })
    const { mem, calls } = fakeMemory({
      "repo:kev/vaio": [{ path: "README.md", blobSha: "a" }], // src/x.ts falta
    })
    const { tracker } = fakeTracker(trackedFresh())
    const rs = createRepoSync({
      memory: mem,
      tracker,
      policy: DEFAULT_REPO_POLICY,
    })
    expect((await rs.ensureRepoReady(spec)).state).toBe("incomplete")
    // El FULL en bg re-indexa todo (clearSource) y completa los faltantes.
    await vi.waitFor(() => expect(calls.clearSource).toEqual(["repo:kev/vaio"]))
    await vi.waitFor(() =>
      expect(calls.replaceFile.sort()).toEqual(["README.md", "src/x.ts"])
    )
  })

  it("completo pero SHA atrás → 'stale' + dispara INCREMENTAL en background (sin clearSource)", async () => {
    mockGithub((url) => {
      if (url.includes("/commits/")) return { json: { sha: "c2" } } // != c1 → stale
      if (url.includes("/git/trees/"))
        return { json: tree([{ path: "README.md", sha: "a2" }]) } // mismo path → cobertura completa
      if (url.includes("/contents/")) return { text: "# nuevo" }
      return {}
    })
    const { mem, calls } = fakeMemory({
      "repo:kev/vaio": [{ path: "README.md", blobSha: "a" }],
    })
    const { tracker } = fakeTracker(trackedFresh())
    const rs = createRepoSync({
      memory: mem,
      tracker,
      policy: DEFAULT_REPO_POLICY,
    })
    expect((await rs.ensureRepoReady(spec)).state).toBe("stale")
    await vi.waitFor(() => expect(calls.replaceFile).toEqual(["README.md"]))
    expect(calls.clearSource).toEqual([]) // incremental, no full
  })

  it("completo y al día → 'fresh', sin sync", async () => {
    mockGithub((url) => {
      if (url.includes("/commits/")) return { json: { sha: "c1" } } // == c1 → fresh
      if (url.includes("/git/trees/"))
        return { json: tree([{ path: "README.md", sha: "a" }]) }
      return {}
    })
    const { mem, calls } = fakeMemory({
      "repo:kev/vaio": [{ path: "README.md", blobSha: "a" }],
    })
    const { tracker } = fakeTracker(trackedFresh())
    const rs = createRepoSync({
      memory: mem,
      tracker,
      policy: DEFAULT_REPO_POLICY,
    })
    expect((await rs.ensureRepoReady(spec)).state).toBe("fresh")
    expect(calls.replaceFile).toEqual([])
  })

  it("árbol truncado → ignora cobertura, decide por SHA (fresh)", async () => {
    mockGithub((url) => {
      if (url.includes("/commits/")) return { json: { sha: "c1" } }
      if (url.includes("/git/trees/"))
        return {
          json: { sha: "tr", truncated: true, tree: [] }, // truncado → no confiar en faltantes
        }
      return {}
    })
    const { mem, calls } = fakeMemory({
      "repo:kev/vaio": [{ path: "README.md", blobSha: "a" }],
    })
    const { tracker } = fakeTracker(trackedFresh())
    const rs = createRepoSync({
      memory: mem,
      tracker,
      policy: DEFAULT_REPO_POLICY,
    })
    expect((await rs.ensureRepoReady(spec)).state).toBe("fresh")
    expect(calls.clearSource).toEqual([]) // no dispara full por un árbol truncado
  })

  it("TTL: 2º chequeo dentro del TTL → 'fresh' sin re-bajar el árbol", async () => {
    let treeFetches = 0
    mockGithub((url) => {
      if (url.includes("/commits/")) return { json: { sha: "c1" } }
      if (url.includes("/git/trees/")) {
        treeFetches++
        return { json: tree([{ path: "README.md", sha: "a" }]) }
      }
      return {}
    })
    const { mem } = fakeMemory({
      "repo:kev/vaio": [{ path: "README.md", blobSha: "a" }],
    })
    const { tracker } = fakeTracker(trackedFresh())
    const rs = createRepoSync({
      memory: mem,
      tracker,
      policy: DEFAULT_REPO_POLICY,
      freshnessTtlMs: 60_000,
    })
    await rs.ensureRepoReady(spec)
    expect((await rs.ensureRepoReady(spec)).state).toBe("fresh")
    expect(treeFetches).toBe(1) // 2ª cae en el TTL
  })
})
