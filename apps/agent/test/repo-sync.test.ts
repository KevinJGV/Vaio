import { describe, expect, it } from "vitest"
import { DEFAULT_REPO_POLICY, type TreeEntry } from "../src/core/repo-ingest.js"
import {
  compareFreshness,
  coverageGap,
  diffRepoTree,
  type IndexedFile,
  isInlineSync,
} from "../src/core/repo-sync.js"

function blob(path: string, sha: string, size = 10): TreeEntry {
  return { path, type: "blob", sha, size }
}

describe("diffRepoTree", () => {
  it("manifest vacío → todo lo kept va a toEmbed (primer sync = full)", () => {
    const tree = [blob("README.md", "a"), blob("src/x.ts", "b")]
    const d = diffRepoTree(tree, [], DEFAULT_REPO_POLICY)
    expect(d.toEmbed.map((e) => e.path).sort()).toEqual([
      "README.md",
      "src/x.ts",
    ])
    expect(d.toDelete).toEqual([])
    expect(d.unchanged).toBe(0)
  })

  it("todos los SHA iguales → no-op (toEmbed vacío, unchanged = kept)", () => {
    const tree = [blob("README.md", "a"), blob("src/x.ts", "b")]
    const indexed: IndexedFile[] = [
      { path: "README.md", blobSha: "a" },
      { path: "src/x.ts", blobSha: "b" },
    ]
    const d = diffRepoTree(tree, indexed, DEFAULT_REPO_POLICY)
    expect(d.toEmbed).toEqual([])
    expect(d.unchanged).toBe(2)
    expect(d.toDelete).toEqual([])
  })

  it("un SHA cambiado → solo ese a toEmbed, el resto unchanged", () => {
    const tree = [blob("README.md", "a2"), blob("src/x.ts", "b")]
    const indexed: IndexedFile[] = [
      { path: "README.md", blobSha: "a" },
      { path: "src/x.ts", blobSha: "b" },
    ]
    const d = diffRepoTree(tree, indexed, DEFAULT_REPO_POLICY)
    expect(d.toEmbed.map((e) => e.path)).toEqual(["README.md"])
    expect(d.unchanged).toBe(1)
  })

  it("archivo nuevo → toEmbed; archivo desaparecido del árbol → toDelete", () => {
    const tree = [blob("README.md", "a"), blob("src/nuevo.ts", "n")]
    const indexed: IndexedFile[] = [
      { path: "README.md", blobSha: "a" },
      { path: "src/viejo.ts", blobSha: "v" },
    ]
    const d = diffRepoTree(tree, indexed, DEFAULT_REPO_POLICY)
    expect(d.toEmbed.map((e) => e.path)).toEqual(["src/nuevo.ts"])
    expect(d.toDelete).toEqual(["src/viejo.ts"])
  })

  it("rename = delete del path viejo + add del nuevo (aunque el SHA sea igual)", () => {
    const tree = [blob("src/renamed.ts", "same")]
    const indexed: IndexedFile[] = [
      { path: "src/original.ts", blobSha: "same" },
    ]
    const d = diffRepoTree(tree, indexed, DEFAULT_REPO_POLICY)
    expect(d.toEmbed.map((e) => e.path)).toEqual(["src/renamed.ts"])
    expect(d.toDelete).toEqual(["src/original.ts"])
  })

  it("archivo que ahora cae en un filtro (node_modules) y estaba indexado → toDelete", () => {
    const tree = [blob("README.md", "a"), blob("node_modules/dep/x.js", "z")]
    const indexed: IndexedFile[] = [
      { path: "README.md", blobSha: "a" },
      { path: "node_modules/dep/x.js", blobSha: "z" },
    ]
    const d = diffRepoTree(tree, indexed, DEFAULT_REPO_POLICY)
    // node_modules nunca es kept → no se re-embebe, y como estaba indexado → se borra
    expect(d.toEmbed).toEqual([])
    expect(d.toDelete).toEqual(["node_modules/dep/x.js"])
  })
})

describe("compareFreshness", () => {
  it("sin SHA guardado → untracked", () => {
    expect(compareFreshness("abc", null).state).toBe("untracked")
    expect(compareFreshness("abc", undefined).state).toBe("untracked")
  })
  it("SHA igual → fresh; distinto → stale", () => {
    expect(compareFreshness("abc", "abc").state).toBe("fresh")
    expect(compareFreshness("abc", "def").state).toBe("stale")
  })
})

describe("coverageGap", () => {
  it("índice completo → sin faltantes", () => {
    const tree = [blob("README.md", "a"), blob("src/x.ts", "b")]
    const indexed: IndexedFile[] = [
      { path: "README.md", blobSha: "a" },
      { path: "src/x.ts", blobSha: "b" },
    ]
    expect(coverageGap(tree, indexed, [], DEFAULT_REPO_POLICY)).toEqual([])
  })

  it("cap-bajo: archivos kept sin chunk en el manifest → faltantes", () => {
    const tree = [
      blob("README.md", "a"),
      blob("src/x.ts", "b"),
      blob("src/y.ts", "c"),
    ]
    const indexed: IndexedFile[] = [{ path: "README.md", blobSha: "a" }]
    expect(coverageGap(tree, indexed, [], DEFAULT_REPO_POLICY).sort()).toEqual([
      "src/x.ts",
      "src/y.ts",
    ])
  })

  it("tombstones NO cuentan como faltantes (descartados a propósito)", () => {
    const tree = [blob("README.md", "a"), blob("src/leaky.ts", "s1")]
    const indexed: IndexedFile[] = [{ path: "README.md", blobSha: "a" }]
    // src/leaky.ts no está indexado PERO es tombstone → no es un faltante real.
    expect(
      coverageGap(
        tree,
        indexed,
        [{ path: "src/leaky.ts" }],
        DEFAULT_REPO_POLICY
      )
    ).toEqual([])
  })

  it("archivos filtrados (node_modules) no son kept → no cuentan", () => {
    const tree = [blob("README.md", "a"), blob("node_modules/d/x.js", "z")]
    const indexed: IndexedFile[] = [{ path: "README.md", blobSha: "a" }]
    // node_modules nunca es kept → aunque no esté indexado, no es un faltante.
    expect(coverageGap(tree, indexed, [], DEFAULT_REPO_POLICY)).toEqual([])
  })

  it("manifest vacío (nada indexado) → todo lo kept es faltante", () => {
    const tree = [blob("README.md", "a"), blob("src/x.ts", "b")]
    expect(coverageGap(tree, [], [], DEFAULT_REPO_POLICY).sort()).toEqual([
      "README.md",
      "src/x.ts",
    ])
  })
})

describe("isInlineSync", () => {
  it("pocos archivos a embeber → inline; muchos → no", () => {
    const mk = (n: number) => ({
      toEmbed: Array.from({ length: n }, (_, i) => blob(`f${i}.ts`, `${i}`)),
      toDelete: [],
      unchanged: 0,
    })
    expect(isInlineSync(mk(3), 20)).toBe(true)
    expect(isInlineSync(mk(20), 20)).toBe(true)
    expect(isInlineSync(mk(21), 20)).toBe(false)
  })
})
