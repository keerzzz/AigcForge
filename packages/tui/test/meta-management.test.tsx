import { expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { SessionCommunication } from "@aigcfroge/schema/session-communication"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

const session = {
  id: "ses_meta_management",
  title: "Meta management",
  projectID: "proj_test",
  mode: "coding",
  agent: "meta",
  controller: { kind: "root", metaAgentID: "mag_management", rootSessionID: "ses_meta_management" },
  executorPreference: { agent: "build", model: { providerID: "demo", id: "demo" } },
  location: { directory },
  model: { providerID: "demo", id: "demo" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}
const count = { steps: 0, attempts: 0, recordedTokens: 0, sharedTokens: 0, unknownAttempts: 0, pendingAttempts: 0 }
const goal = {
  id: "gol_management",
  sessionID: session.id,
  metaAgentID: "mag_management",
  agent: "meta",
  selection: { agent: "meta" },
  objective: "Ship this exact complete objective",
  conditions: [{ id: "accepted", kind: "human_acceptance", description: "User accepts the work" }],
  taskRefs: [],
  revision: 2,
  revisionCreatedAt: 0,
  status: "active",
  pauseVersion: 0,
  budget: {},
  rounds: [],
  attempts: [],
  evidence: [],
  currentEvidenceIDs: [],
  evidenceSetDigest: "a1".repeat(32),
  satisfiedConditionIDs: [],
  activeMilliseconds: 0,
  accounting: {
    rounds: 0,
    activeMilliseconds: 0,
    coordinator: count,
    worker: count,
    compaction: count,
    auxiliary: count,
  },
  createdAt: 0,
  updatedAt: 0,
}
const rule = {
  id: "sch_management",
  sessionID: session.id,
  kind: "reminder",
  content: "Review the completed work",
  dueAt: 100,
  timezone: "Asia/Shanghai",
  executionPolicy: { delivery: "queue", missed: "catch_up" },
  revision: 1,
  status: "pending",
  nextDueAt: 100,
  createdAt: 0,
  updatedAt: 0,
}

test("Goal and Schedule lists render saved state and revoke writes after switching away from Meta", async () => {
  let agent = "meta"
  let canonicalGoal = { ...goal }
  const mutations: { path: string; body: unknown }[] = []
  await using setup = await createAppFixture({
    args: { sessionID: session.id },
    width: 85,
    height: 30,
    config: { animations: false, keybinds: { "session.goal.manage": "f9", "session.schedule.manage": "f10" } },
    fetch: async (url, request) => {
      const location = { directory, project: { id: "proj_test", directory, canonical: directory } }
      if (url.pathname === "/api/agent")
        return json({
          location,
          data: ["meta", "build"].map((id) => ({ id, mode: "primary", hidden: false, permissions: [] })),
        })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({
          location,
          data: [{ id: "demo", providerID: "demo", name: "Demo", variants: [], cost: [], time: { released: 0 } }],
        })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: { ...session, agent } })
      if (url.pathname === `/session/${session.id}/identity`)
        return json({
          sessionID: session.id,
          agent,
          location: session.location,
          coordination: { available: agent === "meta", reasons: [], selection: { agent } },
        })
      if (url.pathname === `/api/session/${session.id}/goal`) return json({ data: [canonicalGoal] })
      if (url.pathname === `/api/session/${session.id}/goal/${goal.id}/pause`) {
        mutations.push({ path: url.pathname, body: await request.json() })
        canonicalGoal = { ...canonicalGoal, status: "paused" }
        return json({ data: canonicalGoal })
      }
      if (url.pathname === `/schedule/rules/${session.id}`) return json([rule])
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
    },
  })
  await setup.ready
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable instanceof TextareaRenderable)
  setup.mockInput.pressKey("p", { ctrl: true })
  await setup.waitForFrame(
    (frame) => frame.includes("Commands") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
  await setup.mockInput.typeText("Manage Goals")
  await setup.waitForFrame((frame) => frame.split("Manage Goals").length >= 3)
  expect(setup.captureCharFrame().split("Manage Goals").length - 1).toBeGreaterThanOrEqual(2)
  setup.mockInput.pressEscape()
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable instanceof TextareaRenderable)
  setup.mockInput.pressKey("F9")
  await setup.waitForFrame((frame) => frame.includes("Session Goals") && frame.includes(goal.objective))
  await setup.waitForFrame((frame) => frame.includes("New Goal"))
  expect(setup.captureCharFrame()).toContain("revision 2")
  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) =>
      frame.includes("Pause Goal continuation") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
  await setup.mockInput.typeText("Pause Goal")
  await setup.renderOnce()
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Session Goals") && frame.includes("paused"))
  expect(mutations).toEqual([
    { path: `/api/session/${session.id}/goal/${goal.id}/pause`, body: { expectedRevision: goal.revision } },
  ])
  setup.mockInput.pressEscape()
  setup.mockInput.pressKey("F10")
  await setup.waitForFrame((frame) => frame.includes("Scheduled work") && frame.includes(rule.content))
  expect(setup.captureCharFrame()).toContain(rule.timezone)
  setup.mockInput.pressEscape()
  agent = "build"
  setup.events.emit({
    type: "session.agent.selected",
    id: "evt_meta_management_build",
    created: 10,
    durable: { aggregateID: session.id, seq: 1, version: 1 },
    data: { sessionID: session.id, agent },
  })
  setup.mockInput.pressKey("F9")
  await setup.waitForFrame(
    (frame) => frame.includes("Session Goals") && frame.includes(goal.objective) && !frame.includes("New Goal"),
  )
  expect(mutations).toHaveLength(1)
})

