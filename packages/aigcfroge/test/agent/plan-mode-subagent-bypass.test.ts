import { PermissionV1 } from "@aigcfroge/core/v1/permission"
import { expect } from "bun:test"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { deriveSubagentSessionPermission } from "../../src/agent/subagent-permissions"
import { Permission } from "../../src/permission"
import { testEffect } from "../lib/effect"

const it = testEffect(Agent.defaultLayer)

function testAgent(input: {
  name: string
  mode: Agent.Info["mode"]
  permission: Parameters<typeof Permission.fromConfig>[0]
}) {
  return {
    name: input.name,
    mode: input.mode,
    permission: Permission.fromConfig(input.permission),
    options: {},
  } satisfies Agent.Info
}

// `deriveSubagentSessionPermission` is imported from production. The test
// exercises the actual helper that task.ts uses to build the subagent's
// session permission, so any regression in that helper trips this test.

it.instance("subagent permissions take precedence over parent agent restrictions", () =>
  Effect.gen(function* () {
    const planAgent = yield* Agent.use.get("plan")
    const generalAgent = yield* Agent.use.get("general")

    expect(planAgent).toBeDefined()
    expect(generalAgent).toBeDefined()
    // Sanity: the plan agent itself blocks edit. (Note: `write` and
    // `apply_patch` route through the `edit` permission at the runtime
    // tool layer — see Permission.disabled / EDIT_TOOLS.)
    expect(Permission.evaluate("edit", "/some/file.ts", planAgent.permission).action).toBe("deny")

    const parentSessionPermission: PermissionV1.Ruleset = []

    const subagentSessionPermission = deriveSubagentSessionPermission({
      parentSessionPermission,
      subagent: generalAgent,
    })

    // Mirror the runtime evaluation in session/prompt.ts (~line 410, 639):
    //   ruleset: Permission.merge(agent.permission, session.permission ?? [])
    const effective = Permission.merge(generalAgent.permission, subagentSessionPermission)

    expect(Permission.evaluate("edit", "/some/file.ts", effective).action).not.toBe("deny")
    expect(Permission.disabled(["edit", "write", "apply_patch"], effective)).toEqual(new Set())
  }),
)

it.instance("subagent's own read-only restriction remains effective", () =>
  Effect.gen(function* () {
    const explore = yield* Agent.use.get("explore")
    expect(explore).toBeDefined()

    const parentSessionPermission: PermissionV1.Ruleset = []
    const subagentSessionPermission = deriveSubagentSessionPermission({
      parentSessionPermission,
      subagent: explore,
    })
    const effective = Permission.merge(explore.permission, subagentSessionPermission)

    expect(Permission.evaluate("edit", "/x.ts", effective).action).toBe("deny")
  }),
)

it.instance("general and explore children do not inherit parent task or todo permissions", () =>
  Effect.gen(function* () {
    const general = yield* Agent.use.get("general")
    const explore = yield* Agent.use.get("explore")
    expect(general).toBeDefined()
    expect(explore).toBeDefined()

    const effectiveGeneral = Permission.merge(
      general.permission,
      deriveSubagentSessionPermission({
        parentSessionPermission: [],
        subagent: general,
      }),
    )
    const effectiveExplore = Permission.merge(
      explore.permission,
      deriveSubagentSessionPermission({
        parentSessionPermission: [],
        subagent: explore,
      }),
    )

    expect(Permission.evaluate("task", "general", effectiveGeneral).action).toBe("deny")
    expect(Permission.evaluate("todowrite", "*", effectiveGeneral).action).toBe("deny")
    expect(Permission.evaluate("task_create", "*", effectiveGeneral).action).toBe("deny")
    expect(Permission.evaluate("task_update", "*", effectiveGeneral).action).toBe("deny")
    expect(Permission.evaluate("task_delete", "*", effectiveGeneral).action).toBe("deny")
    expect(Permission.evaluate("task_reorder", "*", effectiveGeneral).action).toBe("deny")
    expect(Permission.evaluate("task_schedule", "*", effectiveGeneral).action).toBe("deny")
    expect(Permission.evaluate("task_spawn", "*", effectiveGeneral).action).toBe("deny")
    expect(Permission.evaluate("task", "general", effectiveExplore).action).toBe("deny")
    expect(Permission.evaluate("todowrite", "*", effectiveExplore).action).toBe("deny")
    expect(Permission.evaluate("task_create", "*", effectiveExplore).action).toBe("deny")
    expect(Permission.evaluate("task_update", "*", effectiveExplore).action).toBe("deny")
    expect(Permission.evaluate("task_delete", "*", effectiveExplore).action).toBe("deny")
    expect(Permission.evaluate("task_reorder", "*", effectiveExplore).action).toBe("deny")
    expect(Permission.evaluate("task_schedule", "*", effectiveExplore).action).toBe("deny")
    expect(Permission.evaluate("task_spawn", "*", effectiveExplore).action).toBe("deny")
  }),
)

