import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { SessionGoal } from "../src/session-goal.js"
import { Session } from "../src/session.js"
import { SessionGoalID } from "../src/session-goal-id.js"
import { SessionMessage } from "../src/session-message.js"
import { SessionTask } from "../src/session-task.js"

describe("SessionGoal canonical contracts", () => {
  test("emits and validates the exact Goal ID prefix", () => {
    expect(SessionGoal.ID).toBe(SessionGoalID.ID)
    expect(SessionGoal.RoundRef).toBe(SessionGoalID.RoundRef)
    expect(SessionGoal.ID.create()).toStartWith("gol_")
    expect(() => SessionGoal.ID.make("goal_wrong")).toThrow()
    expect(() => SessionGoal.ID.make("golwrong")).toThrow()
  })

  test("keeps explicit positive budgets and omits undefined optional fields", () => {
    const budget = SessionGoal.Budget.make({ rounds: 4, steps: undefined, attempts: 6, tokens: undefined })
    expect(Schema.encodeSync(SessionGoal.Budget)(budget)).toEqual({ rounds: 4, attempts: 6 })
    expect(Schema.encodeSync(SessionGoal.Budget)(SessionGoal.Budget.make({}))).toEqual({})
    expect(() => SessionGoal.Budget.make({ tokens: 0 })).toThrow()
    expect(() => SessionGoal.Budget.make({ attempts: -1 })).toThrow()
  })

  test("preserves canonical readonly Task operation and round provenance", () => {
    const operation = new SessionTask.OperationReadonlyRef({
      sourceSessionID: Session.ID.make("ses_owner"),
      operationID: SessionTask.OperationID.make("top_operation"),
    })
    const condition = SessionGoal.Condition.make({
      id: "check",
      kind: "command_result",
      command: "bun test",
      cwd: "/tmp",
      exit: 0,
      outputIncludes: [],
      operation,
      producer: undefined,
    })
    expect(Schema.encodeSync(SessionGoal.Condition)(condition)).toEqual({
      id: "check",
      kind: "command_result",
      command: "bun test",
      cwd: "/tmp",
      exit: 0,
      outputIncludes: [],
      operation: { sourceSessionID: "ses_owner", operationID: "top_operation" },
    })
    expect(
      Schema.decodeUnknownSync(SessionGoal.Condition)(Schema.encodeSync(SessionGoal.Condition)(condition)).operation,
    ).toBeInstanceOf(SessionTask.OperationReadonlyRef)
    expect(SessionGoal.Events.Updated.type).toBe("session.goal.updated")
  })

  test("preserves shared operation attribution and decodes operation-only attempt history", () => {
    const first = new SessionTask.OperationReadonlyRef({
      sourceSessionID: Session.ID.make("ses_owner"),
      operationID: SessionTask.OperationID.make("top_first"),
    })
    const second = new SessionTask.OperationReadonlyRef({
      sourceSessionID: Session.ID.make("ses_owner"),
      operationID: SessionTask.OperationID.make("top_second"),
    })
    const input = {
      id: "attempt",
      sessionID: Session.ID.make("ses_worker"),
      kind: "worker" as const,
      rounds: [
        SessionGoal.RoundRef.make({
          goalID: SessionGoal.ID.make("gol_goal"),
          sessionID: first.sourceSessionID,
          revision: 1,
          roundID: "round",
          inputID: SessionMessage.ID.make("msg_input"),
        }),
      ] as const,
      dispatchedAt: 1,
      operation: undefined,
      operations: [first, second],
    }
    const current = Schema.decodeUnknownSync(SessionGoal.Attempt)(
      Schema.encodeSync(SessionGoal.Attempt)(SessionGoal.Attempt.make(input)),
    )
    expect(current.operations).toHaveLength(2)
    expect(current.operations?.every((operation) => operation instanceof SessionTask.OperationReadonlyRef)).toBe(true)
    expect(Schema.encodeSync(SessionGoal.Attempt)(current)).not.toHaveProperty("operation")
    const legacy = Schema.decodeUnknownSync(SessionGoal.Attempt)(
      Schema.encodeSync(SessionGoal.Attempt)(
        SessionGoal.Attempt.make({ ...input, operation: first, operations: undefined }),
      ),
    )
    expect(legacy.operation).toBeInstanceOf(SessionTask.OperationReadonlyRef)
    expect(Schema.encodeSync(SessionGoal.Attempt)(legacy)).not.toHaveProperty("operations")
  })
})