test.each([48, 120])("coordination notices retain the body and exact reply identity at width %s", async (width) => {
  const record: typeof SessionCommunication.Record.Encoded = {
    id: "com_tui_reply",
    actor: { type: "tool", sessionID: "ses_sender", agent: "meta", messageID: "msg_tool", id: "send" },
    contentSource: { sessionID: "ses_worker", scope: "result" },
    targetSessionID: session.id,
    replyTo: "com_previous",
    body: { sessionID: session.id, inputID: "msg_notice", digest: "a1".repeat(32) },
    requestDigest: "b1".repeat(32),
    delivery: "queue",
    trigger: true,
    createdAt: 1,
  }
  const body = "Complete result line one\nFinal result line two"
  const liveRecord: typeof SessionCommunication.Record.Encoded = {
    ...record,
    id: "com_tui_sse",
    replyTo: record.id,
    body: { ...record.body, inputID: "msg_notice_sse" },
    createdAt: 2,
  }
  const liveBody = "SSE result line one\nSSE result line two"
  await using setup = await createAppFixture({
    width,
    height: 28,
    args: { sessionID: session.id },
    fetch: async (url) => {
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === "/api/session")
        return json({
          data: [
            session,
            { ...session, id: "ses_sender", title: "Sender" },
            { ...session, id: "ses_worker", title: "Worker" },
          ],
          cursor: {},
        })
      if (url.pathname === `/api/session/${session.id}/message`)
        return json({
          data: [
            {
              id: "msg_notice",
              type: "synthetic",
              text: body,
              metadata: {
                source: "share",
                communication: { id: record.id },
                actorSessionID: record.actor.sessionID,
                contentSourceSessionID: record.contentSource.sessionID,
              },
              time: { created: 1 },
            },
            {
              id: "msg_internal",
              type: "synthetic",
              text: "Hidden internal marker",
              metadata: { source: "internal" },
              time: { created: 0 },
            },
          ],
          cursor: {},
        })
      if (url.pathname === `/api/session/${session.id}/communication/${record.id}`)
        return json({ data: { ...record, text: body, state: "visible" } })
      if (url.pathname === `/api/session/${session.id}/communication/${liveRecord.id}`)
        return json({ data: { ...liveRecord, text: liveBody, state: "visible" } })
      if (/^\/api\/session\/[^/]+\/(inbox|permission)$/.test(url.pathname)) return json({ data: [] })
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Final result line two") && frame.includes("com_previous"))
  const frame = setup.captureCharFrame()
  expect(frame).toContain("Complete result line one")
  expect(frame).toContain("content from")
  expect(frame.replace(/\s+/g, " ")).toContain("reply to com_previous")
  expect(frame).not.toContain("Hidden internal marker")
  setup.events.emit({
    type: "session.inbox.enqueued",
    id: "evt_notice_sse_admitted",
    created: 2,
    durable: { aggregateID: session.id, seq: 2, version: 1 },
    data: {
      sessionID: session.id,
      inboxID: liveRecord.body.inputID,
      item: {
        type: "synthetic",
        delivery: "queue",
        payload: { text: liveBody, metadata: { source: "share", communication: { id: liveRecord.id } } },
      },
      communication: liveRecord,
    },
  })
  setup.events.emit({
    type: "session.inbox.delivered",
    id: "evt_notice_sse_delivered",
    created: 3,
    durable: { aggregateID: session.id, seq: 3, version: 1 },
    data: { sessionID: session.id, inboxID: liveRecord.body.inputID },
  })
  await setup.waitForFrame(
    (next) => next.includes("SSE result line two") && next.replace(/\s+/g, " ").includes(`reply to ${record.id}`),
  )
  expect(setup.captureCharFrame()).toContain("SSE result line one")
})

test("operation permissions read durable Goal origin and complete delegated input", async () => {
  const operationID = "top_permission"
  const inputID = "msg_permission_input"
  const request = {
    id: "per_operation",
    sessionID: session.id,
    action: "task",
    resources: ["ses_permission_target"],
    source: { type: "operation", sessionID: session.id, operationID },
  }
  const operation = {
    sourceSessionID: session.id,
    sourceLocation: session.location,
    sourceMode: "coding",
    operationID,
    inputID,
    targetSessionID: "ses_permission_target",
    requestDigest: "a1".repeat(32),
    request: {
      operationID,
      inputID,
      target: { type: "existing_root", sessionID: "ses_permission_target" },
      description: "Review the delegated result",
      prompt: "Full delegated input\nKeep the exact second line",
      files: [],
      delivery: "queue",
      resume: true,
    },
    source: {
      type: "goal_round",
      sessionID: session.id,
      agent: "meta",
      goalID: goal.id,
      roundID: "round_permission",
      revision: goal.revision,
    },
    selection: { agent: "meta", seq: 1 },
    phase: "permission_pending",
    cancelIntent: false,
    createdAt: 1,
    updatedAt: 1,
  }
  const reads: URL[] = []
  await using setup = await createAppFixture({
    width: 85,
    height: 30,
    args: { sessionID: session.id },
    fetch: async (url) => {
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/permission`) return json({ data: [request] })
      if (url.pathname === `/session/${session.id}/task/operations/${operationID}`) {
        reads.push(url)
        return json(operation)
      }
      if (/^\/api\/session\/[^/]+\/(message|inbox)$/.test(url.pathname)) return json({ data: [], cursor: {} })
      return undefined
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Delegate task") && frame.includes("Keep the exact second line"))
  const frame = setup.captureCharFrame()
  expect(frame).toContain(`Operation: ${operationID}`)
  expect(frame).toContain(`Goal: ${goal.id} · revision ${goal.revision}`)
  expect(frame).toContain("Target Session: ses_permission_target")
  expect(frame).toContain("Full delegated input")
  expect(frame).not.toContain("Call tool task")
  expect(reads.length).toBeGreaterThan(0)
  expect(reads[0].searchParams.get("directory")).toBe(directory)
})
