import { describe, expect, test } from "bun:test"
import { delegationListInput, delegationPanelModel, type DelegationPanelItem } from "./delegation-panel-model"

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

describe("AI-TDD-S04-R03 participant identity", () => {
  test("does not merge same-target, same-role participants or same-title delegations", () => {
    const items = [
      {
        delegation: { id: "dlg_a", parentSessionID: "ses_parent", title: "same", status: "running", lastActivityAt: 1 },
        participants: [
          { id: "par_a", role: "implementer", target: "build", childSessionID: "ses_child_a" },
          { id: "par_b", role: "implementer", target: "build", childSessionID: "ses_child_b" },
        ],
        turns: [],
        softExpired: false,
      },
      {
        delegation: { id: "dlg_b", parentSessionID: "ses_parent", title: "same", status: "failed", lastActivityAt: 2 },
        participants: [{ id: "par_c", role: "implementer", target: "build", childSessionID: "ses_child_c" }],
        turns: [],
        softExpired: false,
      },
      {
        delegation: {
          id: "dlg_other",
          parentSessionID: "ses_other",
          title: "same",
          status: "running",
          lastActivityAt: 3,
        },
        participants: [{ id: "par_other", role: "implementer", target: "build", childSessionID: "ses_other_child" }],
        turns: [],
        softExpired: false,
      },
    ] satisfies DelegationPanelItem[]

    const rows = delegationPanelModel(items, "ses_parent")
    expect(rows.map((row) => row.id)).toEqual(["dlg_a", "dlg_b"])
    expect(
      rows.flatMap((row) => row.participants.map((participant) => ({ id: participant.id, href: participant.href }))),
    ).toEqual([
      { id: "par_a", href: "ses_child_a" },
      { id: "par_b", href: "ses_child_b" },
      { id: "par_c", href: "ses_child_c" },
    ])
  })
})

describe("AI-TDD-S04-R04 stable delegation relations", () => {
  test("does not derive status or navigation from renamed summaries and keeps turn ordering non-mutating", () => {
    const item = {
      delegation: {
        id: "dlg_stable",
        parentSessionID: "ses_parent",
        title: "completed",
        status: "running",
        lastActivityAt: 1,
      },
      participants: [{ id: "par_stable", role: "implementer", target: "ses_misleading", childSessionID: "ses_real" }],
      turns: [
        { id: "trn_two", seq: 2, status: "failed" },
        { id: "trn_one", seq: 1, status: "completed" },
      ],
      softExpired: false,
    } satisfies DelegationPanelItem
    const before = delegationPanelModel([item], "ses_parent")
    const after = delegationPanelModel(
      [{ ...item, delegation: { ...item.delegation, title: "ses_fake has failed" } }],
      "ses_parent",
    )

    expect(after).toEqual([{ ...before[0], title: "ses_fake has failed" }])
    expect(after[0]).toMatchObject({ id: "dlg_stable", status: "running" })
    expect(after[0]?.participants[0]).toMatchObject({ id: "par_stable", href: "ses_real" })
    expect(after[0]?.turns.map((turn) => turn.id)).toEqual(["trn_one", "trn_two"])
    expect(item.turns.map((turn) => turn.id)).toEqual(["trn_two", "trn_one"])
  })
})

describe("AI-TDD-S04-R05 missing participant capabilities", () => {
  test("does not invent controls or a child-session route from an external thread or target name", () => {
    const participant = {
      id: "par_external",
      role: "reviewer",
      target: "ses_not_a_child",
      externalThreadID: "ses_external_thread",
    }
    const rows = delegationPanelModel(
      [
        {
          delegation: {
            id: "dlg_external",
            parentSessionID: "ses_parent",
            title: "resume now",
            status: "running",
            lastActivityAt: 1,
          },
          participants: [participant],
          turns: [],
          softExpired: false,
        },
      ],
      "ses_parent",
    )

    expect(rows[0]?.participants).toEqual([{ ...participant, href: undefined }])
    expect(rows[0]?.participants[0]).not.toHaveProperty("capabilities")
    expect(rows[0]?.participants[0]).not.toHaveProperty("canSteer")
    expect(rows[0]?.participants[0]).not.toHaveProperty("canResume")
    expect(rows[0]?.participants[0]).not.toHaveProperty("canInterrupt")
  })
})
