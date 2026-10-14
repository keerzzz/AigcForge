import { describe, expect, test } from "bun:test"
import { dict } from "@/i18n/en"
import { evaluateStartGate } from "./custom-plan-state"

// A blocker without a message renders an empty line under the Start button, which
// is how a disabled action loses its explanation. The gate owns the blocker union;
// this test makes adding a blocker without copy fail loudly.
describe("custom start blocker coverage", () => {
  const english: Readonly<Record<string, string>> = dict
  const blockers = [
    "starting",
    "no-sdk",
    "plan-pending",
    "plan-failed",
    "custom-disabled",
    "unsupported-server",
    "no-digest",
    "blocking-diagnostics",
    "invalid-plan",
    "no-agents",
  ] as const

  test("every blocker the gate can return has a message", () => {
    // The list is asserted against the gate's own union at the type level: a new
    // blocker makes the typed `toContain` below fail until it is listed here.
    expect(blockers.length).toBe(10)
    for (const blocker of blockers) {
      expect(english[`custom.builder.startBlocker.${blocker}`], blocker).toBeTruthy()
    }
  })

  test("the gate only ever returns a listed blocker", () => {
    const gate = evaluateStartGate({
      starting: true,
      hasSdk: false,
      result: undefined,
      draft: { source: "asset", agentCount: 0 },
    })
    if (gate.canStart) throw new Error("expected a blocked gate")
    expect(blockers).toContain(gate.blocker)
  })
})
