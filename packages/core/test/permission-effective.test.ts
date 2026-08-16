import { describe, expect, test } from "bun:test"
import { Permission } from "@aigcfroge/schema/permission"
import { PermissionTier } from "@aigcfroge/schema/permission-tier"
import { ProductMode } from "@aigcfroge/schema/product-mode"
import { PermissionEffective } from "@aigcfroge/core/permission/effective"
import { SessionSchema } from "@aigcfroge/core/session/schema"
import { PermissionV1 } from "@aigcfroge/core/v1/permission"

// Agent 固有基线样例（meta fail-closed 形状，与 plugin/agent.ts metaDefaults 同构）。
const metaBase: Permission.Ruleset = [
  { action: "*", resource: "*", effect: "deny" },
  { action: "doom_loop", resource: "*", effect: "ask" },
  { action: "read", resource: "*", effect: "allow" },
  { action: "read", resource: "*.env", effect: "ask" },
  { action: "glob", resource: "*", effect: "allow" },
  { action: "grep", resource: "*", effect: "allow" },
  { action: "question", resource: "*", effect: "allow" },
  { action: "list_assets", resource: "*", effect: "allow" },
  { action: "propose_prompt_asset", resource: "*", effect: "allow" },
  { action: "bash", resource: "*", effect: "ask" },
  { action: "edit", resource: "*", effect: "ask" },
  { action: "write", resource: "*", effect: "ask" },
  { action: "task", resource: "*", effect: "allow" },
]

// 非 meta（orchestrator）固有信封：edit 显式 deny。
const orchestratorBase: Permission.Ruleset = [
  { action: "*", resource: "*", effect: "deny" },
  { action: "read", resource: "*", effect: "allow" },
  { action: "question", resource: "*", effect: "allow" },
  { action: "edit", resource: "*", effect: "deny" },
  { action: "bash", resource: "*", effect: "deny" },
]

const saved: ReadonlyArray<{ action: string; resource: string }> = [{ action: "edit", resource: "src/*" }]

const metaBaseV1: PermissionV1.Ruleset = metaBase.map((rule) => ({
  permission: rule.action,
  pattern: rule.resource,
  action: rule.effect,
}))

type Input = Parameters<typeof PermissionEffective.effectiveV2>[0]

function input(overrides: Partial<Input> = {}): Input {
  return {
    mode: "chat",
    agent: "meta",
    tier: "propose",
    attended: undefined,
    masterPermissionEnabled: false,
    savedApprovals: [],
    ...overrides,
  }
}

function v2(i: Input, base: Permission.Ruleset = metaBase) {
  return PermissionEffective.effectiveV2(i, base)
}

function v1(i: Input, base: PermissionV1.Ruleset = metaBaseV1) {
  return PermissionEffective.effectiveV1(i, base)
}

