import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { Database } from "@aigcfroge/core/database/database"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Bus } from "@aigcfroge/core/bus"
import { Location } from "@aigcfroge/core/location"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Session } from "@aigcfroge/core/session"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { SessionPermissionOverride } from "@aigcfroge/core/permission/session-override"
import { Agent } from "@aigcfroge/core/agent"
import { Permission } from "@aigcfroge/core/permission"
import { PermissionSaved } from "@aigcfroge/core/permission/saved"
import { ApprovalPresence } from "@aigcfroge/core/permission/approval-presence"
import { PluginHooks } from "@aigcfroge/core/plugin/hooks"
import { eq } from "drizzle-orm"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

// The override lease is an in-memory break-glass flag over the session store:
// 60s lease, root+attended sessions only, cleared on layer restart. Sessions
// are seeded as rows (v2's Session.create has no attended/mode inputs yet) —
// the override contract under test is the store-backed guard, not creation.

const current = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionStore.node,
      SessionPermissionOverride.node,
      Agent.node,
      Permission.node,
      PermissionSaved.node,
      ApprovalPresence.node,
      PluginHooks.node,
    ]),
    [Location.node.replace(current)],
  ),
)

let counter = 0
const createSession = (input: { attended?: 0 | 1 | null; parentID?: Session.ID } = {}) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    counter += 1
    const id = Session.ID.make(`ses_override_${counter}`)
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id,
        project_id: Project.ID.global,
        slug: id,
        directory: "/project",
        title: id,
        version: "test",
        agent: "test",
        // 根会话默认有人值守（attended NULL，计划 §3.4）。
        attended: input.parentID ? 0 : (input.attended ?? null),
        parent_id: input.parentID,
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    return id
  })

describe("SessionPermissionOverride", () => {
  it.effect("uses the captured Agent for both rules and the Chat full envelope after selection changes", () =>
    Effect.gen(function* () {
      const sessionID = yield* createSession()
      const db = (yield* Database.Service).db
      const agents = yield* Agent.Service
      yield* agents.transform((editor) => {
        editor.update(Agent.ID.make("build"), (agent) => {
          agent.permissions = [{ action: "bash", resource: "*", effect: "allow" }]
        })
        editor.update(Agent.ID.make("meta"), (agent) => {
          agent.permissions = [{ action: "bash", resource: "*", effect: "allow" }]
        })
      })
      yield* db
        .update(SessionTable)
        .set({ mode: "chat", permission_tier: "full", agent: "meta" })
        .where(eq(SessionTable.id, sessionID))
      const permission = yield* Permission.Service
      expect(
        yield* permission.ask({ sessionID, agent: Agent.ID.make("build"), action: "bash", resources: ["pwd"] }),
      ).toMatchObject({ effect: "allow" })
      expect(yield* permission.list()).toEqual([])
      yield* db.update(SessionTable).set({ agent: "build" }).where(eq(SessionTable.id, sessionID))
      expect(
        yield* permission.ask({ sessionID, agent: Agent.ID.make("meta"), action: "bash", resources: ["pwd"] }),
      ).toMatchObject({ effect: "ask" })
      expect(yield* permission.list()).toHaveLength(1)
      expect(yield* permission.ask({ sessionID, action: "bash", resources: ["pwd"] })).toMatchObject({
        effect: "allow",
      })
    }),
  )
  it.effect("is disabled before activation and clears after the lease expires", () =>
    Effect.gen(function* () {
      const service = yield* SessionPermissionOverride.Service
      const sessionID = yield* createSession()

      expect(yield* service.get(sessionID)).toBe(false)

      yield* service.enable(sessionID)
      expect(yield* service.get(sessionID)).toBe(true)

      yield* service.renew(sessionID)
      expect(yield* service.get(sessionID)).toBe(true)

      yield* TestClock.adjust("61 seconds")
      expect(yield* service.get(sessionID)).toBe(false)
    }),
  )

  it.effect("disable turns the override off immediately", () =>
    Effect.gen(function* () {
      const service = yield* SessionPermissionOverride.Service
      const sessionID = yield* createSession()
      yield* service.enable(sessionID)
      yield* service.disable(sessionID)
      expect(yield* service.get(sessionID)).toBe(false)
    }),
  )

  it.effect("rejects child sessions", () =>
    Effect.gen(function* () {
      const service = yield* SessionPermissionOverride.Service
      const parent = yield* createSession()
      const child = yield* createSession({ parentID: parent })

      const exit = yield* service.enable(child).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        expect(error).toBeInstanceOf(SessionPermissionOverride.UnavailableError)
        if (error instanceof SessionPermissionOverride.UnavailableError) expect(error.reason).toBe("child-session")
      }
      expect(yield* service.get(child)).toBe(false)
    }),
  )

  it.effect("rejects unattended root sessions", () =>
    Effect.gen(function* () {
      const service = yield* SessionPermissionOverride.Service
      const sessionID = yield* createSession({ attended: 0 })

      const exit = yield* service.enable(sessionID).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        expect(error).toBeInstanceOf(SessionPermissionOverride.UnavailableError)
        if (error instanceof SessionPermissionOverride.UnavailableError) expect(error.reason).toBe("unattended")
      }
      expect(yield* service.get(sessionID)).toBe(false)
    }),
  )

  it.effect("clears all overrides", () =>
    Effect.gen(function* () {
      const service = yield* SessionPermissionOverride.Service
      const first = yield* createSession()
      const second = yield* createSession()
      yield* service.enable(first)
      yield* service.enable(second)
      yield* service.clear()
      expect(yield* service.get(first)).toBe(false)
      expect(yield* service.get(second)).toBe(false)
    }),
  )

  it.effect("clears state when the layer scope closes (service restart)", () =>
    Effect.gen(function* () {
      const service = yield* SessionPermissionOverride.Service
      const sessionID = yield* createSession()
      yield* service.enable(sessionID)
      expect(yield* service.get(sessionID)).toBe(true)

      // 嵌套 fresh layer = 服务重启：新实例的 Map 为空。
      yield* Effect.gen(function* () {
        const fresh = yield* SessionPermissionOverride.Service
        expect(yield* fresh.get(sessionID)).toBe(false)
      }).pipe(Effect.provide(Layer.fresh(SessionPermissionOverride.layer)))
    }),
  )

  it.effect("rejects activation for a missing session", () =>
    Effect.gen(function* () {
      const service = yield* SessionPermissionOverride.Service
      const error = yield* service.enable(Session.ID.make("ses_missing_override")).pipe(Effect.flip)
      expect(error._tag).toBe("Session.NotFoundError")
    }),
  )
})
