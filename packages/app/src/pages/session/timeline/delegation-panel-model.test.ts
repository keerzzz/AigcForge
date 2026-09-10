import { describe, expect, test } from "bun:test"
import { delegationListInput, delegationPanelModel } from "./delegation-panel-model"

describe("delegationListInput", () => {
  test("omits archived and soft-expired history by default", () => {
    expect(delegationListInput("/repo", "ses_parent", false)).toEqual({
      location: { directory: "/repo" },
      parentSessionID: "ses_parent",
    })
  })

  test("requests history only after explicit opt-in", () => {
    expect(delegationListInput("/repo", "ses_parent", true)).toEqual({
      location: { directory: "/repo" },
      parentSessionID: "ses_parent",
      includeArchived: "true",
    })
  })
})

describe("delegationPanelModel", () => {
  test("keeps two delegations under one parent isolated", () => {
    const items = ["one", "two"].map((id, index) => ({
      delegation: {
        id: `dlg_${id}`,
        parentSessionID: "ses_parent",
        title: id,
        status: "running",
        lastActivityAt: index,
      },
      participants: [
        {
          id: `par_${id}`,
          role: index ? "reviewer" : "implementer",
          target: index ? "codex" : "build",
          childSessionID: `ses_${id}`,
        },
      ],
      turns: [{ id: `trn_${id}`, seq: 1, status: "running" }],
      softExpired: false,
    }))
    const model = delegationPanelModel(items, "ses_parent")
    expect(model.map((item) => item.id)).toEqual(["dlg_one", "dlg_two"])
    expect(model.map((item) => item.participants[0]?.id)).toEqual(["par_one", "par_two"])
  })

  test("projects soft expiry without changing the source status", () => {
    const item = {
      delegation: { id: "dlg_old", parentSessionID: "ses_parent", title: "old", status: "running", lastActivityAt: 1 },
      participants: [],
      turns: [],
      softExpired: true,
    }
    expect(delegationPanelModel([item], "ses_parent")[0]?.status).toBe("expired")
    expect(item.delegation.status).toBe("running")
  })
})
