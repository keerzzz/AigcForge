import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { SessionTask } from "../src/index.js"

const valid = {
  id: "tsk_abc123",
  content: "Audit auth",
  status: "in_progress",
  priority: "high",
  sessionID: "ses_xyz",
  parentID: "tsk_parent",
  outputDigest: "digest",
  revision: 1,
  createdAt: 1,
  updatedAt: 2,
}

describe("SessionTask.Info", () => {
  test("decodes a valid M0 task", () => {
    const s = Schema.decodeUnknownSync(SessionTask.Info)(valid)
    expect(s.id).toBe("tsk_abc123")
    expect(s.content).toBe("Audit auth")
    expect(s.status).toBe("in_progress")
    expect(s.priority).toBe("high")
    expect(s.sessionID).toBe("ses_xyz")
    expect(s.parentID).toBe("tsk_parent")
  })

  test("rejects an unknown status", () => {
    expect(() => Schema.decodeUnknownSync(SessionTask.Info)({ ...valid, status: "foo" })).toThrow()
  })

  test("rejects an unknown priority", () => {
    expect(() => Schema.decodeUnknownSync(SessionTask.Info)({ ...valid, priority: "bogus" })).toThrow()
  })

  test("omits optional fields without error", () => {
    const input = {
      id: "tsk_1",
      content: "x",
      status: "pending",
      priority: "low",
      sessionID: "ses_1",
      revision: 1,
      createdAt: 1,
      updatedAt: 2,
    } as const
    const s = new SessionTask.Info({
      ...input,
      parentID: undefined,
      outputDigest: undefined,
      agentID: undefined,
      scheduledAt: undefined,
      recurrence: undefined,
      nextRun: undefined,
      spawnedFrom: undefined,
      dependsOn: undefined,
    })
    expect(s.parentID).toBeUndefined()
    expect(s.outputDigest).toBeUndefined()
    expect(s.agentID).toBeUndefined()
    expect(Schema.encodeSync(Schema.toCodecJson(SessionTask.Info))(s)).toStrictEqual(input)
    expect(Schema.encodeSync(SessionTask.Info)(s)).toStrictEqual(input)
  })

  test("requires id", () => {
    expect(() =>
      Schema.decodeUnknownSync(SessionTask.Info)({
        content: "x",
        status: "pending",
        priority: "low",
        sessionID: "ses_1",
        revision: 1,
        createdAt: 1,
        updatedAt: 2,
      }),
    ).toThrow()
  })

  test("requires content", () => {
    expect(() =>
      Schema.decodeUnknownSync(SessionTask.Info)({
        id: "tsk_1",
        status: "pending",
        priority: "low",
        sessionID: "ses_1",
        revision: 1,
        createdAt: 1,
        updatedAt: 2,
      }),
    ).toThrow()
  })

  test("requires sessionID", () => {
    expect(() =>
      Schema.decodeUnknownSync(SessionTask.Info)({
        id: "tsk_1",
        content: "x",
        status: "pending",
        priority: "low",
        revision: 1,
        createdAt: 1,
        updatedAt: 2,
      }),
    ).toThrow()
  })

  test("TaskStatus literal set matches contract", () => {
    const statuses = Schema.decodeUnknownSync(SessionTask.TaskStatus)
    expect(statuses("pending")).toBe("pending")
    expect(statuses("in_progress")).toBe("in_progress")
    expect(statuses("completed")).toBe("completed")
    expect(statuses("cancelled")).toBe("cancelled")
    expect(statuses("scheduled")).toBe("scheduled")
    expect(statuses("failed")).toBe("failed")
  })
})

const operationRequest = {
  operationID: "top_contract",
  inputID: "msg_operation_input",
  target: { type: "existing_root", sessionID: "ses_target" },
  prompt: "Review the attached change",
  files: [{ uri: "file:///tmp/change.ts", name: "change.ts" }],
  delivery: "steer",
  resume: false,
}

