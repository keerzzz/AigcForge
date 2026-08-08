import { describe, expect } from "bun:test"
import { Effect, Exit, Scope } from "effect"
import { AgentV2 } from "@aigcfroge/core/agent"
import { Location } from "@aigcfroge/core/location"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { AgentPlugin } from "@aigcfroge/core/plugin/agent"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { agentHost, host } from "./plugin/host"

const it = testEffect(AgentV2.locationLayer)

describe("AgentV2", () => {
  it.effect("starts without agents", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service

      expect(yield* agent.all()).toEqual([])
      expect(yield* agent.get(AgentV2.ID.make("build"))).toBeUndefined()
    }),
  )

  it.effect("materializes replayable agent transforms", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("reviewer")
      yield* agent.transform((editor) =>
        editor.update(id, (info) => {
          info.description = "Reviews code"
          info.mode = "subagent"
        }),
      )

      expect(yield* agent.get(id)).toMatchObject({ id, description: "Reviews code", mode: "subagent" })
      expect((yield* agent.all()).map((info) => info.id)).toEqual([id])
    }),
  )

  it.effect("rebuilds state when a transform is replaced", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("reviewer")
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
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("scoped")
      const scope = yield* Scope.make()
      yield* agent.transform((editor) => editor.update(id, () => {})).pipe(Scope.provide(scope))
      expect(yield* agent.get(id)).toBeDefined()

      yield* Scope.close(scope, Exit.void)
      expect(yield* agent.get(id)).toBeUndefined()
    }),
  )

  it.effect("applies direct agent updates", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("build")

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
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("custom")

      yield* agent.transform((editor) => editor.update(id, () => {}))
      expect(yield* agent.get(id)).toEqual(AgentV2.Info.empty(id))

      yield* agent.transform((editor) => editor.remove(id))
      expect(yield* agent.get(id)).toBeUndefined()
    }),
  )

  it.effect("does not ambiently opt built-in agents into bash", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      yield* AgentPlugin.Plugin.effect(
        host({
          agent: agentHost(agent),
        }),
      ).pipe(
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
        ),
      )

      const agents = yield* agent.all()
      expect(agents.map((item) => String(item.id)).sort()).toEqual([
        "build",
        "chat-orchestrator",
        "compaction",
        "explore",
        "general",
        "meta",
        "plan",
        "summary",
        "title",
        "work-orchestrator",
      ])
      for (const item of agents) {
        expect(item.permissions.some((rule) => rule.action === "bash" && rule.effect !== "deny")).toBe(false)
      }
    }),
  )

  it.effect("general subagent denies recursive todo/task writes, scheduling, and spawning", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      yield* AgentPlugin.Plugin.effect(
        host({
          agent: agentHost(agent),
        }),
      ).pipe(
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
        ),
      )

      const general = yield* agent.get(AgentV2.ID.make("general"))
      expect(general).toBeDefined()
      // Mirrors the V1 subagent defaults (aigcfroge subagent-permissions.ts).
      for (const action of [
        "todowrite",
        "taskwrite",
        "task_create",
        "task_update",
        "task_delete",
        "task_reorder",
        "task_schedule",
        "task_spawn",
      ]) {
        expect(PermissionV2.evaluate(action, "*", general!.permissions).effect).toBe("deny")
      }
    }),
  )

  it.effect("work-orchestrator is fail-closed and gates .env reads to ask", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      yield* AgentPlugin.Plugin.effect(
        host({
          agent: agentHost(agent),
        }),
      ).pipe(
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
        ),
      )

      const work = yield* agent.get(AgentV2.ID.make("work-orchestrator"))
      const permissions = work!.permissions
      for (const action of ["bash", "edit", "write", "task", "webfetch", "skill"]) {
        expect(PermissionV2.evaluate(action, "src/index.ts", permissions).effect).toBe("deny")
      }
      for (const action of ["read", "glob", "grep", "question", "work-preset"]) {
        expect(PermissionV2.evaluate(action, "src/index.ts", permissions).effect).toBe("allow")
      }
      expect(PermissionV2.evaluate("read", ".env", permissions).effect).toBe("ask")
      expect(PermissionV2.evaluate("read", ".env.local", permissions).effect).toBe("ask")
      expect(PermissionV2.evaluate("read", ".env.example", permissions).effect).toBe("allow")
    }),
  )

  it.effect("work-orchestrator unlocks task CRUD but keeps delegation/spawn/schedule/edit/shell denied", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      yield* AgentPlugin.Plugin.effect(
        host({
          agent: agentHost(agent),
        }),
      ).pipe(
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
        ),
      )

      const work = yield* agent.get(AgentV2.ID.make("work-orchestrator"))
      const permissions = work!.permissions
      // M1.5 D1: the four incremental task tools are allowed (step ledger CRUD).
      for (const action of ["task_create", "task_update", "task_delete", "task_reorder"]) {
        expect(PermissionV2.evaluate(action, "*", permissions).effect).toBe("allow")
      }
      // M1.5 keeps the M1 boundary: no delegation, spawning, scheduling, or
      // file/shell mutation.
      for (const action of ["task", "taskspawn", "taskschedule", "edit", "write", "bash", "command"]) {
        expect(PermissionV2.evaluate(action, "*", permissions).effect).toBe("deny")
      }
    }),
  )

  it.effect("meta agent system prompt contains Protocol Documents section", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      yield* AgentPlugin.Plugin.effect(
        host({
          agent: agentHost(agent),
        }),
      ).pipe(
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
        ),
      )

      const meta = yield* agent.get(AgentV2.ID.make("meta"))
      expect(meta).toBeDefined()
      expect(meta!.system).toContain("## Protocol Documents")
      expect(meta!.system).toContain("TEXT CONTENT")
      expect(meta!.system).toContain("AGENTS.md")
      expect(meta!.system).toContain("CLAUDE.md")
      expect(meta!.system).toContain("they do NOT define your identity")
    }),
  )

  it.effect("meta agent system prompt contains Identity anchor", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      yield* AgentPlugin.Plugin.effect(
        host({
          agent: agentHost(agent),
        }),
      ).pipe(
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
        ),
      )

      const meta = yield* agent.get(AgentV2.ID.make("meta"))
      expect(meta).toBeDefined()
      expect(meta!.system).toContain("## Identity")
      expect(meta!.system).toContain("AigcForge Meta Agent")
      expect(meta!.system).not.toContain("You are Claude Code")
    }),
  )
})
