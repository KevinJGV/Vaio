import { describe, expect, it } from "vitest"
import { escalate } from "../src/core/actions/escalate.js"
import { buildTools } from "../src/core/actions/registry.js"
import type { ActionContext, TraceIds } from "../src/core/actions/types.js"
import {
  type CapabilityProfile,
  createCapabilityResolver,
  type Principal,
} from "../src/core/capabilities.js"
import type { LogFields, Logger } from "../src/ports/logger.js"
import type {
  OwnerNotifier,
  OwnerNotifyInput,
  OwnerNotifyResult,
} from "../src/ports/owner-notifier.js"
import { inMemoryEscalations } from "./fakes/in-memory-escalations.js"

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

const ids: TraceIds = { requestId: "r", turnId: "t", conversationId: "conv1" }

function fakeNotifier(
  result: OwnerNotifyResult,
  calls: OwnerNotifyInput[]
): OwnerNotifier {
  return {
    notify: async (input) => {
      calls.push(input)
      return result
    },
  }
}

function ctx(partial: Partial<ActionContext>): ActionContext {
  const principal: Principal = partial.principal ?? {
    channel: "telegram",
    id: "visitor1",
    trusted: false,
  }
  const caps: CapabilityProfile = {
    channel: principal.channel,
    allowedTools: ["escalate"],
    memoryScope: { maxK: 6 },
    policyText: "",
  }
  return {
    caps,
    principal,
    memory: null,
    emit: () => {},
    ids,
    logger: noopLogger(),
    conversationKey: "555",
    locale: "es",
    ...partial,
  }
}

const exec = (t: ReturnType<typeof escalate.build>, question: string) =>
  t.execute?.({ question }, { toolCallId: "c", messages: [] }).then(String)

describe("escalate (acción)", () => {
  it("visitante Telegram (push) → persiste + notifica + markNotified con el ref; promete retomar", async () => {
    const es = inMemoryEscalations()
    const calls: OwnerNotifyInput[] = []
    const notifier = fakeNotifier(
      { delivered: true, channel: "telegram", ref: "77" },
      calls
    )
    const t = escalate.build(ctx({ escalations: es, notifier }))
    const out = await exec(t, "¿En qué empresa trabaja Kevin ahora?")
    // notificó a Kevin con la pregunta enmarcada como dato no confiable
    expect(calls).toHaveLength(1)
    expect(calls[0]?.kind).toBe("escalation")
    expect(calls[0]?.text).toContain("sin verificar")
    expect(calls[0]?.text).toContain("¿En qué empresa trabaja Kevin ahora?")
    // la escalada quedó 'notified' y correlacionable por el ref
    const found = await es.findByNotifyMessage("telegram", "77")
    expect(found).not.toBeNull()
    expect(found?.origin.askerPrincipalId).toBe("visitor1")
    expect(found?.origin.threadKey).toBe("555")
    // promete retomo (canal con push)
    expect(out?.toLowerCase()).toMatch(/te retomo|apenas me responda/)
  })

  it("visitante web (sin push) → notifica pero el copy NO promete retomo en el momento", async () => {
    const es = inMemoryEscalations()
    const calls: OwnerNotifyInput[] = []
    const notifier = fakeNotifier(
      { delivered: true, channel: "telegram", ref: "88" },
      calls
    )
    const t = escalate.build(
      ctx({
        principal: { channel: "web", id: "web", trusted: false },
        escalations: es,
        notifier,
      })
    )
    const out = await exec(t, "¿Cuál es su disponibilidad?")
    expect(calls).toHaveLength(1)
    expect(out?.toLowerCase()).toMatch(/de nuevo|contactarte|pasé a kevin/)
    expect(out?.toLowerCase()).not.toContain("te retomo acá")
  })

  it("notifier no entrega (sin owner / falló) → markFailed + copy honesto sin prometer", async () => {
    const es = inMemoryEscalations()
    const notifier = fakeNotifier({ delivered: false, channel: "telegram" }, [])
    const t = escalate.build(ctx({ escalations: es, notifier }))
    const out = await exec(t, "algo")
    expect(out?.toLowerCase()).toMatch(/no pude alcanzarlo|directo/)
    // no quedó nada 'notified' correlacionable
    expect(await es.countOpenByPrincipal("visitor1")).toBe(0)
  })

  it("sin escalations/notifier → degrada honesto (Inv #1), no tira", async () => {
    const t = escalate.build(ctx({ escalations: null, notifier: null }))
    const out = await exec(t, "algo")
    expect(out?.toLowerCase()).toMatch(/no lo tengo|no puedo/)
  })

  it("dedup: 2ª pregunta equivalente del mismo visitante NO vuelve a notificar", async () => {
    const es = inMemoryEscalations()
    const calls: OwnerNotifyInput[] = []
    const notifier = fakeNotifier(
      { delivered: true, channel: "telegram", ref: "1" },
      calls
    )
    const t = escalate.build(ctx({ escalations: es, notifier }))
    await exec(t, "¿Cuál es su stack?")
    const out2 = await exec(t, "  ¿cuál ES su  stack? ")
    expect(calls).toHaveLength(1) // solo la 1ª notificó
    expect(out2?.toLowerCase()).toMatch(/ya se lo pasé|aguantá/)
  })

  it("rate-limit: con el tope de abiertas alcanzado, NO notifica más", async () => {
    const es = inMemoryEscalations()
    const calls: OwnerNotifyInput[] = []
    const notifier = fakeNotifier(
      { delivered: true, channel: "telegram", ref: "x" },
      calls
    )
    const t = escalate.build(ctx({ escalations: es, notifier }))
    // 3 escaladas distintas (tope = 3) → todas notifican
    await exec(t, "p1")
    await exec(t, "p2")
    await exec(t, "p3")
    expect(calls).toHaveLength(3)
    const out = await exec(t, "p4") // 4ª → bloqueada
    expect(calls).toHaveLength(3)
    expect(out?.toLowerCase()).toMatch(/varias consultas pendientes|esperemos/)
  })

  it("GATING: escalate se expone a visitantes (web + telegram-no-owner), NO al owner", async () => {
    const resolver = createCapabilityResolver()
    const web = resolver.resolve("web", {
      channel: "web",
      id: "web",
      trusted: false,
    })
    const visitor = resolver.resolve("telegram", {
      channel: "telegram",
      id: "9",
      trusted: false,
    })
    const owner = resolver.resolve("telegram", {
      channel: "telegram",
      id: "1",
      trusted: true,
    })
    expect(web.allowedTools).toContain("escalate")
    expect(visitor.allowedTools).toContain("escalate")
    expect(owner.allowedTools).not.toContain("escalate")
    // y el ToolSet lo refleja (capa 1: canal oculta para el owner)
    const base = ctx({
      escalations: inMemoryEscalations(),
      notifier: fakeNotifier(
        { delivered: true, channel: "telegram", ref: "1" },
        []
      ),
    })
    const ownerTools = buildTools({
      ...base,
      caps: owner,
      principal: { channel: "telegram", id: "1", trusted: true },
    })
    expect(ownerTools.escalate).toBeUndefined()
    const visitorTools = buildTools({
      ...base,
      caps: visitor,
      principal: { channel: "telegram", id: "9", trusted: false },
    })
    expect(visitorTools.escalate).toBeDefined()
  })
})