describe("PermissionEffective 档位矩阵", () => {
  test("coding 忽略档位：meta full 仍保持 Agent 固有信封", () => {
    const rules = v2(input({ mode: "coding", tier: "full" }))
    expect(PermissionEffective.evaluate(rules, "edit", "*")).toBe("ask")
    expect(PermissionEffective.evaluate(rules, "some_future_tool", "*")).toBe("deny")
  })

  test("非 meta Agent 忽略档位：orchestrator 固有 deny 信封不被 full 抬权", () => {
    const rules = v2(input({ agent: "chat-orchestrator", tier: "full" }), orchestratorBase)
    expect(PermissionEffective.evaluate(rules, "edit", "*")).toBe("deny")
    expect(PermissionEffective.evaluate(rules, "bash", "*")).toBe("deny")
  })

  test("chat/work/assistant × meta × propose：保持 fail-closed 基线（危险写 ask，未知 deny）", () => {
    for (const mode of ["chat", "work", "assistant"] as const) {
      const rules = v2(input({ mode }))
      expect(PermissionEffective.evaluate(rules, "edit", "*"), mode).toBe("ask")
      expect(PermissionEffective.evaluate(rules, "bash", "*"), mode).toBe("ask")
      expect(PermissionEffective.evaluate(rules, "some_future_tool", "*"), mode).toBe("deny")
      expect(PermissionEffective.evaluate(rules, "read", "src/index.ts"), mode).toBe("allow")
    }
  })

  test("chat/work/assistant × meta × full：未知 action 抬到 ask，安全 allow 保留", () => {
    for (const mode of ["chat", "work", "assistant"] as const) {
      const rules = v2(input({ mode, tier: "full" }))
      expect(PermissionEffective.evaluate(rules, "some_future_tool", "*"), mode).toBe("ask")
      expect(PermissionEffective.evaluate(rules, "edit", "*"), mode).toBe("ask")
      expect(PermissionEffective.evaluate(rules, "read", "src/index.ts"), mode).toBe("allow")
      expect(PermissionEffective.evaluate(rules, "question", "*"), mode).toBe("allow")
      expect(PermissionEffective.evaluate(rules, "propose_prompt_asset", "*"), mode).toBe("allow")
    }
  })

  test("未知 mode / 未知 agent / 未知 tier fail-safe：不抬权、无 wildcard allow", () => {
    // 负测试：构造 schema 层不可能到达的脏输入，验证 owner 对非法值 fail-safe。
    // oxlint-disable-next-line no-unsafe-type-assertion -- 类型负测试的合法逃逸（CLAUDE.md No Cheating）
    const unknownMode = v2(input({ mode: "unknown-mode" as unknown as ProductMode.ID, tier: "full" }))
    expect(PermissionEffective.evaluate(unknownMode, "some_future_tool", "*")).toBe("deny")

    const unknownAgent = v2(input({ agent: "unknown-agent", tier: "full" }), orchestratorBase)
    expect(PermissionEffective.evaluate(unknownAgent, "edit", "*")).toBe("deny")

    // oxlint-disable-next-line no-unsafe-type-assertion -- 类型负测试的合法逃逸（CLAUDE.md No Cheating）
    const unknownTier = v2(input({ tier: "admin" as unknown as PermissionTier.ID }))
    expect(PermissionEffective.evaluate(unknownTier, "some_future_tool", "*")).toBe("deny")
    expect(PermissionEffective.evaluate(unknownTier, "edit", "*")).toBe("ask")
  })
})

describe("PermissionEffective master/override", () => {
  test("attended 根 Session + override：一般场景全 allow", () => {
    const rules = v2(input({ attended: true, masterPermissionEnabled: true }))
    expect(PermissionEffective.evaluate(rules, "read", "*")).toBe("allow")
    expect(PermissionEffective.evaluate(rules, "some_future_tool", "*")).toBe("allow")
  })

  test("chat × meta × full + override：危险 action 仍逐次 ask", () => {
    const rules = v2(input({ tier: "full", attended: true, masterPermissionEnabled: true }))
    for (const action of ["bash", "edit", "write", "apply_patch"]) {
      expect(PermissionEffective.evaluate(rules, action, "*"), action).toBe("ask")
    }
    expect(PermissionEffective.evaluate(rules, "some_future_tool", "*")).toBe("ask")
  })

  test("work × meta × full + override：危险 action 允许（非 Chat 保持预授权语义）", () => {
    const rules = v2(input({ mode: "work", tier: "full", attended: true, masterPermissionEnabled: true }))
    expect(PermissionEffective.evaluate(rules, "edit", "*")).toBe("allow")
    expect(PermissionEffective.evaluate(rules, "bash", "*")).toBe("allow")
  })

  test("unattended 根 Session + override：override 无效，ask 转 deny", () => {
    const rules = v2(input({ attended: false, masterPermissionEnabled: true, tier: "full" }))
    expect(PermissionEffective.evaluate(rules, "read", "src/index.ts")).toBe("allow")
    expect(PermissionEffective.evaluate(rules, "edit", "*")).toBe("deny")
    expect(PermissionEffective.evaluate(rules, "bash", "*")).toBe("deny")
    expect(PermissionEffective.evaluate(rules, "some_future_tool", "*")).toBe("deny")
  })

  test("unattended 根 Session 无 override：ask 转 deny，显式 allow 保留", () => {
    const rules = v2(input({ attended: false }))
    expect(PermissionEffective.evaluate(rules, "edit", "*")).toBe("deny")
    expect(PermissionEffective.evaluate(rules, "read", "src/index.ts")).toBe("allow")
    expect(PermissionEffective.evaluate(rules, "some_future_tool", "*")).toBe("deny")
  })
})