const operationPrepared = {
  payload: {
    text: "Review the attached change with the captured context",
    files: [{ data: "Y2hhbmdl", mime: "text/plain", source: { type: "inline" }, name: "change.ts" }],
    agents: [{ name: "plan" }],
    skills: [{ id: "review", name: "Review", text: "Check the actual change" }],
    metadata: { origin: "prepare-hook", revision: 2 },
  },
  delivery: "queue",
  digest: "a1".repeat(32),
}

describe("SessionTask operations", () => {
  test("generated operation IDs match the exact emitted prefix", () => {
    const id = SessionTask.OperationID.create()
    expect(id.startsWith("top_")).toBe(true)
    expect(Schema.decodeUnknownSync(SessionTask.OperationID)(id)).toBe(id)
    ;["top", "top_", "top-other", "tsk_operation", "top_with space"].forEach((invalid) =>
      expect(() => Schema.decodeUnknownSync(SessionTask.OperationID)(invalid)).toThrow(),
    )
  })

  test("Tasks retain an operation lookup reference through JSON encoding", () => {
    const input = {
      ...valid,
      operationRef: { sourceSessionID: "ses_origin", operationID: "top_contract" },
    }
    expect(
      Schema.encodeSync(Schema.toCodecJson(SessionTask.Info))(Schema.decodeUnknownSync(SessionTask.Info)(input)),
    ).toStrictEqual(input)
    expect(() =>
      Schema.decodeUnknownSync(SessionTask.Info)({
        ...valid,
        operationRef: { sourceSessionID: "ses_origin", boundary: { type: "through", messageID: "msg_context" } },
      }),
    ).toThrow()
  })

  test("preserves the provenance of model tools, user coordination, goals, and schedules", () => {
    const sources = [
      { type: "model_tool", sessionID: "ses_origin", agent: "meta", messageID: "msg_call", id: "call_1" },
      { type: "user_coordination", sessionID: "ses_origin", agent: "meta" },
      { type: "goal_round", sessionID: "ses_origin", agent: "meta", goalID: "goal_1", roundID: "round_1", revision: 1 },
      {
        type: "schedule_occurrence",
        sessionID: "ses_origin",
        agent: "meta",
        scheduleID: "schedule_1",
        occurrenceID: "occurrence_1",
        revision: 2,
      },
    ] as const
    sources.forEach((source) =>
      expect(
        Schema.encodeSync(Schema.toCodecJson(SessionTask.OperationSource))(
          Schema.decodeUnknownSync(SessionTask.OperationSource)(source),
        ),
      ).toStrictEqual(source),
    )
  })

  test("goal and schedule provenance requires a positive integral revision", () => {
    const sources = [
      { type: "goal_round", goalID: "goal_1", roundID: "round_1" },
      { type: "schedule_occurrence", scheduleID: "schedule_1", occurrenceID: "occurrence_1" },
    ] as const
    sources.forEach((source) =>
      [undefined, 0, -1, 1.5].forEach((revision) =>
        expect(() =>
          Schema.decodeUnknownSync(SessionTask.OperationSource)({
            ...source,
            sessionID: "ses_origin",
            agent: "meta",
            revision,
          }),
        ).toThrow(),
      ),
    )
  })

  test("admits an existing-root request without a Task binding and preserves URI attachments", () => {
    const request = Schema.decodeUnknownSync(SessionTask.OperationRequest)(operationRequest)
    expect(request.taskID).toBeUndefined()
    expect(request.resume).toBe(false)
    expect(Schema.encodeSync(Schema.toCodecJson(SessionTask.OperationRequest))(request)).toStrictEqual(operationRequest)
    expect(() =>
      Schema.decodeUnknownSync(SessionTask.OperationRequest)({
        ...operationRequest,
        files: operationPrepared.payload.files,
      }),
    ).toThrow()
  })

  test("preserves a composed custom root and its executor preference", () => {
    const request = {
      ...operationRequest,
      taskID: "tsk_bound",
      expectedRevision: 3,
      target: {
        type: "new_root",
        mode: "custom",
        location: { directory: "/tmp/operation-target" },
        agent: "build",
        model: { providerID: "fixture", id: "model" },
        executorPreference: { agent: "plan" },
        composition: { source: "profile", profilePath: "profiles/review.json", profileRevision: "a1".repeat(32) },
        expectedPlanDigest: "a1".repeat(32),
        title: "Review root",
      },
    }
    expect(
      Schema.encodeSync(Schema.toCodecJson(SessionTask.OperationRequest))(
        Schema.decodeUnknownSync(SessionTask.OperationRequest)(request),
      ),
    ).toStrictEqual(request)
  })

  test("freezes the expanded payload, effective delivery, and readonly reference", () => {
    const input = {
      ...operationPrepared,
      reference: {
        sourceSessionID: "ses_origin",
        boundary: { type: "through", messageID: "msg_context" },
        boundarySeq: 5,
        sourceMessageIDs: ["msg_context"],
        digest: "b2".repeat(32),
        omissions: [],
        file: { data: "Y29udGV4dA==", mime: "text/plain", source: { type: "inline" }, name: "context.txt" },
      },
    }
    const prepared = Schema.decodeUnknownSync(SessionTask.OperationPrepared)(input)
    expect(prepared.delivery).toBe("queue")
    expect(Schema.encodeSync(Schema.toCodecJson(SessionTask.OperationPrepared))(prepared)).toStrictEqual(input)
    expect(() =>
      Schema.decodeUnknownSync(SessionTask.OperationPrepared)({ ...operationPrepared, delivery: undefined }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(SessionTask.OperationPrepared)({
        ...operationPrepared,
        payload: { ...operationPrepared.payload, files: operationRequest.files },
      }),
    ).toThrow()
  })

  test("operation digests accept lowercase SHA-256 only", () => {
    expect(Schema.decodeUnknownSync(SessionTask.OperationDigest)(operationPrepared.digest)).toStrictEqual(
      SessionTask.OperationDigest.make(operationPrepared.digest),
    )
    ;["a1".repeat(31), "a1".repeat(33), "A1".repeat(32), "g1".repeat(32)].forEach((digest) =>
      expect(() => Schema.decodeUnknownSync(SessionTask.OperationDigest)(digest)).toThrow(),
    )
  })

  test("encodes a prepared operation without a Task binding", () => {
    const input = {
      sourceSessionID: "ses_origin",
      sourceLocation: { directory: "/tmp/operation-origin" },
      sourceMode: "coding",
      operationID: operationRequest.operationID,
      inputID: operationRequest.inputID,
      requestDigest: "b2".repeat(32),
      request: operationRequest,
      source: { type: "user_coordination", sessionID: "ses_origin", agent: "meta" },
      selection: { agent: "meta", eventID: "evt_selection", seq: 5, compositionDigest: "c3".repeat(32) },
      phase: "prepared",
      cancelIntent: false,
      prepared: operationPrepared,
      createdAt: 1,
      updatedAt: 2,
    }
    const operation = Schema.decodeUnknownSync(SessionTask.OperationInfo)(input)
    expect(operation.taskID).toBeUndefined()
    expect(operation.request.delivery).toBe("steer")
    expect(operation.prepared?.delivery).toBe("queue")
    expect(Schema.encodeSync(Schema.toCodecJson(SessionTask.OperationInfo))(operation)).toStrictEqual(input)
  })

  test("operation changes can clear errors without replacing admission identity", () => {
    const change = Schema.decodeUnknownSync(SessionTask.OperationChange)({
      phase: "blocked",
      cancelIntent: true,
      error: null,
      operationID: "top_replacement",
      inputID: "msg_replacement",
      request: operationRequest,
      source: { type: "user_coordination", sessionID: "ses_other", agent: "build" },
      selection: { agent: "build", seq: 99 },
    })
    expect(Schema.encodeSync(Schema.toCodecJson(SessionTask.OperationChange))(change)).toStrictEqual({
      phase: "blocked",
      cancelIntent: true,
      error: null,
    })
  })
})
