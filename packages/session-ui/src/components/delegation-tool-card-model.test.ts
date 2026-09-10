import { describe, expect, test } from "bun:test"
import { delegationToolCardModel } from "./delegation-tool-card-model"

describe("delegationToolCardModel", () => {
  test("projects participants, ordered turns and recovery state without summary parsing", () => {
    const model = delegationToolCardModel({
      id: "dlg_1",
      title: "Implement and review",
      status: "recovery_required",
      lastActivityAt: 1,
      softExpired: false,
      participants: [
        { id: "par_build", role: "implementer", target: "build", childSessionID: "ses_build" },
        { id: "par_codex", role: "reviewer", target: "codex", externalThreadID: "thread_codex" },
      ],
      turns: [
        { id: "trn_2", seq: 2, status: "recovery_required" },
        { id: "trn_1", seq: 1, status: "completed" },
      ],
    })
    expect(model.status).toBe("recovery_required")
    expect(model.participants.map((item) => [item.role, item.href, item.external])).toEqual([
      ["implementer", "ses_build", false],
      ["reviewer", undefined, true],
    ])
    expect(model.turns.map((item) => item.id)).toEqual(["trn_1", "trn_2"])
  })

  test("soft expiry is a derived presentation and does not mutate domain status", () => {
    const model = delegationToolCardModel({
      id: "dlg_2",
      title: "Idle",
      status: "running",
      lastActivityAt: 1,
      softExpired: true,
      participants: [],
      turns: [],
    })
    expect(model.status).toBe("expired")
  })
})
