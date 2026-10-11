import { describe, expect, test } from "bun:test"
import { createAigcfrogeClient, type Session, type SessionMessage } from "@aigcfroge/sdk/v2/client"
import { CanonicalMessages } from "./canonical-messages"

const session: Session = {
  id: "ses_test",
  title: "Assistant",
  mode: "assistant",
  agent: "assistant-orchestrator",
  model: { providerID: "test", id: "model" },
  directory: "/test",
  slug: "test",
  version: "test",
  projectID: "project",
  time: { created: 1, updated: 1 },
}
const model = { providerID: "test", id: "model" }

describe("canonical conversation presentation", () => {
  test("text and reasoning with the same provider ID keep separate live buffers", () => {
    const projected = CanonicalMessages.project(session, [
      {
        id: "msg_shared",
        type: "assistant",
        agent: "assistant-orchestrator",
        model,
        time: { created: 1 },
        content: [
          { type: "reasoning", id: "shared", text: "" },
          { type: "text", id: "shared", text: "" },
        ],
      },
    ])
    const stream = CanonicalMessages.createStream()
    const parts = { msg_shared: projected.part[0].part }
    const base = { sessionID: session.id, assistantMessageID: "msg_shared", timestamp: 1 }
    stream.update(
      {
        id: "evt_reasoning.delta",
        type: "session.next.reasoning.delta",
        properties: { ...base, reasoningID: "shared", delta: "thinking" },
      },
      parts,
    )
    const text = stream.update(
      {
        id: "evt_text.delta",
        type: "session.next.text.delta",
        properties: { ...base, textID: "shared", delta: "answer" },
      },
      parts,
    )
    expect(text?.parts).toMatchObject([
      { type: "reasoning", text: "thinking" },
      { type: "text", text: "answer" },
    ])
    const ended = stream.update(
      {
        id: "evt_text.ended",
        type: "session.next.text.ended",
        properties: { ...base, textID: "shared", text: "done" },
      },
      parts,
    )
    expect(ended?.parts).toMatchObject([
      { type: "reasoning", text: "thinking" },
      { type: "text", text: "done" },
    ])
  })

  test("refreshes the full loaded window beyond the API's 200-record cap", async () => {
    const fixture = messagePages(600)
    const page = await CanonicalMessages.page(fixture.client, session, 400)
    expect(page.session.map((message) => message.id)).toEqual(fixture.ids.slice(200))
    expect(page.cursor).toBe("400")
    expect(page.complete).toBe(false)
    expect(fixture.reads.map((url) => url.searchParams.get("limit"))).toEqual(["200", "200"])
    expect(fixture.reads.map((url) => url.searchParams.get("cursor"))).toEqual([null, "200"])
  })

  test("metadata rows do not count toward the requested visible history and every assistant keeps its user", async () => {
    const fixture = messagePages(600, true)
    const page = await CanonicalMessages.page(fixture.client, session, 401)
    expect(page.session.length).toBeGreaterThanOrEqual(401)
    expect(page.session[0]?.role).toBe("user")
    expect(page.session.map((message) => message.id)).toEqual(fixture.ids.slice(-page.session.length))
    expect(
      page.session
        .filter((message) => message.role === "assistant")
        .every((message) => page.session.some((parent) => parent.role === "user" && parent.id === message.parentID)),
    ).toBe(true)
    expect(page.complete).toBe(false)
  })

  test("continues a cursor page past a long tool loop to the actual user boundary", async () => {
    const fixture = messagePages(504)
    const initial = await CanonicalMessages.page(fixture.client, session, 200)
    const older = await CanonicalMessages.page(fixture.client, session, 201, initial.cursor)
    expect(older.session.length).toBeGreaterThanOrEqual(201)
    expect(older.session[0]?.role).toBe("user")
    expect(older.session.at(-1)?.id).toBe(fixture.ids.at(-201))
    expect(older.session.some((message) => initial.session.some((newer) => newer.id === message.id))).toBe(false)
    const oldest = await CanonicalMessages.page(fixture.client, session, 400, older.cursor)
    expect(oldest.complete).toBe(true)
    expect(oldest.session[0]?.id).toBe(fixture.ids[0])
  })

  test("keeps each provider turn with its user and preserves terminal tool evidence and content order", () => {
    const messages: SessionMessage[] = [
      { id: "msg_0", type: "agent-switched", agent: "assistant-orchestrator", time: { created: 1 } },
      { id: "msg_1", type: "user", text: "show reminder details", time: { created: 2 } },
      {
        id: "msg_2",
        type: "assistant",
        agent: "assistant-orchestrator",
        model,
        time: { created: 3, completed: 4 },
        content: [{ type: "text", id: "text_z", text: "Please confirm" }],
        finish: "stop",
      },
      { id: "msg_3", type: "user", text: "confirmed", time: { created: 5 } },
      {
        id: "msg_4",
        type: "assistant",
        agent: "assistant-orchestrator",
        model,
        time: { created: 6, completed: 7 },
        content: [
          { type: "reasoning", id: "reason_z", text: "Create the confirmed reminder" },
          {
            type: "tool",
            id: "call_a",
            name: "reminder_create",
            time: { created: 6, ran: 6, completed: 7 },
            state: {
              status: "completed",
              input: { content: "meeting" },
              structured: { scheduleID: "schedule_1" },
              content: [{ type: "text", text: "Reminder created" }],
            },
          },
        ],
        finish: "tool-calls",
      },
      {
        id: "msg_5",
        type: "assistant",
        agent: "assistant-orchestrator",
        model,
        time: { created: 8, completed: 9 },
        content: [{ type: "text", id: "text_a", text: "Done" }],
        finish: "stop",
      },
    ]
    const page = CanonicalMessages.project(session, messages)
    expect(page.session.map((message) => message.id)).toEqual(["msg_1", "msg_2", "msg_3", "msg_4", "msg_5"])
    expect(page.session.filter((message) => message.role === "assistant").map((message) => message.parentID)).toEqual([
      "msg_1",
      "msg_3",
      "msg_3",
    ])
    const parts = page.part.find((item) => item.id === "msg_4")?.part ?? []
    expect(parts.map((part) => part.type)).toEqual(["reasoning", "tool"])
    expect(parts.toSorted((a, b) => a.id.localeCompare(b.id))).toEqual(parts)
    expect(parts[1]).toMatchObject({
      tool: "reminder_create",
      callID: "call_a",
      state: {
        status: "completed",
        input: { content: "meeting" },
        output: "Reminder created",
        metadata: { scheduleID: "schedule_1" },
      },
    })
  })

  test("preserves user attachments and tool failures without fabricating success", () => {
    const page = CanonicalMessages.project(session, [
      {
        id: "msg_1",
        type: "user",
        text: "read",
        files: [{ uri: "file:///test/note.md", mime: "text/markdown", name: "note.md" }],
        time: { created: 1 },
      },
      {
        id: "msg_2",
        type: "assistant",
        agent: "assistant-orchestrator",
        model,
        time: { created: 2, completed: 3 },
        error: { type: "unknown", message: "interrupted" },
        content: [
          {
            type: "tool",
            id: "call_1",
            name: "reminder_create",
            time: { created: 2, completed: 3 },
            state: {
              status: "error",
              input: {},
              content: [],
              structured: {},
              error: { type: "unknown", message: "permission denied" },
            },
          },
        ],
      },
    ])
    expect(page.part[0]?.part[1]).toMatchObject({ type: "file", url: "file:///test/note.md", filename: "note.md" })
    expect(page.part[1]?.part[0]).toMatchObject({ state: { status: "error", error: "permission denied" } })
    expect(page.session[1]).toMatchObject({ error: { name: "UnknownError", data: { message: "interrupted" } } })
  })
})

