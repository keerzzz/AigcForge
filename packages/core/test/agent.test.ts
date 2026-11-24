import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Exit, Fiber, Layer, Schema, Scope, Stream } from "effect"
import { Agent } from "@omnixa/core/agent"
import { Bus } from "@omnixa/core/bus"
import { AppNodeBuilder } from "@omnixa/core/effect/app-node-builder"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { Location } from "@omnixa/core/location"
import { Permission } from "@omnixa/core/permission"
import { PermissionEffective } from "@omnixa/core/permission/effective"
import { ProductMode } from "@omnixa/schema/product-mode"
import { AgentPlugin } from "@omnixa/core/plugin/agent"
import { PlanPlugin } from "@omnixa/core/plugin/plan"
import { AbsolutePath } from "@omnixa/core/schema"
import { Global } from "@omnixa/util/global"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { agentHost, host } from "./plugin/host"

const testLocation = location({ directory: AbsolutePath.make("/project") })
const locationLayer = Layer.succeed(Location.Service, Location.Service.of(testLocation))
const global = Global.make({ data: "/data", config: "/config", tmp: "/tmp/omnixa" })
const globalLayer = Layer.succeed(Global.Service, Global.Service.of(global))

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Agent.node, Bus.node, Location.node]), [
    Global.node.replace(globalLayer),
    Location.node.replace(locationLayer),
  ]) as unknown as Layer.Layer<unknown, never>,
)

