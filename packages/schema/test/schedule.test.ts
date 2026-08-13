import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Schedule } from "../src/index"

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
