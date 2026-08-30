import { describe, expect, it } from "bun:test"
import { ToolSummary } from "@aigcfroge/core/session/tool-summary"
import type { SessionMessage } from "@aigcfroge/core/session/message"
import { assistantWithTools, makeToolCallPlain } from "./fixture/tool-summary"

describe("ToolSummary.fromMessages", () => {
  it("returns empty array for empty input", () => {
    expect(ToolSummary.fromMessages([])).toEqual([])
  })

  it("returns empty array when no assistant messages", () => {
    const messages = [
      {
        type: "user",
        id: "u1",
        text: "hello",
        files: [],
        time: { created: Date.now() },
      },
    ] as unknown as SessionMessage.Message[]
    expect(ToolSummary.fromMessages(messages)).toEqual([])
  })

  it("aggregates tools by name and file path", () => {
    const messages = [
      assistantWithTools("build", [
        makeToolCallPlain({ name: "read", input: { path: "src/auth.ts" } }),
        makeToolCallPlain({ name: "read", input: { path: "src/auth.ts" } }),
        makeToolCallPlain({ name: "edit", input: { path: "src/auth.ts" } }),
      ]),
    ]

    const result = ToolSummary.fromMessages(messages)
    expect(result).toHaveLength(1)
    expect(result[0].agent).toBe("build")
    expect(result[0].tools).toHaveLength(2)

    const readEntry = result[0].tools.find((t) => t.tool === "read")
    expect(readEntry).toBeDefined()
    expect(readEntry!.count).toBe(2)
    expect(readEntry!.file).toBe("src/auth.ts")

    const editEntry = result[0].tools.find((t) => t.tool === "edit")
    expect(editEntry).toBeDefined()
    expect(editEntry!.count).toBe(1)
    expect(editEntry!.file).toBe("src/auth.ts")
  })

  it("aggregates tools across multiple assistant messages", () => {
    const messages = [
      assistantWithTools("build", [makeToolCallPlain({ name: "read", input: { path: "src/a.ts" } })]),
      assistantWithTools("build", [makeToolCallPlain({ name: "read", input: { path: "src/b.ts" } })]),
    ]

    const result = ToolSummary.fromMessages(messages)
    expect(result).toHaveLength(2)
    expect(result[0].tools).toHaveLength(1)
    expect(result[1].tools).toHaveLength(1)
  })

  it("extracts file path from workdir for bash tools", () => {
    const messages = [
      assistantWithTools("explore", [makeToolCallPlain({ name: "bash", input: { command: "ls", workdir: "src/" } })]),
    ]

    const result = ToolSummary.fromMessages(messages)
    expect(result[0].tools[0].file).toBe("src/")
  })

  it("sets status to failed for error tools", () => {
    const messages = [
      assistantWithTools("build", [makeToolCallPlain({ name: "edit", input: { path: "main.ts" }, status: "error" })]),
    ]

    const result = ToolSummary.fromMessages(messages)
    expect(result[0].tools[0].status).toBe("failed")
  })

  it("sets status to running for pending tool", () => {
    const messages = [
      assistantWithTools("build", [makeToolCallPlain({ name: "read", input: { path: "main.ts" }, status: "pending" })]),
    ]

    const result = ToolSummary.fromMessages(messages)
    expect(result[0].tools[0].status).toBe("running")
  })

  it("calculates duration from time.completed - time.created", () => {
    const now = Date.now()
    const messages = [
      assistantWithTools("build", [
        makeToolCallPlain({ name: "read", input: { path: "main.ts" }, created: now, completed: now + 5000 }),
      ]),
    ]

    const result = ToolSummary.fromMessages(messages)
    expect(result[0].tools[0].duration).toBe(5000)
  })

  it("returns empty tools array when assistant has no tool calls", () => {
    const messages = [assistantWithTools("build", [])]
    const result = ToolSummary.fromMessages(messages)
    expect(result).toHaveLength(1)
    expect(result[0].tools).toEqual([])
    expect(result[0].totalDuration).toBe(0)
  })

  it("upgrades status correctly when mixing statuses", () => {
    const messages = [
      assistantWithTools("build", [
        makeToolCallPlain({ name: "read", input: { path: "main.ts" }, status: "completed" }),
        makeToolCallPlain({ name: "read", input: { path: "main.ts" }, status: "error" }),
      ]),
    ]

    const result = ToolSummary.fromMessages(messages)
    const entry = result[0].tools.find((t) => t.tool === "read")
    expect(entry!.status).toBe("failed")
  })

  it("calculates totalDuration across all entry durations", () => {
    const now = Date.now()
    const messages = [
      assistantWithTools("build", [
        makeToolCallPlain({ name: "read", input: { path: "a.ts" }, created: now, completed: now + 2000 }),
        makeToolCallPlain({ name: "edit", input: { path: "b.ts" }, created: now, completed: now + 3000 }),
      ]),
    ]

    const result = ToolSummary.fromMessages(messages)
    // read: 2000ms, edit: 3000ms
    expect(result[0].totalDuration).toBe(5000)
  })
})
