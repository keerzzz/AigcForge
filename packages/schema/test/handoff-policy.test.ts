import { describe, expect, test } from "bun:test"
import { executeHandoff, handoffRequiresApproval, planHandoff } from "../src/handoff"

const denyEdit = [{ permission: "edit", pattern: "*", action: "deny" as const }]
const allowEdit = [{ permission: "edit", pattern: "*", action: "allow" as const }]
const allowBash = [{ permission: "bash", pattern: "*", action: "allow" as const }]
const empty: never[] = []

describe("handoffRequiresApproval (D13 S3 E3/E4)", () => {
  test("plan -> build is escalation (edit deny -> allow)", () => {
    expect(handoffRequiresApproval({ mode: "coding", tier: "full" }, "plan", "build", denyEdit, allowEdit)).toBe(true)
  })

  test("build -> plan is not escalation (target adds no allow)", () => {
    expect(handoffRequiresApproval({ mode: "coding", tier: "full" }, "build", "plan", allowEdit, denyEdit)).toBe(false)
  })

  test("same ruleset, same agent is not escalation", () => {
    expect(handoffRequiresApproval({ mode: "coding", tier: "full" }, "build", "build", allowEdit, allowEdit)).toBe(
      false,
    )
  })

  test("empty target rules never escalate", () => {
    expect(handoffRequiresApproval({ mode: "coding", tier: "full" }, "build", "unknown", allowEdit, empty)).toBe(false)
  })

  test("bash target from a propose session always requires approval", () => {
    expect(handoffRequiresApproval({ mode: "coding", tier: "propose" }, "build", "build", allowEdit, allowBash)).toBe(
      true,
    )
  })
})

describe("planHandoff / executeHandoff ordering (R1)", () => {
  const base = {
    session: { mode: "coding", tier: "full" } as const,
    currentAgent: "plan",
    targetAgent: "build",
    currentRules: denyEdit,
    targetRules: allowEdit,
  }

  const record = async (plan: ReturnType<typeof planHandoff>, approve = false) => {
    const calls: string[] = []
    await executeHandoff(plan, {
      switchAgent: async () => {
        calls.push("switchAgent")
      },
      send: async () => {
        calls.push("send")
      },
      prefill: () => calls.push("prefill"),
      confirm: async () => {
        calls.push("confirm")
        return approve
      },
      reject: (reason) => calls.push(`reject:${reason}`),
    })
    return calls
  }

  test("an escalating handoff asks before it switches, and a refusal switches nothing", async () => {
    const plan = planHandoff({ ...base, send: true })
    expect(plan).toEqual({ action: "confirm", reason: "escalation", then: "switch-and-send" })
    expect(await record(plan)).toEqual(["confirm", "reject:escalation"])
  })

  test("an approved escalating handoff switches after the confirmation, never before", async () => {
    const plan = planHandoff({ ...base, send: true })
    expect(await record(plan, true)).toEqual(["confirm", "switchAgent", "send"])
  })

  test("an approved escalating handoff without send prefills instead of sending", async () => {
    const plan = planHandoff(base)
    expect(plan).toEqual({ action: "confirm", reason: "escalation", then: "switch-and-prefill" })
    expect(await record(plan, true)).toEqual(["confirm", "switchAgent", "prefill"])
  })

  test("a non-escalating handoff with send switches before sending and never asks", async () => {
    const plan = planHandoff({ ...base, currentRules: allowEdit, send: true })
    expect(plan).toEqual({ action: "switch-and-send" })
    expect(await record(plan)).toEqual(["switchAgent", "send"])
  })

  test("send:false switches then prefills, never sends", async () => {
    const plan = planHandoff({ ...base, currentRules: allowEdit })
    expect(plan).toEqual({ action: "switch-and-prefill" })
    expect(await record(plan)).toEqual(["switchAgent", "prefill"])
  })

  test("the decision uses the pre-switch agent: comparing the target to itself hides the escalation", () => {
    // Regression pin for the TOCTOU that made the gate depend on SSE timing.
    expect(planHandoff({ ...base, send: true }).action).toBe("confirm")
    expect(planHandoff({ ...base, currentAgent: "build", currentRules: allowEdit, send: true }).action).toBe(
      "switch-and-send",
    )
  })
})
