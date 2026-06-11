import type { TraceEvent } from "@vaio/contracts"
import { describe, expect, it } from "vitest"
import { createLoggerTraceSink } from "../src/adapters/trace-logger.js"
import type { LogFields, Logger } from "../src/ports/logger.js"

interface Call {
  level: string
  fields: LogFields
  msg?: string
}

function fakeLogger(): { logger: Logger; calls: Call[] } {
  const calls: Call[] = []
  const mk =
    (level: string) =>
    (a: LogFields | string, b?: string): void => {
      if (typeof a === "string") calls.push({ level, fields: {}, msg: a })
      else calls.push({ level, fields: a, msg: b })
    }
  const logger: Logger = {
    trace: mk("trace"),
    debug: mk("debug"),
    info: mk("info"),
    warn: mk("warn"),
    error: mk("error"),
    child: () => logger,
  }
  return { logger, calls }
}

describe("createLoggerTraceSink", () => {
  it("emite tool.result a info ocultando output sin LOG_PROMPTS", () => {
    const { logger, calls } = fakeLogger()
    const sink = createLoggerTraceSink(logger, { logPrompts: false })
    const e: TraceEvent = {
      requestId: "r",
      turnId: "t",
      type: "tool.result",
      toolCallId: "c",
      toolName: "searchMemory",
      output: "secreto",
      hits: 3,
    }
    sink.emit(e)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.level).toBe("info")
    expect(calls[0]?.fields).not.toHaveProperty("output")
    expect(calls[0]?.fields).toMatchObject({
      toolName: "searchMemory",
      hits: 3,
    })
  })

  it("emite turn.error a nivel error", () => {
    const { logger, calls } = fakeLogger()
    const sink = createLoggerTraceSink(logger, { logPrompts: false })
    sink.emit({
      requestId: "r",
      turnId: "t",
      type: "turn.error",
      message: "x",
      where: "streamText",
    })
    expect(calls[0]?.level).toBe("error")
  })
})
