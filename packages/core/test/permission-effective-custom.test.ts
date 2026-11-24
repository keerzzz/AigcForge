import { describe, expect, test } from "bun:test"
import { Permission } from "@omnixa/schema/permission"
import { PermissionEffective } from "../src/permission/effective"

function input(overrides: Partial<PermissionEffective.Input> = {}): PermissionEffective.Input {
  return {
    mode: "custom",
    agent: "meta",
    tier: "propose",
    masterPermissionEnabled: false,
    savedApprovals: [],
    ...overrides,
  }
}

const metaPermissions: Permission.Ruleset = [
  { action: "*", resource: "*", effect: "deny" },
  { action: "read", resource: "*", effect: "allow" },
  { action: "glob", resource: "*", effect: "allow" },
  { action: "grep", resource: "*", effect: "allow" },
  { action: "list_assets", resource: "*", effect: "allow" },
  { action: "task", resource: "*", effect: "allow" },
  { action: "subagent", resource: "*", effect: "allow" },
  { action: "question", resource: "*", effect: "allow" },
]

describe("PermissionEffective Custom rule order", () => {
  test("keeps Coding V2 configuration ordered while retaining the V1 deny and saved envelope", () => {
    const agentRules: Permission.Ruleset = [{ action: "read", resource: "*", effect: "deny" }]
    const sessionRules: Permission.Ruleset = [{ action: "read", resource: "*", effect: "allow" }]
    const coding = input({ mode: "coding", savedApprovals: [{ action: "read", resource: "src/*" }] })
    const current = PermissionEffective.effectiveV2(coding, agentRules, sessionRules)
    const legacy = PermissionEffective.effectiveV1(
      coding,
      [...agentRules, ...sessionRules].map((rule) => ({
        permission: rule.action,
        pattern: rule.resource,
        action: rule.effect,
      })),
    )

    expect(current).toEqual([...agentRules, ...sessionRules])
    expect(PermissionEffective.evaluate(current, "read", "src/index.ts")).toBe("allow")
    expect(PermissionEffective.evaluateV1(legacy, "read", "src/index.ts")).toBe("deny")
    expect(
      PermissionEffective.evaluateV1(
        PermissionEffective.effectiveV1(coding, [{ permission: "read", pattern: "*", action: "ask" }]),
        "read",
        "src/index.ts",
      ),
    ).toBe("allow")
    expect(
      PermissionEffective.evaluate(
        PermissionEffective.effectiveV2(coding, [{ action: "read", resource: "*", effect: "ask" }]),
        "read",
        "src/index.ts",
      ),
    ).toBe("ask")
  })

  test("keeps the fallback deny before execution allows rewritten to asks", () => {
    const rules = PermissionEffective.effectiveV2(input(), metaPermissions)

    expect(rules[0]).toEqual({ action: "*", resource: "*", effect: "deny" })
    for (const action of ["task", "subagent", "question"]) {
      expect(PermissionEffective.evaluate(rules, action, "*")).toBe("ask")
    }
    for (const action of ["read", "glob", "grep", "list_assets"]) {
      expect(PermissionEffective.evaluate(rules, action, "src/index.ts")).toBe("allow")
    }
    expect(PermissionEffective.evaluate(rules, "unknown_tool", "*")).toBe("deny")
  })

  test("keeps an Agent's later wildcard deny after its rewritten execution allows", () => {
    const rules = PermissionEffective.effectiveV2(input(), [
      ...metaPermissions,
      { action: "*", resource: "*", effect: "deny" },
    ])

    expect(PermissionEffective.evaluate(rules, "read", "src/index.ts")).toBe("deny")
    expect(PermissionEffective.evaluate(rules, "task", "coder")).toBe("deny")
  })

  test("keeps Session wildcard denies authoritative for attended and unattended Custom", () => {
    for (const attended of [true, false]) {
      const rules = PermissionEffective.effectiveV2(input({ attended }), metaPermissions, [
        { action: "*", resource: "*", effect: "deny" },
      ])

      expect(PermissionEffective.evaluate(rules, "read", "src/index.ts")).toBe("deny")
      expect(PermissionEffective.evaluate(rules, "task", "coder")).toBe("deny")
      expect(PermissionEffective.evaluate(rules, "unknown_tool", "*")).toBe("deny")
    }
  })

  test("retains the order of Session overrides after the asset ceiling", () => {
    for (const attended of [true, false]) {
      const rules = PermissionEffective.effectiveV2(input({ attended }), metaPermissions, [
        { action: "*", resource: "*", effect: "deny" },
        { action: "read", resource: "src/*", effect: "allow" },
        { action: "task", resource: "coder", effect: "allow" },
      ])

      expect(PermissionEffective.evaluate(rules, "read", "src/index.ts")).toBe("allow")
      expect(PermissionEffective.evaluate(rules, "read", "private/key.txt")).toBe("deny")
      expect(PermissionEffective.evaluate(rules, "task", "coder")).toBe(attended ? "ask" : "deny")
      expect(PermissionEffective.evaluate(rules, "task", "writer")).toBe("deny")
    }
  })

  test("does not move a Session's later wildcard allow ahead of an earlier read allow", () => {
    const rules = PermissionEffective.effectiveV2(input(), metaPermissions, [
      { action: "read", resource: "*", effect: "allow" },
      { action: "*", resource: "*", effect: "allow" },
    ])

    expect(PermissionEffective.evaluate(rules, "read", "src/index.ts")).toBe("ask")
    expect(PermissionEffective.evaluate(rules, "task", "coder")).toBe("ask")
  })

  test("preserves explicit action and resource denies over rewritten allows", () => {
    const rules = PermissionEffective.effectiveV2(input(), [
      { action: "*", resource: "*", effect: "deny" },
      { action: "task", resource: "*", effect: "deny" },
      { action: "task", resource: "*", effect: "allow" },
      { action: "subagent", resource: "*", effect: "allow" },
      { action: "subagent", resource: "restricted-*", effect: "deny" },
      { action: "read", resource: "*.env", effect: "deny" },
      { action: "read", resource: "*", effect: "allow" },
    ])

    expect(PermissionEffective.evaluate(rules, "task", "coder")).toBe("deny")
    expect(PermissionEffective.evaluate(rules, "subagent", "restricted-coder")).toBe("deny")
    expect(PermissionEffective.evaluate(rules, "subagent", "coder")).toBe("ask")
    expect(PermissionEffective.evaluate(rules, "read", ".env")).toBe("deny")
    expect(PermissionEffective.evaluate(rules, "read", "src/index.ts")).toBe("allow")
  })

  test("keeps wildcard asks behind the fallback and before readonly allows", () => {
    const rules = PermissionEffective.effectiveV2(input(), [
      { action: "*", resource: "*", effect: "deny" },
      { action: "read", resource: "*", effect: "allow" },
      { action: "read", resource: "*.env", effect: "deny" },
      { action: "task_*", resource: "project-*", effect: "allow" },
      { action: "*", resource: "*", effect: "allow" },
    ])

    expect(rules[0]).toEqual({ action: "*", resource: "*", effect: "deny" })
    expect(PermissionEffective.evaluate(rules, "task_spawn", "project-one")).toBe("ask")
    expect(PermissionEffective.evaluate(rules, "unknown_tool", "*")).toBe("ask")
    expect(PermissionEffective.evaluate(rules, "read", "src/index.ts")).toBe("allow")
    expect(PermissionEffective.evaluate(rules, "read", ".env")).toBe("deny")
  })

  test("retains a scoped wildcard allow as an ask without widening its resources", () => {
    const rules = PermissionEffective.effectiveV2(input(), [
      { action: "*", resource: "*", effect: "deny" },
      { action: "task_*", resource: "project-*", effect: "allow" },
    ])

    expect(PermissionEffective.evaluate(rules, "task_spawn", "project-one")).toBe("ask")
    expect(PermissionEffective.evaluate(rules, "task_spawn", "outside")).toBe("deny")
    expect(PermissionEffective.evaluate(rules, "unknown_tool", "project-one")).toBe("deny")
  })

  test("uses the same fallback and ask order through the V1 format", () => {
    const rules = PermissionEffective.effectiveV1(
      input(),
      metaPermissions.map((rule) => ({ permission: rule.action, pattern: rule.resource, action: rule.effect })),
    )

    expect(PermissionEffective.evaluateV1(rules, "task", "coder")).toBe("ask")
    expect(PermissionEffective.evaluateV1(rules, "read", "src/index.ts")).toBe("allow")
    expect(PermissionEffective.evaluateV1(rules, "unknown_tool", "*")).toBe("deny")
  })

  test("keeps other product modes and full-tier elevation unchanged", () => {
    for (const mode of ["chat", "work", "assistant"] as const) {
      const propose = PermissionEffective.effectiveV2(input({ mode }), metaPermissions)
      const full = PermissionEffective.effectiveV2(input({ mode, tier: "full" }), metaPermissions)

      expect(PermissionEffective.evaluate(propose, "task", "coder")).toBe("allow")
      expect(PermissionEffective.evaluate(propose, "unknown_tool", "*")).toBe("deny")
      expect(PermissionEffective.evaluate(full, "task", "coder")).toBe("allow")
      expect(PermissionEffective.evaluate(full, "unknown_tool", "*")).toBe("ask")
    }
    const custom = PermissionEffective.effectiveV2(input({ tier: "full" }), metaPermissions)
    expect(PermissionEffective.evaluate(custom, "task", "coder")).toBe("ask")
    expect(PermissionEffective.evaluate(custom, "unknown_tool", "*")).toBe("deny")
  })

  test("preserves master and saved approvals while keeping explicit denies final", () => {
    const base: Permission.Ruleset = [...metaPermissions, { action: "task", resource: "restricted-*", effect: "deny" }]
    const master = PermissionEffective.effectiveV2(input({ masterPermissionEnabled: true }), base)
    const saved = PermissionEffective.effectiveV2(input({ savedApprovals: [{ action: "task", resource: "*" }] }), base)

    expect(PermissionEffective.evaluate(master, "task", "coder")).toBe("allow")
    expect(PermissionEffective.evaluate(master, "unknown_tool", "*")).toBe("allow")
    expect(PermissionEffective.evaluate(master, "task", "restricted-coder")).toBe("deny")
    expect(PermissionEffective.evaluate(saved, "task", "coder")).toBe("allow")
    expect(PermissionEffective.evaluate(saved, "task", "restricted-coder")).toBe("deny")
  })

  test("keeps unattended custom execution denied even with master and saved approvals", () => {
    const rules = PermissionEffective.effectiveV2(
      input({
        attended: false,
        masterPermissionEnabled: true,
        savedApprovals: [{ action: "task", resource: "*" }],
      }),
      metaPermissions,
    )

    expect(PermissionEffective.evaluate(rules, "task", "coder")).toBe("deny")
    expect(PermissionEffective.evaluate(rules, "read", "src/index.ts")).toBe("allow")
    expect(PermissionEffective.evaluate(rules, "unknown_tool", "*")).toBe("deny")
  })
})
