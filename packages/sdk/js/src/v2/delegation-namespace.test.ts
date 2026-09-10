import { describe, expect, test } from "bun:test"
import { AigcfrogeClient } from "./gen/sdk.gen.js"

describe("generated delegation SDK namespace", () => {
  test("exposes every canonical and legacy operation", () => {
    const client = new AigcfrogeClient()
    for (const method of [
      "list",
      "create",
      "get",
      "addParticipant",
      "listTurns",
      "appendTurn",
      "retry",
      "reconcile",
      "retractRejection",
      "steer",
      "interrupt",
      "complete",
      "close",
      "archive",
      "unarchive",
      "fork",
      "delete",
    ] as const) {
      expect(typeof client.v2.delegation[method], `v2.delegation.${method}`).toBe("function")
      expect(typeof client.legacy.delegation[method], `legacy.delegation.${method}`).toBe("function")
    }
  })
})
