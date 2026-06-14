import type { TraceEvent } from "@vaio/contracts"
import { describe, expect, it } from "vitest"
import { reportDegraded } from "../src/core/observability.js"
import { toLogRecord } from "../src/core/logging.js"

describe("reportDegraded", () => {
  it("emite un TraceEvent degraded con los campos", () => {
    const events: TraceEvent[] = []
    reportDegraded(
      { emit: (e) => events.push(e), ids: { requestId: "r", turnId: "t" } },
      { component: "transcribe", reason: "transcribe falló", detail: "transcriptions 400" }
    )
    expect(events[0]).toMatchObject({
      type: "degraded",
      requestId: "r",
      turnId: "t",
      component: "transcribe",
      reason: "transcribe falló",
      detail: "transcriptions 400",
    })
  })

  it("toLogRecord mapea degraded a nivel error; detail solo con logPrompts", () => {
    const ev: TraceEvent = {
      requestId: "r",
      turnId: "t",
      type: "degraded",
      component: "transcribe",
      reason: "transcribe falló",
      detail: "transcriptions 400",
    }
    const redacted = toLogRecord(ev, { logPrompts: false })
    expect(redacted.level).toBe("error")
    expect(redacted.fields.component).toBe("transcribe")
    expect(redacted.fields.reason).toBe("transcribe falló")
    expect(redacted.fields.detail).toBeUndefined() // redactado sin logPrompts

    const full = toLogRecord(ev, { logPrompts: true })
    expect(full.fields.detail).toBe("transcriptions 400")
  })
})
