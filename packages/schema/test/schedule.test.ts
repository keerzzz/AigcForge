import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Schedule } from "../src/index.js"
import { SessionID } from "../src/session-id.js"
import { SessionMessage } from "../src/session-message.js"
import { SessionTask } from "../src/session-task.js"

const valid = {
  id: "sch_abc123",
  sessionID: "ses_xyz",
  kind: "reminder",
  content: "Follow up with customer",
  dueAt: 1754110800000,
  timezone: "Asia/Shanghai",
  status: "pending",
  attempts: 0,
  deliveryKey: "delivery_1",
  createdAt: 1,
  updatedAt: 2,
}

describe("Schedule current rules", () => {
  test("public targets reject the retained internal child route", () => {
    expect(() =>
      Schema.decodeUnknownSync(Schedule.Create)({
        sessionID: "ses_rules",
        kind: "prompt",
        content: "scheduled work",
        dueAt: 60_000,
        timezone: "UTC",
        target: { policy: "legacy_child", agentID: "build" },
      }),
    ).toThrow()
  })

  test("creation does not encode caller-supplied source or claim fields", () => {
    const input = Schema.decodeUnknownSync(Schedule.Create)({
      sessionID: "ses_rules",
      kind: "reminder",
      content: "reminder",
      dueAt: 60_000,
      timezone: "UTC",
      sourceAgent: "meta",
      revision: 99,
      activeOccurrenceID: "sco_fake",
    })
    const encoded = Schema.encodeSync(Schedule.Create)(input)
    expect(Object.hasOwn(encoded, "sourceAgent")).toBe(false)
    expect(Object.hasOwn(encoded, "revision")).toBe(false)
    expect(Object.hasOwn(encoded, "activeOccurrenceID")).toBe(false)
  })

  test("current rule status separates an unresolved occurrence from legacy running", () => {
    expect(() => Schema.decodeUnknownSync(Schedule.RuleStatus)("running")).toThrow()
    expect(Schema.decodeUnknownSync(Schedule.OccurrenceStatus)("recovery_required")).toBe("recovery_required")
    expect(Schema.decodeUnknownSync(Schedule.ScheduleStatus)("running")).toBe("running")
  })

  test("occurrence optional provenance fields omit undefined on the wire", () => {
    const snapshot = new Schedule.Rule({
      id: Schedule.ID.make("sch_rules"),
      sessionID: SessionID.make("ses_rules"),
      kind: "reminder",
      content: "reminder",
      dueAt: 60_000,
      timezone: "UTC",
      revision: 1,
      status: "pending",
      executionPolicy: new Schedule.ExecutionPolicy({ delivery: "queue", missed: "catch_up" }),
      createdAt: 0,
      updatedAt: 0,
    })
    const run = new Schedule.Occurrence({
      id: Schedule.OccurrenceID.make("sco_rules"),
      scheduleID: snapshot.id,
      sessionID: snapshot.sessionID,
      ruleRevision: 1,
      snapshot,
      scheduledAt: 60_000,
      claimedAt: 60_000,
      claimOwner: "schedule-host",
      caughtUp: false,
      status: "claimed",
      inputID: SessionMessage.ID.make("msg_rules"),
      operationID: SessionTask.OperationID.make("top_rules"),
      createdAt: 60_000,
      updatedAt: 60_000,
      admission: undefined,
      actorAgent: undefined,
      receipt: undefined,
      goalInputID: undefined,
    })
    const encoded = Schema.encodeSync(Schedule.Occurrence)(run)
    for (const key of ["admission", "actorAgent", "receipt", "goalInputID"])
      expect(Object.hasOwn(encoded, key)).toBe(false)
  })
})

describe("Schedule.Info", () => {
  test("decodes a valid reminder schedule", () => {
    const s = Schema.decodeUnknownSync(Schedule.Info)(valid)
    expect(s.id).toBe(Schedule.ID.make("sch_abc123"))
    expect(s.content).toBe("Follow up with customer")
    expect(s.dueAt).toBe(1754110800000)
    expect(s.timezone).toBe("Asia/Shanghai")
    expect(s.status).toBe("pending")
    expect(s.attempts).toBe(0)
  })

  test("rejects an unknown kind", () => {
    expect(() => Schema.decodeUnknownSync(Schedule.Info)({ ...valid, kind: "todo" })).toThrow()
  })

  test("rejects an unknown status", () => {
    expect(() => Schema.decodeUnknownSync(Schedule.Info)({ ...valid, status: "queued" })).toThrow()
  })

  test("rejects a malformed id prefix", () => {
    expect(() => Schema.decodeUnknownSync(Schedule.Info)({ ...valid, id: "ses_wrong_prefix" })).toThrow()
  })

  test("rejects a missing deliveryKey (idempotency invariant)", () => {
    const { deliveryKey, ...without } = valid
    void deliveryKey
    expect(() => Schema.decodeUnknownSync(Schedule.Info)(without)).toThrow()
  })

  test("omits optional lease fields without error", () => {
    const s = Schema.decodeUnknownSync(Schedule.Info)(valid)
    expect(s.leaseOwner).toBeUndefined()
    expect(s.leaseExpiresAt).toBeUndefined()
    expect(s.nextAttemptAt).toBeUndefined()
  })

  test("ScheduleStatus literal set matches the contract", () => {
    const statuses = Schema.decodeUnknownSync(Schedule.ScheduleStatus)
    for (const status of ["pending", "running", "completed", "cancelled", "failed"] as const) {
      expect(statuses(status)).toBe(status)
    }
  })

  test("type-negative: ScheduleStatus is a closed literal union", () => {
    // @ts-expect-error ScheduleStatus is a 5-value literal union
    const bad: Schedule.ScheduleStatus = "queued"
    void bad
  })
})

describe("Schedule.Delivery", () => {
  test("decodes a valid delivery", () => {
    const s = Schema.decodeUnknownSync(Schedule.Delivery)({
      deliveryKey: "delivery_1",
      scheduleID: "sch_abc123",
      sessionID: "ses_xyz",
      kind: "reminder",
      content: "Follow up with customer",
      deliveredAt: 1754110860000,
      caughtUp: true,
      createdAt: 1754110860000,
    })
    expect(s.caughtUp).toBe(true)
    expect(s.content).toBe("Follow up with customer")
  })

  test("rejects a missing caughtUp marker", () => {
    expect(() =>
      Schema.decodeUnknownSync(Schedule.Delivery)({
        deliveryKey: "delivery_1",
        scheduleID: "sch_abc123",
        sessionID: "ses_xyz",
        kind: "reminder",
        content: "x",
        deliveredAt: 1,
        createdAt: 1,
      }),
    ).toThrow()
  })
})
