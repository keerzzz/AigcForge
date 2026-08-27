import { describe, expect, test } from "bun:test"
import { approvalScopeTransport, pendingForLocation } from "./approval-center"

describe("approval center model", () => {
  test("uses the V2 reply endpoint only for reject and once", () => {
    expect(approvalScopeTransport("reject")).toBe("reply")
    expect(approvalScopeTransport("once")).toBe("reply")
  })

  test("uses the scoped grant endpoint for session and location", () => {
    expect(approvalScopeTransport("session")).toBe("grant")
    expect(approvalScopeTransport("location")).toBe("grant")
  })

  test("aggregates and sorts only the supplied current Location permission slice", () => {
    const currentLocation = {
      session_b: [{ id: "request_2", sessionID: "session_b", action: "write", resources: ["b"] }],
      session_a: [{ id: "request_2", sessionID: "session_a", action: "read", resources: ["a"] }],
      other: undefined,
    }

    expect(pendingForLocation(currentLocation).map((request) => `${request.sessionID}:${request.id}`)).toEqual([
      "session_a:request_2",
      "session_b:request_2",
    ])
  })
})

// Route coverage is asserted behaviourally in
// e2e/regression/approval-center.spec.ts ("answers a pending approval from the
// <mode> mode workspace route"), not by grepping this component's source:
// docs/testing.md §10 红线 3 forbids source-string assertions standing in for
// behaviour, and a regex over a JSX mount cannot tell whether the surface
// actually receives pending requests on that route.
