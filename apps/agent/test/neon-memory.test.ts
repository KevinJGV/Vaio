import { describe, expect, it } from "vitest"
import type { Database } from "../src/adapters/db/client.js"
import { createMemoryStore } from "../src/adapters/neon-memory.js"
import type { DocChunk, Embedder } from "../src/ports/memory.js"

/** Fake mínimo de `db` que registra el ORDEN de las operaciones que hace `replaceFile`
 *  (db.delete / db.transaction → tx.delete / tx.insert). No modela rollback: sirve para
 *  afirmar la ESTRUCTURA (embed fuera de la tx), no la semántica transaccional de Postgres. */
function fakeDb() {
  const calls: string[] = []
  const tx = {
    delete: () => ({ where: async () => void calls.push("tx.delete") }),
    insert: () => ({ values: async () => void calls.push("tx.insert") }),
  }
  const db = {
    delete: () => ({ where: async () => void calls.push("db.delete") }),
    transaction: async (cb: (t: typeof tx) => Promise<void>) => {
      calls.push("tx.begin")
      await cb(tx)
    },
  }
  return { db: db as unknown as Database, calls }
}

const row: DocChunk = {
  source: "repo:k/v",
  url: "u",
  chunk: "const x = a ?? b",
  path: "a.ts",
  blobSha: "s1",
}

describe("neon-memory.replaceFile", () => {
  it("embebe ANTES de abrir la transacción (no retiene conexión del pool durante la red del embed)", async () => {
    const { db, calls } = fakeDb()
    const embedder: Embedder = {
      embed: async (texts) => {
        calls.push("embed")
        return texts.map(() => [0.1])
      },
    }
    const mem = createMemoryStore(db, embedder)
    await mem.replaceFile("repo:k/v", "a.ts", [row])
    // El embed ocurre antes de que la tx se abra (tx queda corta: solo delete+insert).
    expect(calls.indexOf("embed")).toBeLessThan(calls.indexOf("tx.begin"))
    expect(calls).toContain("tx.delete")
    expect(calls).toContain("tx.insert")
  })

  it("si el embed falla, NO abre la transacción ni toca la DB (nada a medias)", async () => {
    const { db, calls } = fakeDb()
    const embedder: Embedder = {
      embed: async () => {
        throw new Error("embed 429")
      },
    }
    const mem = createMemoryStore(db, embedder)
    await expect(mem.replaceFile("repo:k/v", "a.ts", [row])).rejects.toThrow()
    expect(calls).not.toContain("tx.begin")
    expect(calls).not.toContain("tx.delete")
  })
})