function messagePages(count: number, metadata = false) {
  const messages: SessionMessage[] = Array.from({ length: count }, (_, index) => {
    const id = `msg_${String(index).padStart(4, "0")}`
    if (index % 2 === 0) return { id, type: "user", text: id, time: { created: index } }
    return {
      id,
      type: "assistant",
      agent: "assistant-orchestrator",
      model,
      time: { created: index, completed: index + 1 },
      content: [{ type: "text", id: `text_${index}`, text: id }],
      finish: "stop",
    }
  })
  const rows: SessionMessage[] = messages
    .flatMap((message): SessionMessage[] =>
      metadata && message.type === "user"
        ? [{ id: `${message.id}_switch`, type: "model-switched", model, time: message.time }, message]
        : [message],
    )
    .toReversed()
  const reads: URL[] = []
  const client = createAigcfrogeClient({
    baseUrl: "http://canonical.test",
    fetch: Object.assign(
      async (input: RequestInfo | URL) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        if (url.pathname !== `/api/session/${session.id}/message`)
          throw new Error(`Unexpected request: ${url.pathname}`)
        reads.push(url)
        const start = Number(url.searchParams.get("cursor") ?? 0)
        const end = Math.min(rows.length, start + Math.min(200, Number(url.searchParams.get("limit"))))
        return Response.json({
          data: rows.slice(start, end),
          cursor: { next: end < rows.length ? String(end) : undefined },
        })
      },
      { preconnect() {} },
    ),
  })
  return { client, reads, ids: messages.map((message) => message.id) }
}
