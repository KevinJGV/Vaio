import type { TraceEvent } from "@vaio/contracts"
import { describe, expect, it } from "vitest"
import { resolveLogFormat, toLogRecord } from "../src/core/logging.js"

const ids = { requestId: "req-1", turnId: "turn-1" }

describe("resolveLogFormat", () => {
  it("respeta pretty/json explícitos por encima del entorno", () => {
    expect(resolveLogFormat("pretty", "production")).toBe("pretty")
    expect(resolveLogFormat("json", "development")).toBe("json")
  })

  it("auto/indefinido → json en producción, pretty fuera", () => {
    expect(resolveLogFormat("auto", "production")).toBe("json")
    expect(resolveLogFormat("auto", "development")).toBe("pretty")
    expect(resolveLogFormat(undefined, "production")).toBe("json")
    expect(resolveLogFormat(undefined, undefined)).toBe("pretty")
  })
})

describe("toLogRecord (política de redacción)", () => {
  it("incluye siempre ids y metadata del step", () => {
    const e: TraceEvent = {
      ...ids,
      type: "llm.step",
      stepNumber: 0,
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 5 },
    }
    const { level, fields } = toLogRecord(e, { logPrompts: false })
    expect(level).toBe("info")
    expect(fields).toMatchObject({
      evt: "llm.step",
      requestId: "req-1",
      turnId: "turn-1",
      stepNumber: 0,
      finishReason: "stop",
    })
  })

  it("oculta args de tool.call sin LOG_PROMPTS y los muestra con el flag (nombre siempre)", () => {
    const e: TraceEvent = {
      ...ids,
      type: "tool.call",
      toolCallId: "c1",
      toolName: "searchMemory",
      args: { query: "stack de kevin" },
    }
    const off = toLogRecord(e, { logPrompts: false }).fields
    expect(off).not.toHaveProperty("args")
    expect(off).toMatchObject({ toolName: "searchMemory" })
    expect(toLogRecord(e, { logPrompts: true }).fields).toMatchObject({
      args: { query: "stack de kevin" },
    })
  })

  it("oculta output de tool.result pero conserva metadata (hits/latencyMs/ok)", () => {
    const e: TraceEvent = {
      ...ids,
      type: "tool.result",
      toolCallId: "c1",
      toolName: "searchMemory",
      output: "texto crudo del CV",
      hits: 6,
      latencyMs: 42,
      ok: true,
    }
    const off = toLogRecord(e, { logPrompts: false }).fields
    expect(off).not.toHaveProperty("output")
    expect(off).toMatchObject({ hits: 6, latencyMs: 42, ok: true })
    expect(toLogRecord(e, { logPrompts: true }).fields).toMatchObject({
      output: "texto crudo del CV",
    })
  })

  it("reasoning: siempre presente; truncado sin flag, completo con flag", () => {
    const long = "x".repeat(5000)
    const e: TraceEvent = { ...ids, type: "reasoning", text: long }
    const off = toLogRecord(e, { logPrompts: false }).fields
    expect(typeof off.text).toBe("string")
    expect((off.text as string).length).toBeLessThan(long.length)
    expect(off.text).toContain("…")
    expect(toLogRecord(e, { logPrompts: true }).fields.text).toBe(long)
  })

  it("turn.start oculta lastUserPreview sin flag (metadata sí)", () => {
    const e: TraceEvent = {
      ...ids,
      type: "turn.start",
      locale: "es",
      messageCount: 2,
      lastUserPreview: "hola",
    }
    const off = toLogRecord(e, { logPrompts: false }).fields
    expect(off).not.toHaveProperty("lastUserPreview")
    expect(off).toMatchObject({ messageCount: 2, locale: "es" })
    expect(toLogRecord(e, { logPrompts: true }).fields).toMatchObject({
      lastUserPreview: "hola",
    })
  })

  it("turn.error se loguea a nivel error", () => {
    const e: TraceEvent = {
      ...ids,
      type: "turn.error",
      message: "boom",
      where: "streamText",
    }
    expect(toLogRecord(e, { logPrompts: false }).level).toBe("error")
  })

  it("propaga conversationId cuando está presente", () => {
    const e: TraceEvent = {
      ...ids,
      conversationId: "conv-9",
      type: "turn.finish",
      steps: 1,
      durationMs: 100,
    }
    expect(toLogRecord(e, { logPrompts: false }).fields).toMatchObject({
      conversationId: "conv-9",
    })
  })
})
