import type { TraceEvent } from "@vaio/contracts"
import { describe, expect, it } from "vitest"
import { rememberFact } from "../src/core/actions/remember-fact.js"
import { resolveFact } from "../src/core/actions/resolve-fact.js"
import type { ActionContext } from "../src/core/actions/types.js"
import { unlearnFact } from "../src/core/actions/unlearn-fact.js"
import type { Principal } from "../src/core/capabilities.js"
import type {
  ConflictJudge,
  ConflictVerdict,
} from "../src/ports/conflict-judge.js"
import type { FactDecomposer } from "../src/ports/fact-decomposer.js"
import type { LogFields, Logger } from "../src/ports/logger.js"
import { inMemoryFacts } from "./fakes/in-memory-facts.js"

/** Fake ConflictJudge: marca TODOS los candidatos con el mismo veredicto. */
function fakeJudge(verdict: ConflictVerdict): ConflictJudge {
  return {
    judge: async ({ candidates }) => ({
      decisions: candidates.map((c) => ({ ordinal: c.ordinal, verdict })),
    }),
  }
}
/** Fake FactDecomposer: devuelve los átomos fijos. */
function fakeDecomposer(statements: string[]): FactDecomposer {
  return { decompose: async () => ({ statements }) }
}
/** Fake ConflictJudge SELECTIVO: marca "duplicate" los candidatos cuyo statement incluye `needle`, el resto "coexists". */
function fakeJudgeMatching(needle: string): ConflictJudge {
  return {
    judge: async ({ candidates }) => ({
      decisions: candidates.map((c) => ({
        ordinal: c.ordinal,
        verdict: c.statement.toLowerCase().includes(needle.toLowerCase())
          ? ("duplicate" as const)
          : ("coexists" as const),
      })),
    }),
  }
}

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
const principal: Principal = { channel: "telegram", id: "k", trusted: true }
function ctx(
  factStore: ActionContext["factStore"],
  emit: (e: TraceEvent) => void = () => {},
  extra: {
    conflictJudge?: ConflictJudge
    factDecomposer?: FactDecomposer
  } = {}
): ActionContext {
  return {
    caps: {
      channel: "telegram",
      allowedTools: ["rememberFact", "resolveFact", "unlearnFact"],
      memoryScope: { maxK: 8 },
      policyText: "",
    },
    principal,
    memory: null,
    factStore,
    emit,
    ids: { requestId: "r", turnId: "t", conversationId: "c" },
    logger: noopLogger(),
    ...(extra.conflictJudge ? { conflictJudge: extra.conflictJudge } : {}),
    ...(extra.factDecomposer ? { factDecomposer: extra.factDecomposer } : {}),
  }
}

describe("rememberFact", () => {
  it("sin conflicto → guarda EN EL ACTO (auto-save, sin pendiente, sin confirmación)", async () => {
    const fs = inMemoryFacts()
    const out = await rememberFact
      .build(ctx(fs))
      .execute?.(
        { statement: "A Kevin le gustan las hamburguesas" },
        { toolCallId: "tc", messages: [] }
      )
    expect(String(out)).toMatch(/guard/i)
    expect(await fs.listPending("k")).toHaveLength(0) // se confirmó, no quedó pendiente
  })

  it("con conflicto → deja pendiente y numera los conflictos por ordinal (sin uuids)", async () => {
    const fs = inMemoryFacts()
    // un fact confirmado del mismo principal → el siguiente remember choca con él
    await rememberFact
      .build(ctx(fs))
      .execute?.(
        { statement: "A Kevin le gustan las hamburguesas" },
        { toolCallId: "t1", messages: [] }
      )
    const out = await rememberFact
      .build(ctx(fs))
      .execute?.(
        { statement: "A Kevin ya no le gustan las hamburguesas" },
        { toolCallId: "t2", messages: [] }
      )
    expect(String(out)).toMatch(/pendiente/i)
    expect(String(out)).toMatch(/\[0\]/) // conflicto por ordinal
    expect(String(out)).toMatch(/resolveFact/)
    expect(await fs.listPending("k")).toHaveLength(1) // sí quedó pendiente
  })

  it("degrada a cortesía si no hay factStore", async () => {
    const out = await rememberFact
      .build(ctx(null))
      .execute?.({ statement: "X" }, { toolCallId: "tc", messages: [] })
    expect(String(out)).toMatch(/no configurada/i)
  })
})

