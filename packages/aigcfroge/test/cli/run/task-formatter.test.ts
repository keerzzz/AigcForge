import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import type { ToolPart } from "@aigcfroge/sdk/v2"
import { SessionTask } from "@aigcfroge/core/session/task"
import { Parameters } from "@/tool/todo"
import { toolEntryBody, toolInlineInfo } from "@/cli/cmd/run/tool"
import type { StreamCommit } from "@/cli/cmd/run/types"

const input = Schema.decodeUnknownSync(Parameters)({
  tasks: [
    { content: "Review durable admission", status: "completed", priority: "high" },
    { content: "Review cancellation", status: "in_progress", priority: "medium" },
    { content: "Review recovery", status: "pending", priority: "low" },
  ],
})
const tasks = Schema.decodeUnknownSync(Schema.Array(SessionTask.Info))(
  input.tasks.map((task, index) => ({
    ...task,
    id: `tsk_formatter_${index}`,
    sessionID: "ses_formatter",
    revision: 1,
    createdAt: 1,
    updatedAt: 2,
  })),
)

function completed(snapshot: ReadonlyArray<SessionTask.Info>, parameters = input): ToolPart {
  return {
    id: "prt_formatter",
    messageID: "msg_formatter",
    sessionID: "ses_formatter",
    type: "tool",
    tool: "todowrite",
    callID: "call_formatter",
    state: {
      status: "completed",
      input: parameters,
      output: JSON.stringify(snapshot),
      title: "2 todos",
      metadata: { tasks: snapshot },
      time: { start: 1, end: 2 },
    },
  }
}

function commit(part: ToolPart): StreamCommit {
  return {
    kind: "tool",
    phase: "final",
    source: "tool",
    text: "",
    messageID: part.messageID,
    partID: part.id,
    tool: part.tool,
    part,
    toolState: "completed",
  }
}

describe("canonical Task CLI formatter", () => {
  test("fixtures satisfy the production writer input and output contracts", () => {
    expect(Schema.decodeUnknownSync(Parameters)(input).tasks).toHaveLength(3)
    expect(Schema.decodeUnknownSync(Schema.Array(SessionTask.Info))(tasks)).toHaveLength(3)
  })

  test("running details render canonical input tasks", () => {
    const part = completed(tasks)
    expect(toolInlineInfo({ ...part, state: { status: "running", input, time: { start: 1 } } }).body).toBe(
      "[✓] Review durable admission\n[•] Review cancellation\n[ ] Review recovery",
    )
  })

  test("completed history retains canonical task rows and statuses", () => {
    expect(toolEntryBody(commit(completed(tasks)), JSON.stringify(tasks))).toEqual({
      type: "structured",
      snapshot: {
        kind: "todo",
        items: [
          { content: "Review durable admission", status: "completed" },
          { content: "Review cancellation", status: "in_progress" },
          { content: "Review recovery", status: "pending" },
        ],
        tail: "",
      },
    })
  })

  test("completed details and history use their own metadata snapshot", () => {
    const snapshot = Schema.decodeUnknownSync(Schema.Array(SessionTask.Info))([
      { ...tasks[0], content: "Stored invocation result", status: "failed", revision: 2 },
    ])
    const part = completed(snapshot)
    expect(toolInlineInfo(part).body).toBe("[ ] Stored invocation result")
    expect(toolEntryBody(commit(part), JSON.stringify(snapshot))).toMatchObject({
      type: "structured",
      snapshot: { items: [{ content: "Stored invocation result", status: "failed" }] },
    })
  })

  test("an explicit empty invocation snapshot does not fall back to input rows", () => {
    const part = completed([])
    expect(toolInlineInfo(part).body).toBe("")
    expect(toolEntryBody(commit(part), "[]")).toEqual({
      type: "structured",
      snapshot: { kind: "todo", items: [], tail: "" },
    })
  })

  test("missing output metadata falls back to canonical input", () => {
    const part = completed(tasks)
    if (part.state.status !== "completed") throw new Error("expected a completed Task fixture")
    const withoutMetadata = { ...part, state: { ...part.state, metadata: {} } }
    expect(toolEntryBody(commit(withoutMetadata), withoutMetadata.state.output)).toMatchObject({
      type: "structured",
      snapshot: {
        items: [
          { content: "Review durable admission", status: "completed" },
          { content: "Review cancellation", status: "in_progress" },
          { content: "Review recovery", status: "pending" },
        ],
      },
    })
  })

  test("a later invocation does not rewrite an older history snapshot", () => {
    const older = completed(tasks)
    const later = Schema.decodeUnknownSync(Schema.Array(SessionTask.Info))([
      { ...tasks[0], content: "Later authoritative edit", status: "cancelled", revision: 3 },
    ])
    toolEntryBody(commit(completed(later)), JSON.stringify(later))
    expect(toolEntryBody(commit(older), JSON.stringify(tasks))).toMatchObject({
      type: "structured",
      snapshot: {
        items: [
          { content: "Review durable admission", status: "completed" },
          { content: "Review cancellation", status: "in_progress" },
          { content: "Review recovery", status: "pending" },
        ],
      },
    })
  })

  test("legacy todo input remains visible in readonly details and history", () => {
    const part = completed(tasks)
    if (part.state.status !== "completed") throw new Error("expected a completed Task fixture")
    const legacy = {
      ...part,
      state: {
        ...part.state,
        input: { todos: [{ content: "Legacy input", status: "completed" }] },
        metadata: {},
      },
    }
    expect(toolInlineInfo(legacy).body).toBe("[✓] Legacy input")
    expect(toolEntryBody(commit(legacy), "")).toMatchObject({
      snapshot: { items: [{ content: "Legacy input", status: "completed" }] },
    })
  })

  test("legacy output snapshots override legacy input, including an empty snapshot", () => {
    const part = completed(tasks)
    if (part.state.status !== "completed") throw new Error("expected a completed Task fixture")
    const legacy = {
      ...part,
      state: {
        ...part.state,
        input: { todos: [{ content: "Legacy input", status: "pending" }] },
        metadata: { todos: [{ content: "Legacy result", status: "completed" }] },
      },
    }
    expect(toolInlineInfo(legacy).body).toBe("[✓] Legacy result")
    expect(toolEntryBody(commit(legacy), "")).toMatchObject({
      snapshot: { items: [{ content: "Legacy result", status: "completed" }] },
    })
    const empty = { ...legacy, state: { ...legacy.state, metadata: { todos: [] } } }
    expect(toolInlineInfo(empty).body).toBe("")
    expect(toolEntryBody(commit(empty), "")).toMatchObject({ snapshot: { items: [] } })
  })

  test("empty canonical snapshots never revive legacy rows", () => {
    const part = completed([])
    if (part.state.status !== "completed") throw new Error("expected a completed Task fixture")
    const legacy = [{ content: "Obsolete legacy row", status: "pending" }]
    const snapshot = {
      ...part,
      state: { ...part.state, input: { todos: legacy }, metadata: { tasks: [], todos: legacy } },
    }
    expect(toolInlineInfo(snapshot).body).toBe("")
    expect(toolEntryBody(commit(snapshot), "")).toMatchObject({ snapshot: { items: [] } })
    const input = {
      ...snapshot,
      state: { ...snapshot.state, input: { tasks: [], todos: legacy }, metadata: { todos: legacy } },
    }
    expect(toolInlineInfo(input).body).toBe("")
    expect(toolEntryBody(commit(input), "")).toMatchObject({ snapshot: { items: [] } })
  })
})
