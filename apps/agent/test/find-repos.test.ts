import { describe, expect, it } from "vitest"
import { findRepos } from "../src/core/actions/find-repos.js"
import type { ActionContext, TraceIds } from "../src/core/actions/types.js"
import type { CapabilityProfile, Principal } from "../src/core/capabilities.js"
import type { LogFields, Logger } from "../src/ports/logger.js"
import type { OwnerRepoCatalog } from "../src/ports/owner-repos.js"

function noopLogger(): Logger {
  const noop = (_a: LogFields | string, _b?: string): void => {}
  const l: Logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => l,
  }
  return l
}
const ids: TraceIds = { requestId: "r", turnId: "t" }
const principal: Principal = { channel: "web", id: "web", trusted: false }
const caps: CapabilityProfile = {
  channel: "web",
  allowedTools: ["findRepos"],
  memoryScope: { maxK: 6 },
  policyText: "",
}

const catalog: OwnerRepoCatalog = {
  listPublic: async () => [
    {
      name: "ACME",
      defaultBranch: "main",
      language: "Java",
      topics: ["jdbc"],
      description: "control de acceso",
    },
    {
      name: "Vaio",
      defaultBranch: "main",
      language: "TypeScript",
      topics: ["ai"],
      description: "agente",
    },
  ],
}

function ctx(partial: Partial<ActionContext>): ActionContext {
  return {
    caps,
    principal,
    memory: null,
    emit: () => {},
    ids,
    logger: noopLogger(),
    ownerUser: "KevinJGV",
    ownerRepos: catalog,
    ...partial,
  }
}

const run = (input: { language?: string; topic?: string }, c = ctx({})) =>
  findRepos.build(c).execute?.(input, { toolCallId: "c", messages: [] })

describe("findRepos", () => {
  it("por lenguaje (case-insensitive) → lista los repos reales", async () => {
    const out = String(await run({ language: "java" }))
    expect(out).toContain("ACME")
    expect(out).not.toContain("Vaio")
    expect(out).toContain("github.com/KevinJGV/ACME")
  })

  it("lenguaje inexistente → fallo VISIBLE con los lenguajes reales", async () => {
    const out = String(await run({ language: "rust" }))
    expect(out.toLowerCase()).toContain("no tenés")
    expect(out).toContain("Java")
    expect(out).toContain("TypeScript")
  })

  it("por topic", async () => {
    const out = String(await run({ topic: "ai" }))
    expect(out).toContain("Vaio")
    expect(out).not.toContain("ACME")
  })

  it("sin filtros → lista todos", async () => {
    const out = String(await run({}))
    expect(out).toContain("ACME")
    expect(out).toContain("Vaio")
  })

  it("sin ownerRepos → degrada limpio", async () => {
    const out = String(
      await run({ language: "java" }, ctx({ ownerRepos: null }))
    )
    expect(out.toLowerCase()).toContain("no puedo")
  })
})