describe("resolveFact", () => {
  it("confirm con replaces:[0] → mapea el ordinal al uuid e invalida el viejo (el modelo no pasa ids)", async () => {
    const fs = inMemoryFacts()
    await rememberFact
      .build(ctx(fs))
      .execute?.(
        { statement: "A Kevin le gustan las hamburguesas" },
        { toolCallId: "t1", messages: [] }
      )
    await rememberFact
      .build(ctx(fs))
      .execute?.(
        { statement: "A Kevin ya no le gustan las hamburguesas" },
        { toolCallId: "t2", messages: [] }
      )
    const viejo = fs.rows().find((r) => r.statement.includes("le gustan"))?.id
    const out = await resolveFact
      .build(ctx(fs))
      .execute?.(
        { decision: "confirm", replaces: [0] },
        { toolCallId: "t3", messages: [] }
      )
    expect(String(out)).toMatch(/reemplac/i)
    expect(fs.rows().find((r) => r.id === viejo)?.invalidAt).not.toBeNull()
  })

  it("confirm sin replaces → confirma sin invalidar nada (coexistencia)", async () => {
    const fs = inMemoryFacts()
    await rememberFact
      .build(ctx(fs))
      .execute?.(
        { statement: "A Kevin le gusta la pizza" },
        { toolCallId: "t1", messages: [] }
      )
    // segundo (cercano en el fake) → pendiente
    await rememberFact
      .build(ctx(fs))
      .execute?.(
        { statement: "A Kevin le gusta la pasta" },
        { toolCallId: "t2", messages: [] }
      )
    const out = await resolveFact
      .build(ctx(fs))
      .execute?.({ decision: "confirm" }, { toolCallId: "t3", messages: [] })
    expect(String(out)).toMatch(/guard/i)
    // ninguno invalidado
    expect(fs.rows().every((r) => r.invalidAt === null)).toBe(true)
  })

  it("reject → descarta la pendiente", async () => {
    const fs = inMemoryFacts()
    await rememberFact
      .build(ctx(fs))
      .execute?.(
        { statement: "A Kevin le gusta X" },
        { toolCallId: "t1", messages: [] }
      )
    await rememberFact
      .build(ctx(fs))
      .execute?.(
        { statement: "A Kevin ya no le gusta X" },
        { toolCallId: "t2", messages: [] }
      )
    const out = await resolveFact
      .build(ctx(fs))
      .execute?.({ decision: "reject" }, { toolCallId: "t3", messages: [] })
    expect(String(out)).toMatch(/descart/i)
    expect(await fs.listPending("k")).toHaveLength(0)
  })

  it("sin pendiente → avisa que no hay nada que resolver", async () => {
    const fs = inMemoryFacts()
    const out = await resolveFact
      .build(ctx(fs))
      .execute?.({ decision: "confirm" }, { toolCallId: "t1", messages: [] })
    expect(String(out)).toMatch(/no tengo ninguna propuesta pendiente/i)
  })

  it("replaces con ordinal fuera de rango → se ignora, no rompe (confirma sin invalidar)", async () => {
    const fs = inMemoryFacts()
    await rememberFact
      .build(ctx(fs))
      .execute?.(
        { statement: "A Kevin le gusta Y" },
        { toolCallId: "t1", messages: [] }
      )
    await rememberFact
      .build(ctx(fs))
      .execute?.(
        { statement: "A Kevin ya no le gusta Y" },
        { toolCallId: "t2", messages: [] }
      )
    const out = await resolveFact
      .build(ctx(fs))
      .execute?.(
        { decision: "confirm", replaces: [99] },
        { toolCallId: "t3", messages: [] }
      )
    expect(String(out)).toMatch(/guard/i)
    expect(fs.rows().every((r) => r.invalidAt === null)).toBe(true)
  })
})