it.instance(
  "custom subagent can explicitly enable edits denied to its parent agent",
  () =>
    Effect.gen(function* () {
      const planAgent = yield* Agent.use.get("plan")
      const my = yield* Agent.use.get("my_subagent")
      expect(planAgent).toBeDefined()
      expect(my).toBeDefined()

      const parentSessionPermission: PermissionV1.Ruleset = []
      const subagentSessionPermission = deriveSubagentSessionPermission({
        parentSessionPermission,
        subagent: my,
      })
      const effective = Permission.merge(my.permission, subagentSessionPermission)

      expect(Permission.evaluate("edit", "/some/file.ts", planAgent.permission).action).toBe("deny")
      expect(Permission.evaluate("edit", "/some/file.ts", effective).action).toBe("allow")
      expect(Permission.disabled(["edit", "write", "apply_patch"], effective)).toEqual(new Set())
    }),
  {
    config: {
      agent: {
        my_subagent: {
          description: "A user-defined subagent",
          mode: "subagent",
          permission: {
            edit: "allow",
          },
        },
      },
    },
  },
)

it.effect("subagent self permissions are preserved", () =>
  Effect.sync(() => {
    const executor = testAgent({
      name: "executor",
      mode: "subagent",
      permission: {
        "*": "deny",
        read: "allow",
        bash: "allow",
        task: {
          "*": "deny",
          worker: "allow",
        },
        edit: "allow",
      },
    })

    const effective = Permission.merge(
      executor.permission,
      deriveSubagentSessionPermission({
        parentSessionPermission: [],
        subagent: executor,
      }),
    )

    expect(Permission.evaluate("read", "README.md", effective).action).toBe("allow")
    expect(Permission.evaluate("bash", "git status", effective).action).toBe("allow")
    expect(Permission.evaluate("task", "worker", effective).action).toBe("allow")
    expect(Permission.evaluate("task", "other", effective).action).toBe("deny")
    expect(Permission.disabled(["edit", "write", "apply_patch"], effective)).toEqual(new Set())
  }),
)

it.effect("subagent inherits parent session deny rules as hard runtime ceilings", () =>
  Effect.sync(() => {
    const executor = testAgent({
      name: "executor",
      mode: "subagent",
      permission: {
        bash: "allow",
      },
    })
    const effective = Permission.merge(
      executor.permission,
      deriveSubagentSessionPermission({
        parentSessionPermission: Permission.fromConfig({ bash: "deny" }),
        subagent: executor,
      }),
    )

    expect(Permission.evaluate("bash", "git status", effective).action).toBe("deny")
  }),
)

it.effect("task_* incremental tools default deny for subagents; explicit grant opts in", () =>
  Effect.sync(() => {
    // 2026-08-06 裁决: 子代理默认不得写任务列表 (task_create/update/delete/reorder),
    // 与 taskwrite 同级; 自定义 agent 显式授权即可 opt-in P2-b 进度上报.
    const executor = testAgent({
      name: "executor",
      mode: "subagent",
      permission: {},
    })
    const effective = Permission.merge(
      executor.permission,
      deriveSubagentSessionPermission({
        parentSessionPermission: [],
        subagent: executor,
      }),
    )
    for (const action of ["task_create", "task_update", "task_delete", "task_reorder"]) {
      expect(Permission.evaluate(action, "*", effective).action).toBe("deny")
    }

    const optedIn = testAgent({
      name: "opted-in",
      mode: "subagent",
      permission: {
        task_create: "allow",
        task_update: "allow",
      },
    })
    const effectiveOptedIn = Permission.merge(
      optedIn.permission,
      deriveSubagentSessionPermission({
        parentSessionPermission: [],
        subagent: optedIn,
      }),
    )
    expect(Permission.evaluate("task_create", "*", effectiveOptedIn).action).toBe("allow")
    expect(Permission.evaluate("task_update", "*", effectiveOptedIn).action).toBe("allow")
    expect(Permission.evaluate("task_delete", "*", effectiveOptedIn).action).toBe("deny")
    expect(Permission.evaluate("task_reorder", "*", effectiveOptedIn).action).toBe("deny")
  }),
)