describe("Agent", () => {
  it.effect("asks for project memory deletion while preserving query and Meta permission rules", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      yield* AgentPlugin.Plugin.effect(host({ agent: agentHost(agents) }))
      const build = yield* agents.get(Agent.ID.make("build"))
      const meta = yield* agents.get(Agent.ID.make("meta"))
      if (!build || !meta) throw new Error("Expected builtin Build and Meta agents")
      expect(Permission.evaluate("memory_delete", "project", build.permissions).effect).toBe("ask")
      for (const action of ["memory_query", "memory_record", "memory_search"]) {
        expect(Permission.evaluate(action, "project", build.permissions).effect).toBe("allow")
      }
      const context: PermissionEffective.Input = {
        mode: "work",
        agent: "meta",
        tier: "propose",
        masterPermissionEnabled: false,
        savedApprovals: [],
      }
      const proposed = PermissionEffective.effectiveV2(context, meta.permissions)
      const full = PermissionEffective.effectiveV2({ ...context, tier: "full" }, meta.permissions)
      expect(PermissionEffective.evaluate(proposed, "memory_delete", "project")).toBe("deny")
      expect(PermissionEffective.evaluate(proposed, "memory_query", "project")).toBe("deny")
      expect(PermissionEffective.evaluate(full, "memory_delete", "project")).toBe("ask")
      expect(PermissionEffective.evaluate(full, "memory_query", "project")).toBe("ask")
      const overridden = PermissionEffective.effectiveV2({ ...context, agent: "build" }, build.permissions, [
        { action: "memory_delete", resource: "project", effect: "allow" },
      ])
      expect(PermissionEffective.evaluate(overridden, "memory_delete", "project")).toBe("allow")
      expect(PermissionEffective.evaluate(overridden, "memory_delete", "other")).toBe("ask")
    }),
  )
  it.effect("registers builtin protocol cards on the canonical Agents", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const context = host({
        agent: agentHost(agents),
        tool: { ...host().tool, hook: () => Effect.succeed({ dispose: Effect.void }) },
        session: { hook: () => Effect.succeed({ dispose: Effect.void }) },
      })
      yield* AgentPlugin.Plugin.effect(context)
      yield* PlanPlugin.Plugin.effect(context).pipe(Effect.provide(globalLayer))
      const encoded = Schema.encodeSync(Schema.Array(Agent.Info))(yield* agents.list())
      for (const id of ["build", "general", "explore", "plan"]) {
        expect(encoded.find((info) => info.id === id)?.originKind).toBe("builtin")
        expect(encoded.find((info) => info.id === id)?.card).toMatchObject({
          capabilities: expect.any(Array),
          constraints: expect.any(Array),
          protocol: expect.any(String),
        })
      }
      expect((yield* agents.get(Agent.ID.make("build")))?.mode).toBe("all")
      expect((yield* agents.get(Agent.ID.make("plan")))?.mode).toBe("primary")
      const meta = yield* agents.get(Agent.ID.make("meta"))
      expect(meta?.permissions).toContainEqual({
        action: "generate_delegation_protocol",
        resource: "*",
        effect: "allow",
      })
      expect(meta?.permissions[0]).toEqual({ action: "*", resource: "*", effect: "deny" })
      if (!meta) throw new Error("Expected builtin Meta")
      for (const mode of ProductMode.ID.literals) {
        for (const tier of ["propose", "full"] as const) {
          const input: PermissionEffective.Input = {
            mode,
            tier,
            agent: "meta",
            masterPermissionEnabled: false,
            savedApprovals: [],
          }
          const rules = PermissionEffective.effectiveV2(input, meta.permissions)
          for (const action of ["task_create", "task_update", "task_delete", "task_reorder", "taskwrite"]) {
            expect(PermissionEffective.evaluate(rules, action, "*")).toBe(mode === "custom" ? "ask" : "allow")
            const denied = PermissionEffective.effectiveV2(input, meta.permissions, [
              { action, resource: "*", effect: "deny" },
            ])
            expect(PermissionEffective.evaluate(denied, action, "*")).toBe("deny")
          }
        }
      }
      expect(encoded.filter((info) => info.card !== undefined).map((info) => info.id)).toEqual([
        "build",
        "general",
        "explore",
        "plan",
      ])
    }),
  )
  it.effect("keeps user roots and executors in Custom without replacing the full Location catalogue", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      yield* AgentPlugin.Plugin.effect(host({ agent: agentHost(agents) }))
      const rootID = Agent.ID.make("user-root")
      const workerID = Agent.ID.make("user-worker")
      yield* agents.transform((editor) => {
        editor.update(rootID, (agent) => {
          agent.mode = "primary"
        })
        editor.update(workerID, (agent) => {
          agent.mode = "subagent"
        })
        editor.default(rootID)
      })
      const root = yield* agents.get(rootID)
      const worker = yield* agents.get(workerID)
      if (!root || !worker) throw new Error("Expected user registrations")
      expect(root.originKind).toBe("user")
      expect(worker.originKind).toBe("user")
      expect(Agent.ordinaryModes(root)).toEqual(["custom"])
      expect((yield* agents.select(undefined, "custom")).id).toBe(rootID)
      const pool = yield* agents.list()
      expect(pool.map((agent) => agent.id)).toContain(rootID)
      expect(pool.map((agent) => agent.id)).toContain(workerID)
      for (const mode of ProductMode.ID.literals.filter((mode) => mode !== "custom")) {
        expect((yield* agents.select(undefined, mode)).id).toBe(Agent.defaultID)
        expect(
          Agent.availableForDelegation(pool, [], ["task", "subagent"], mode).some((agent) => agent.id === workerID),
        ).toBe(false)
        const error = yield* Agent.assertOrdinaryMode(root, mode).pipe(Effect.flip)
        expect(error).toBeInstanceOf(Agent.AgentNotAllowedError)
        expect(error).toMatchObject({ mode, agent: rootID })
      }
      expect(
        Agent.availableForDelegation(pool, [], ["task", "subagent"], "custom").some((agent) => agent.id === workerID),
      ).toBe(true)
      yield* Agent.assertOrdinaryMode(root, "custom")
    }),
  )
  it.effect("publishes an updated event after agent changes", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.Service
      const bus = yield* Bus.Service
      const updated = yield* bus
        .subscribe(Agent.Event.Updated)
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      yield* agent.transform((editor) => editor.update(Agent.ID.make("reviewer"), () => {}))

      expect(yield* Fiber.join(updated)).toMatchObject([{ location: { directory: testLocation.directory } }])
    }),
  )

  it.effect("preserves canonical card diagnostics and explicit clearing across rebuilds", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const id = Agent.ID.make("reviewer")
      yield* agents.transform((editor) =>
        editor.update(id, (info) => {
          info.card = { _tag: "InvalidCard", reason: "empty_protocol" }
        }),
      )
      expect(Schema.encodeUnknownSync(Agent.Info)(yield* agents.get(id)).card).toEqual({
        _tag: "InvalidCard",
        reason: "empty_protocol",
      })
      yield* agents.reload()
      expect(Schema.encodeUnknownSync(Agent.Info)(yield* agents.get(id)).card).toEqual({
        _tag: "InvalidCard",
        reason: "empty_protocol",
      })
      yield* agents.transform((editor) =>
        editor.update(id, (info) => {
          info.card = undefined
        }),
      )
      expect(Schema.encodeUnknownSync(Agent.Info)(yield* agents.get(id)).card).toBeUndefined()
    }),
  )

  it.effect("starts without agents", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.Service

      expect(yield* agent.list()).toEqual([])
      expect(yield* agent.get(Agent.ID.make("build"))).toBeUndefined()
    }),
  )

  it.effect("materializes replayable agent transforms", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.Service
      const id = Agent.ID.make("reviewer")
      yield* agent.transform((editor) =>
        editor.update(id, (info) => {
          info.description = "Reviews code"
          info.mode = "subagent"
        }),
      )

      expect(yield* agent.get(id)).toMatchObject({ id, description: "Reviews code", mode: "subagent" })
      expect((yield* agent.list()).map((info) => info.id)).toEqual([id])
    }),
  )

  it.effect("lists the selected default agent first", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.Service
      yield* agent.transform((editor) => {
        editor.update(Agent.ID.make("build"), (info) => {
          info.mode = "primary"
        })
        editor.update(Agent.ID.make("reviewer"), (info) => {
          info.mode = "primary"
        })
        editor.update(Agent.ID.make("explore"), (info) => {
          info.mode = "subagent"
        })
        editor.default(Agent.ID.make("reviewer"))
      })

      expect((yield* agent.list()).map((info) => String(info.id))).toEqual(["reviewer", "build", "explore"])
    }),
  )

  it.effect("rebuilds state when a transform is replaced", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.Service
      const id = Agent.ID.make("reviewer")
      let description = "Old description"
      let hidden = true
      yield* agent.transform((editor) =>
        editor.update(id, (info) => {
          info.description = description
          info.hidden = hidden
        }),
      )
      description = "New description"
      hidden = false
      yield* agent.reload()

      expect(yield* agent.get(id)).toMatchObject({ description: "New description", hidden: false })
    }),
  )

  it.effect("removes a transform when its scope closes", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.Service
      const id = Agent.ID.make("scoped")
      const scope = yield* Scope.make()
      yield* agent.transform((editor) => editor.update(id, () => {})).pipe(Scope.provide(scope))
      expect(yield* agent.get(id)).toBeDefined()

      yield* Scope.close(scope, Exit.void)
      expect(yield* agent.get(id)).toBeUndefined()
    }),
  )

  it.effect("applies direct agent updates", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.Service
      const id = Agent.ID.make("build")

      yield* agent.transform((editor) =>
        editor.update(id, (info) => {
          info.mode = "primary"
          info.hidden = true
        }),
      )

      expect(yield* agent.get(id)).toMatchObject({ id, mode: "primary", hidden: true })
    }),
  )

  it.effect("creates agents with runtime defaults and supports direct removal", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.Service
      const id = Agent.ID.make("custom")

      yield* agent.transform((editor) => editor.update(id, () => {}))
      const info = yield* agent.get(id)
      expect(info?.mode).toBe("primary")
      expect(info?.permissions.slice(0, Agent.Info.default(id).permissions.length)).toEqual(
        Agent.Info.default(id).permissions,
      )
      expect(
        Permission.evaluate("external_directory", path.join(global.data, "shell", "*", "*"), info?.permissions ?? [])
          .effect,
      ).toBe("allow")
      expect(
        Permission.evaluate("external_directory", path.join(global.data, "tool-output", "*"), info?.permissions ?? [])
          .effect,
      ).toBe("allow")
      expect(
        Permission.evaluate("external_directory", path.join(global.config, "*"), info?.permissions ?? []).effect,
      ).toBe("allow")
      expect(
        Permission.evaluate("external_directory", path.join(global.tmp, "*"), info?.permissions ?? []).effect,
      ).toBe("allow")

      yield* agent.transform((editor) => editor.remove(id))
      expect(yield* agent.get(id)).toBeUndefined()
    }),
  )

  it.effect("allows external directories without opting built-in agents into bash", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.Service
      yield* AgentPlugin.Plugin.effect(
        host({
          agent: agentHost(agent),
        }),
      )

      const agents = yield* agent.list()
      expect(agents.map((item) => String(item.id)).sort()).toEqual([
        "build",
        "compaction",
        "explore",
        "general",
        "meta",
        "summary",
        "title",
      ])
      expect((yield* agent.get(Agent.defaultID))?.system).toBeUndefined()
      const permissions = (yield* agent.get(Agent.defaultID))?.permissions ?? []
      const compaction = yield* agent.get(Agent.ID.make("compaction"))
      expect(compaction?.mode).toBe("primary")
      expect(compaction?.hidden).toBe(true)
      expect(compaction?.system).toBeUndefined()
      expect(compaction?.model).toBeUndefined()
      expect(compaction?.request).toEqual(Agent.Info.default(Agent.ID.make("compaction")).request)
      expect(compaction?.permissions).toEqual(permissions.filter((rule) => rule.action !== "question"))
      expect(
        Permission.evaluate("external_directory", path.join(global.data, "shell", "*", "*"), permissions).effect,
      ).toBe("allow")
      expect(
        Permission.evaluate("external_directory", path.join(global.data, "tool-output", "*"), permissions).effect,
      ).toBe("allow")
      expect(Permission.evaluate("external_directory", path.join(global.config, "*"), permissions).effect).toBe("allow")
      expect(Permission.evaluate("external_directory", path.join(global.tmp, "*"), permissions).effect).toBe("allow")
      expect(Permission.evaluate("external_directory", "/outside/*", permissions).effect).toBe("allow")
      const explore = yield* agent.get(Agent.ID.make("explore"))
      expect(Permission.evaluate("shell", "git log -5", explore?.permissions ?? []).effect).toBe("allow")
      expect(Permission.evaluate("edit", "src/index.ts", explore?.permissions ?? []).effect).toBe("deny")
      expect(Permission.evaluate("read", ".env", explore?.permissions ?? []).effect).toBe("ask")
      expect(Permission.evaluate("read", ".env.local", explore?.permissions ?? []).effect).toBe("ask")
      expect(Permission.evaluate("read", ".env.example", explore?.permissions ?? []).effect).toBe("allow")
      expect(Permission.evaluate("read", "src/index.ts", explore?.permissions ?? []).effect).toBe("allow")
      expect(Permission.evaluate("external_directory", "/outside/*", explore?.permissions ?? []).effect).toBe("allow")
      for (const item of agents) {
        expect(item.permissions.some((rule) => rule.action === "bash" && rule.effect !== "deny")).toBe(false)
      }
    }),
  )

  it.effect("registers a visible meta root with a deny-first baseline and explicit delegation actions", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      yield* AgentPlugin.Plugin.effect(host({ agent: agentHost(agents) }))
      const meta = yield* agents.get(Agent.ID.make("meta"))
      if (!meta) throw new Error("Expected the platform meta agent")
      expect(meta.mode).toBe("primary")
      expect(meta.hidden).toBe(false)
      expect(meta.system).toBe(AgentPlugin.metaSystem)
      expect(meta.originRelativePath).toBeUndefined()
      expect(meta.originRevision).toBeUndefined()
      expect(Permission.evaluate("unknown_action", "*", meta.permissions).effect).toBe("deny")
      expect(meta.permissions.some((rule) => rule.action === "*" && rule.effect === "allow")).toBe(false)
      expect(Permission.evaluate("read", "src/index.ts", meta.permissions).effect).toBe("allow")
      expect(Permission.evaluate("read", ".env", meta.permissions).effect).toBe("ask")
      expect(Permission.evaluate("read", ".env.local", meta.permissions).effect).toBe("ask")
      expect(Permission.evaluate("read", ".env.example", meta.permissions).effect).toBe("allow")
      expect(Permission.evaluate("propose_agent_asset", "*", meta.permissions).effect).toBe("allow")
      expect(Permission.evaluate("external_directory", "/outside", meta.permissions).effect).toBe("ask")
      expect(Permission.evaluate("shell", "git status", meta.permissions).effect).toBe("ask")
      expect(Permission.evaluate("edit", "src/index.ts", meta.permissions).effect).toBe("ask")
      expect(Permission.evaluate("write", "src/index.ts", meta.permissions).effect).toBe("ask")
      expect(Permission.evaluate("task", "general", meta.permissions).effect).toBe("allow")
      expect(Permission.evaluate("subagent", "general", meta.permissions).effect).toBe("allow")
      expect(Permission.evaluate("bash", "*", meta.permissions).effect).toBe("deny")

      const rendered = AgentPlugin.renderMetaSystem(meta.system ?? "", yield* agents.list())
      expect(rendered.match(/\*\*(?:Analyze|Classify|Route|Synthesize|Execute|Summarize)\*\*/g)).toEqual([
        "**Analyze**",
        "**Classify**",
        "**Route**",
        "**Synthesize**",
        "**Execute**",
        "**Summarize**",
      ])
      ;["Known Knowns:", "Known Unknowns:", "Unknown Knowns:", "Unknown Unknowns:"].forEach((category) =>
        expect(rendered).toContain(category),
      )
      ;["code_modification", "code_understanding", "content_creation", "configuration", "@mention", "workflow"].forEach(
        (intent) => expect(rendered).toContain(intent),
      )
      ;[
        "Agent Loop",
        "Intent → Engine Mapping",
        "Delegate or Do It Yourself",
        "Delegation Protocol",
        "Error Handling",
        "Output Rules",
        "Protocol Documents",
        "Identity",
        "Notes",
      ].forEach((section) => expect(rendered).toContain(`## ${section}`))
      ;["Project", "Context", "Task", "Engine", "Constraints", "Unknowns", "Verify"].forEach((field) =>
        expect(rendered).toMatch(new RegExp(`^${field}: .+$`, "m")),
      )
      expect(rendered).toContain("**general**")
      expect(rendered).toContain("**explore**")
      expect(rendered).toContain("**build**")
      expect((yield* agents.get(Agent.ID.make("build")))?.mode).toBe("all")
      expect(rendered).not.toContain("**meta**")
      expect(rendered).not.toContain("**title**")
      expect(rendered).not.toContain("{{")
      expect(meta.system).toBe(AgentPlugin.metaSystem)
      expect(
        AgentPlugin.renderMetaSystem("Custom instructions", yield* agents.list(), [{ kind: "skill", name: "git" }]),
      ).toBe("Custom instructions")
    }),
  )

  it.effect("denies the subagent tool for built-in subagents", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.Service
      yield* AgentPlugin.Plugin.effect(
        host({
          agent: agentHost(agent),
        }),
      )

      yield* Effect.forEach(["general", "explore"], (id) =>
        Effect.gen(function* () {
          const info = yield* agent.get(Agent.ID.make(id))
          if (!info) throw new Error(`expected built-in agent: ${id}`)
          expect(info.mode).toBe("subagent")
          expect(info.permissions).toContainEqual({ action: "subagent", resource: "*", effect: "deny" })
          expect(Permission.evaluate("subagent", "*", info.permissions).effect).toBe("deny")
        }),
      )
    }),
  )
})