describe("rememberFact + juez (cluster ciclo-de-vida del fact)", () => {
  const seed = async (
    fs: ReturnType<typeof inMemoryFacts>,
    statement: string
  ) => {
    const { id } = await fs.propose({
      statement,
      principalId: "k",
      channel: "telegram",
    })
    await fs.commit(id)
  }

  it("REGRESIÓN pasta/fútbol: cercano pero el juez dice COEXISTE → guarda, NADA pendiente", async () => {
    const fs = inMemoryFacts()
    await seed(fs, "A Kevin le gusta el fútbol")
    const out = await rememberFact
      .build(
        ctx(fs, () => {}, {
          conflictJudge: fakeJudge("coexists"),
          factDecomposer: fakeDecomposer(["A Kevin le gusta la pasta"]),
        })
      )
      .execute?.(
        { statement: "A Kevin le gusta la pasta" },
        { toolCallId: "t", messages: [] }
      )
    expect(String(out)).toMatch(/guard/i)
    expect(await fs.listPending("k")).toHaveLength(0) // no quedó colgado
  })

  it("cercano + juez DUPLICADO → no duplica (reject), avisa que ya lo tenía", async () => {
    const fs = inMemoryFacts()
    await seed(fs, "A Kevin le gusta la pasta")
    const out = await rememberFact
      .build(
        ctx(fs, () => {}, {
          conflictJudge: fakeJudge("duplicate"),
          factDecomposer: fakeDecomposer(["A Kevin le gusta la pasta"]),
        })
      )
      .execute?.(
        { statement: "A Kevin le gusta la pasta" },
        { toolCallId: "t", messages: [] }
      )
    expect(String(out)).toMatch(/ya lo tenía/i)
    expect(await fs.listPending("k")).toHaveLength(0)
  })

  it("cercano + juez CONTRADICE → deja PENDIENTE (HITL) con el ordinal + resolveFact", async () => {
    const fs = inMemoryFacts()
    await seed(fs, "A Kevin le gusta la pasta")
    const out = await rememberFact
      .build(
        ctx(fs, () => {}, {
          conflictJudge: fakeJudge("contradicts"),
          factDecomposer: fakeDecomposer(["A Kevin ya no le gusta la pasta"]),
        })
      )
      .execute?.(
        { statement: "A Kevin ya no le gusta la pasta" },
        { toolCallId: "t", messages: [] }
      )
    expect(String(out)).toMatch(/pendiente/i)
    expect(String(out)).toMatch(/\[0\]/)
    expect(String(out)).toMatch(/resolveFact/)
    expect(await fs.listPending("k")).toHaveLength(1)
  })

  it("statement COMPUESTO → guarda átomos separados", async () => {
    const fs = inMemoryFacts()
    const out = await rememberFact
      .build(
        ctx(fs, () => {}, {
          // átomos no relacionados → el juez los marca coexistentes (el fake los ve "cercanos" por contrato)
          conflictJudge: fakeJudge("coexists"),
          factDecomposer: fakeDecomposer([
            "A Kevin le gustaba explorar",
            "A Kevin le daban miedo las piscinas",
          ]),
        })
      )
      .execute?.(
        { statement: "me gustaba explorar y las piscinas me daban miedo" },
        { toolCallId: "t", messages: [] }
      )
    expect(String(out)).toMatch(/guard/i)
    expect(fs.rows().filter((r) => r.status === "confirmed")).toHaveLength(2)
  })

  it("decomposer vacío → no guarda nada", async () => {
    const fs = inMemoryFacts()
    const out = await rememberFact
      .build(ctx(fs, () => {}, { factDecomposer: fakeDecomposer([]) }))
      .execute?.(
        { statement: "mi número es 300…" },
        { toolCallId: "t", messages: [] }
      )
    expect(String(out)).toMatch(/durable|sensible/i)
    expect(fs.rows()).toHaveLength(0)
  })
})

