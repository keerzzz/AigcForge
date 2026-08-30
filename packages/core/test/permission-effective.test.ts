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

  test("chat × meta × full + override：危险 action 仍逐次 ask，既有 allow 不被降级", () => {
    const rules = v2(input({ tier: "full", attended: true, masterPermissionEnabled: true }))
    for (const action of ["bash", "edit", "write", "apply_patch"]) {
      expect(PermissionEffective.evaluate(rules, action, "*"), action).toBe("ask")
    }
    expect(PermissionEffective.evaluate(rules, "some_future_tool", "*")).toBe("ask")
    // H2：break-glass 不得把 base 显式 allow（read/question/propose）降为 ask。
    expect(PermissionEffective.evaluate(rules, "read", "src/index.ts")).toBe("allow")
    expect(PermissionEffective.evaluate(rules, "question", "*")).toBe("allow")
    expect(PermissionEffective.evaluate(rules, "propose_prompt_asset", "*")).toBe("allow")
  })

  test("chat × meta × full + override：基线敏感文件 ask 被放开（发现 B，与文案/work 模式一致）", () => {
    const rules = v2(input({ tier: "full", attended: true, masterPermissionEnabled: true }))
    // 确认框文案「允许…读取敏感文件」：override 需盖过基线 {read,*.env,ask}
    expect(PermissionEffective.evaluate(rules, "read", ".env")).toBe("allow")
    expect(PermissionEffective.evaluate(rules, "read", "config.env.production")).toBe("allow")
    // 对照：无 override 的 full 档不放开敏感文件（档位本身不是提权通道）
    const noOverride = v2(input({ tier: "full", attended: true, masterPermissionEnabled: false }))
    expect(PermissionEffective.evaluate(noOverride, "read", ".env")).toBe("ask")
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
      ] as const) {
        expect(PermissionEffective.evaluate(rulesV2, action, resource), JSON.stringify(i)).toBe(
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

describe("PermissionEffective unattended custom deny-first 基线（§4.5-1）", () => {
  // 资产作者可控的 ruleset 形状：尾部通配 allow 是 §4.5-1 的攻击面。
  const assetBase: Permission.Ruleset = [
    { action: "read", resource: "*", effect: "allow" },
    { action: "bash", resource: "*", effect: "ask" },
    { action: "edit", resource: "src/*", effect: "ask" },
    { action: "*", resource: "*", effect: "allow" },
  ]

  test("unattended custom：尾部通配 allow 不越过 clamp，危险动作 deny、读取 allow 存活", () => {
    const rules = v2(input({ mode: "custom", agent: "workflow-worker", attended: false }), assetBase)
    expect(PermissionEffective.evaluate(rules, "bash", "*")).toBe("deny")
    expect(PermissionEffective.evaluate(rules, "edit", "src/index.ts")).toBe("deny")
    expect(PermissionEffective.evaluate(rules, "write", "*")).toBe("deny")
    expect(PermissionEffective.evaluate(rules, "apply_patch", "*")).toBe("deny")
    expect(PermissionEffective.evaluate(rules, "some_future_tool", "*")).toBe("deny")
    expect(PermissionEffective.evaluate(rules, "read", "src/index.ts")).toBe("allow")
  })

  test("unattended custom：显式资源级危险 allow 一并封顶", () => {
    const explicitBase: Permission.Ruleset = [
      { action: "read", resource: "*", effect: "allow" },
      { action: "bash", resource: "/safe/*", effect: "allow" },
    ]
    const rules = v2(input({ mode: "custom", agent: "workflow-worker", attended: false }), explicitBase)
    expect(PermissionEffective.evaluate(rules, "bash", "/safe/cmd.sh")).toBe("deny")
    expect(PermissionEffective.evaluate(rules, "read", "docs/a.md")).toBe("allow")
  })

  test("非 custom unattended 维持既有语义（2026-08-02 scheduled-job 裁决不回退）", () => {
    const rules = v2(input({ mode: "coding", agent: "worker", attended: false }), assetBase)
    expect(PermissionEffective.evaluate(rules, "bash", "*")).toBe("allow")
    expect(PermissionEffective.evaluate(rules, "read", "src/index.ts")).toBe("allow")
  })

  test("attended custom 不在本基线范围（G3-2 grant 模型裁决）", () => {
    const rules = v2(input({ mode: "custom", agent: "workflow-worker", attended: true }), assetBase)
    // 仅锁定读取预授权；尾部通配 allow 在 attended 路径的处置属 G3-2 grant
    // 模型，不在本修复范围内钉契约。
    expect(PermissionEffective.evaluate(rules, "read", "src/index.ts")).toBe("allow")
  })
})

describe("PermissionEffective R6 整改（custom unattended 天花板）", () => {
  // 复审方纯函数探针的实测 base（R6-1/R6-2 的证据输入，勿改形状）。
  const probeBase: Permission.Ruleset = [
    { action: "read", resource: "*", effect: "allow" },
    { action: "read", resource: ".env", effect: "deny" },
    { action: "task_spawn", resource: "*", effect: "allow" },
    { action: "webfetch", resource: "*", effect: "allow" },
    { action: "bash", resource: "*", effect: "allow" },
    { action: "*", resource: "*", effect: "allow" },
  ]
  const unattended = (mode: ProductMode.ID) => input({ mode, agent: "workflow-worker", attended: false })

  test("R6-1 custom unattended 的显式资源级 deny 压过通配 allow，且与 coding 配对防再分叉", () => {
    const customRules = v2(unattended("custom"), probeBase)
    expect(PermissionEffective.evaluate(customRules, "read", ".env")).toBe("deny")
    expect(PermissionEffective.evaluate(customRules, "read", "src/index.ts")).toBe("allow")
    const codingRules = v2(unattended("coding"), probeBase)
    expect(PermissionEffective.evaluate(codingRules, "read", ".env")).toBe("deny")
  })

  test("R6-2 白名单制：扇出与外发通道在 custom unattended 默认 deny", () => {
    const rules = v2(unattended("custom"), probeBase)
    expect(PermissionEffective.evaluate(rules, "task_spawn", "*")).toBe("deny")
    expect(PermissionEffective.evaluate(rules, "webfetch", "*")).toBe("deny")
  })

  test("R6-2 守卫：未列入只读白名单的 action 默认 deny（新工具不自动获得预授权）", () => {
    const rules = v2(unattended("custom"), [{ action: "some_future_tool", resource: "*", effect: "allow" }])
    expect(PermissionEffective.evaluate(rules, "some_future_tool", "*")).toBe("deny")
  })
})

describe("PermissionEffective attended custom 重写为 ask（Phase D §2.6）", () => {
  // 资产作者声明的全量 allow（攻击面输入）。
  const allowAllAsset: Permission.Ruleset = [
    { action: "bash", resource: "*", effect: "allow" },
    { action: "task_spawn", resource: "*", effect: "allow" },
    { action: "webfetch", resource: "*", effect: "allow" },
    { action: "read", resource: "*", effect: "allow" },
    { action: "*", resource: "*", effect: "allow" },
  ]

  test("attended custom：非白名单资产 allow 全部重写为 ask，白名单保持 allow", () => {
    const rules = v2(input({ mode: "custom", agent: "workflow-worker", attended: true }), allowAllAsset)
    expect(PermissionEffective.evaluate(rules, "bash", "*")).toBe("ask")
    expect(PermissionEffective.evaluate(rules, "edit", "src/x.ts")).toBe("ask")
    expect(PermissionEffective.evaluate(rules, "write", "out.txt")).toBe("ask")
    expect(PermissionEffective.evaluate(rules, "apply_patch", "*")).toBe("ask")
    expect(PermissionEffective.evaluate(rules, "task_spawn", "*")).toBe("ask")
    expect(PermissionEffective.evaluate(rules, "webfetch", "https://x")).toBe("ask")
    expect(PermissionEffective.evaluate(rules, "some_future_tool", "*")).toBe("ask")
    expect(PermissionEffective.evaluate(rules, "read", "src/index.ts")).toBe("allow")
  })

  test("attended custom：显式资源级 deny 仍压过通配 allow 与 saved（位序不变）", () => {
    const withDeny: Permission.Ruleset = [...allowAllAsset, { action: "read", resource: ".env", effect: "deny" }]
    const rules = v2(
      input({
        mode: "custom",
        agent: "workflow-worker",
        attended: true,
        savedApprovals: [{ action: "read", resource: ".env" }],
      }),
      withDeny,
    )
    expect(PermissionEffective.evaluate(rules, "read", ".env")).toBe("deny")
  })

  test("attended custom：saved 追加来源不被天花板削掉", () => {
    const rules = v2(
      input({
        mode: "custom",
        agent: "workflow-worker",
        attended: true,
        savedApprovals: [{ action: "grep", resource: "logs/*" }],
      }),
      [{ action: "*", resource: "*", effect: "allow" }],
    )
    expect(PermissionEffective.evaluate(rules, "grep", "logs/a.log")).toBe("allow")
  })

  test("unattended 行为一字不变（R6 块继续作准，此处仅钉 coding 配对）", () => {
    const rules = v2(input({ mode: "coding", agent: "worker", attended: true }), allowAllAsset)
    expect(PermissionEffective.evaluate(rules, "bash", "*")).toBe("allow")
  })
})
