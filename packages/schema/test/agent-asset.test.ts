import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { AgentAsset } from "../src/agent-asset"

describe("AgentAsset.Warning", () => {
  test("decodes stable import warning codes", () => {
    expect(
      Schema.decodeUnknownSync(AgentAsset.Warning)({ code: "wildcard_allow", action: "*", resource: "*" }),
    ).toMatchObject({ code: "wildcard_allow" })
    expect(() =>
      Schema.decodeUnknownSync(AgentAsset.Warning)({ code: "unknown", action: "*", resource: "*" }),
    ).toThrow()
  })
})