describe("unlearnFact", () => {
  const seed = async (
    fs: ReturnType<typeof inMemoryFacts>,
    statement: string
  ) => {
    const { id } = await fs.propose({
      statement,
      principalId: "k",
      channel: "telegram",
    })
    await fs.commit(id)
  }

  it("0 candidatos → avisa que no encontró nada", async () => {
    const out = await unlearnFact
      .build(ctx(inMemoryFacts()))
      .execute?.({ about: "nada parecido" }, { toolCallId: "u", messages: [] })
    expect(String(out)).toMatch(/no encontré/i)
  })

  it("1 candidato nítido → lo olvida EN EL TURNO (invalida) y lo nombra", async () => {
    const fs = inMemoryFacts()
    await seed(fs, "A Kevin le gusta la pasta")
    const out = await unlearnFact
      .build(ctx(fs))
      .execute?.({ about: "pasta" }, { toolCallId: "u", messages: [] })
    expect(String(out)).toMatch(/olvidé/i)
    expect(
      fs.rows().find((r) => r.statement.includes("pasta"))?.invalidAt
    ).not.toBeNull()
  })

  it("≥2 candidatos → lista por ordinal; luego `which` invalida el elegido", async () => {
    const fs = inMemoryFacts()
    await seed(fs, "A Kevin le gusta la pasta")
    await seed(fs, "A Kevin odia la pasta recalentada")
    const list = await unlearnFact
      .build(ctx(fs))
      .execute?.({ about: "pasta" }, { toolCallId: "u1", messages: [] })
    expect(String(list)).toMatch(/\[0\]/)
    expect(String(list)).toMatch(/\[1\]/)
    expect(fs.rows().every((r) => r.invalidAt === null)).toBe(true) // aún no tocó nada
    const out = await unlearnFact
      .build(ctx(fs))
      .execute?.(
        { about: "pasta", which: 1 },
        { toolCallId: "u2", messages: [] }
      )
    expect(String(out)).toMatch(/olvidé/i)
    expect(
      fs.rows().find((r) => r.statement.includes("recalentada"))?.invalidAt
    ).not.toBeNull()
  })

  it("degrada si no hay factStore", async () => {
    const out = await unlearnFact
      .build(ctx(null))
      .execute?.({ about: "x" }, { toolCallId: "u", messages: [] })
    expect(String(out)).toMatch(/no configurada|no puedo/i)
  })

  it("FILTRO del juez: el coseno trae no-relacionados pero ninguno coincide → «no encontré» (caso fútbol)", async () => {
    const fs = inMemoryFacts()
    await seed(fs, "A Kevin le gusta la pizza")
    await seed(fs, "A Kevin le gusta la pasta")
    // El fake trae por substring; forzamos red ancha con `about` que matchea ambos ("le gusta"), y el juez (que
    // busca "fútbol") no marca ninguno como duplicate → matches vacío → no ofrece pizza/pasta.
    const out = await unlearnFact
      .build(ctx(fs, () => {}, { conflictJudge: fakeJudgeMatching("fútbol") }))
      .execute?.({ about: "le gusta" }, { toolCallId: "u", messages: [] })
    expect(String(out)).toMatch(/no encontré/i)
    expect(fs.rows().every((r) => r.invalidAt === null)).toBe(true) // no tocó nada
  })

  it("FILTRO del juez: red ancha (≥2 coseno) → el juez deja 1 → lo olvida en el turno", async () => {
    const fs = inMemoryFacts()
    await seed(fs, "A Kevin le gusta la pasta")
    await seed(fs, "A Kevin le gusta la pizza")
    const out = await unlearnFact
      .build(ctx(fs, () => {}, { conflictJudge: fakeJudgeMatching("pasta") }))
      .execute?.({ about: "le gusta" }, { toolCallId: "u", messages: [] })
    expect(String(out)).toMatch(/olvidé/i)
    expect(String(out)).toContain("pasta")
    expect(
      fs.rows().find((r) => r.statement.includes("pasta"))?.invalidAt
    ).not.toBeNull()
    expect(
      fs.rows().find((r) => r.statement.includes("pizza"))?.invalidAt
    ).toBeNull() // la pizza intacta
  })
})