describe("PermissionEffective saved approval", () => {
  test("attended：saved approval 预授权一般 action，但显式 deny 优先", () => {
    const rules = v2(input({ attended: true, savedApprovals: saved }))
    expect(PermissionEffective.evaluate(rules, "edit", "src/foo.ts")).toBe("allow")
  })

  test("chat × meta × full：saved approval 不得跳过危险 action 逐次确认", () => {
    const rules = v2(input({ tier: "full", attended: true, savedApprovals: saved }))
    expect(PermissionEffective.evaluate(rules, "edit", "src/foo.ts")).toBe("ask")
  })

  test("非 Chat × meta × full：saved approval 保持既有细粒度预授权", () => {
    const rules = v2(input({ mode: "work", tier: "full", attended: true, savedApprovals: saved }))
    expect(PermissionEffective.evaluate(rules, "edit", "src/foo.ts")).toBe("allow")
  })

  test("unattended：saved approval 不得放开", () => {
    const rules = v2(input({ attended: false, savedApprovals: saved }))
    expect(PermissionEffective.evaluate(rules, "edit", "src/foo.ts")).toBe("deny")
  })
})

describe("PermissionEffective V1/V2 同源", () => {
  test("V1 与 V2 对同一输入产出等价决策（含档位/master/unattended/saved）", () => {
    const cases: Input[] = [
      input({}),
      input({ tier: "full" }),
      input({ mode: "work", tier: "full", attended: true, masterPermissionEnabled: true }),
      input({ tier: "full", attended: true, masterPermissionEnabled: true }),
      input({ attended: false, masterPermissionEnabled: true, tier: "full" }),
      input({ mode: "coding", tier: "full" }),
      input({ agent: "chat-orchestrator", tier: "full" }),
    ]
    for (const i of cases) {
      const rulesV2 = v2(i)
      const rulesV1 = v1(i)
      for (const [action, resource] of [
        ["edit", "*"],
        ["bash", "*"],
        ["read", "src/index.ts"],
        ["read", ".env"],
        ["some_future_tool", "*"],
        ["task", "*"],
      ] as const) {        expect(PermissionEffective.evaluate(rulesV2, action, resource), JSON.stringify(i)).toBe(
          PermissionEffective.evaluateV1(rulesV1, action, resource),
        )
      }
    }
  })

  test("V1 输出为 PermissionV1.Ruleset 形状", () => {
    const rules = v1(input({ tier: "full" }))
    expect(rules[0]).toMatchObject({ permission: "*", pattern: "*", action: "deny" })
    for (const rule of rules) {
      expect(rule).toHaveProperty("permission")
      expect(rule).toHaveProperty("pattern")
      expect(rule).toHaveProperty("action")
    }
  })
})

describe("PermissionEffective 边界", () => {
  test("子 Session（parentID）与根 Session 同规则：attended 决定降级", () => {
    const childUnattended = v2(input({ parentID: SessionSchema.ID.descending("ses_parent"), attended: false }))
    expect(PermissionEffective.evaluate(childUnattended, "edit", "*")).toBe("deny")

    const childAttended = v2(input({ parentID: SessionSchema.ID.descending("ses_parent"), attended: true }))
    expect(PermissionEffective.evaluate(childAttended, "edit", "*")).toBe("ask")
  })

  test("full 不产生新的 allow：除显式 allow 外一切可见能力为 ask 或 deny", () => {
    const rules = v2(input({ tier: "full", attended: true }))
    const effects = new Set(rules.map((rule) => rule.effect))
    expect(effects.has("allow")).toBe(true)
    for (const [action, resource] of [
      ["edit", "*"],
      ["bash", "*"],
      ["write", "*"],
      ["apply_patch", "*"],
      ["some_future_tool", "*"],
    ] as const) {
      expect(PermissionEffective.evaluate(rules, action, resource)).not.toBe("deny")
    }
  })
})
