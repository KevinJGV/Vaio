import { describe, expect, it } from "vitest"
import { findRepos } from "../src/core/actions/find-repos.js"
import type { ActionContext, TraceIds } from "../src/core/actions/types.js"
import type { CapabilityProfile, Principal } from "../src/core/capabilities.js"
import type { OpenPR } from "../src/core/repo-activity.js"
import type { LogFields, Logger } from "../src/ports/logger.js"
import type {
  OwnerRepoActivity,
  OwnerRepoCatalog,
} from "../src/ports/owner-repos.js"

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

const activity = (prs: OpenPR[] | null): OwnerRepoActivity => ({
  openPullRequests: async () => prs,
})

const run = (
  input: { language?: string; topic?: string; hasOpenPRs?: boolean },
  c = ctx({})
) => findRepos.build(c).execute?.(input, { toolCallId: "c", messages: [] })

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

  const pr = (repo: string, number: number, title: string): OpenPR => ({
    repo,
    number,
    title,
    url: `https://github.com/KevinJGV/${repo}/pull/${number}`,
  })

  it("hasOpenPRs → lista solo repos con PRs, enriquecido (número + título)", async () => {
    const out = String(
      await run(
        { hasOpenPRs: true },
        ctx({
          repoActivity: activity([
            pr("Vaio", 12, "fix sync"),
            pr("Vaio", 15, "rerank"),
          ]),
        })
      )
    )
    expect(out).toContain("Vaio")
    expect(out).toContain("2 PR(s) sin mergear")
    expect(out).toContain('#12 "fix sync"')
    expect(out).toContain('#15 "rerank"')
    expect(out).not.toContain("ACME") // ACME no tiene PRs → fuera
  })

  it("hasOpenPRs intersecta con el catálogo público (PR de repo ajeno NO aparece — guard de privacidad)", async () => {
    const out = String(
      await run(
        { hasOpenPRs: true },
        ctx({
          repoActivity: activity([
            pr("ACME", 3, "real"),
            pr("PrivadoXYZ", 99, "no debe salir"), // no está en el catálogo
          ]),
        })
      )
    )
    expect(out).toContain("ACME")
    expect(out).not.toContain("PrivadoXYZ")
    expect(out).not.toContain("no debe salir")
  })

  it("hasOpenPRs + language → intersección (TS con PRs)", async () => {
    const out = String(
      await run(
        { language: "TypeScript", hasOpenPRs: true },
        ctx({
          repoActivity: activity([pr("ACME", 1, "x"), pr("Vaio", 2, "y")]),
        })
      )
    )
    expect(out).toContain("Vaio")
    expect(out).not.toContain("ACME") // ACME es Java → excluido por el filtro de lenguaje
  })

  it("hasOpenPRs con [] (genuinamente ninguno) → 'no tenés PRs'", async () => {
    const out = String(
      await run({ hasOpenPRs: true }, ctx({ repoActivity: activity([]) }))
    )
    expect(out.toLowerCase()).toContain("no tenés prs sin mergear")
  })

  it("hasOpenPRs con null (query falló) → 'no pude consultar' (≠ no hay PRs)", async () => {
    const out = String(
      await run({ hasOpenPRs: true }, ctx({ repoActivity: activity(null) }))
    )
    expect(out.toLowerCase()).toContain("no pude consultar")
  })

  it("hasOpenPRs sin repoActivity en el ctx → degrada honesto", async () => {
    const out = String(
      await run({ hasOpenPRs: true }, ctx({ repoActivity: null }))
    )
    expect(out.toLowerCase()).toContain("no pude consultar")
  })
})
