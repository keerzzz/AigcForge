import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Schema } from "effect"
import { AgentV2 } from "@aigcfroge/core/agent"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { Location } from "@aigcfroge/core/location"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { PermissionTable } from "@aigcfroge/core/permission/sql"
import { PermissionSaved } from "@aigcfroge/core/permission/saved"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionStore } from "@aigcfroge/core/session/store"
import { eq } from "drizzle-orm"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const current = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
)
const sessions = SessionV2.layer.pipe(
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(SessionStore.defaultLayer),
  Layer.provide(Project.defaultLayer),
  Layer.provide(SessionExecution.noopLayer),
)
const layer = PermissionV2.locationLayer.pipe(
  Layer.provideMerge(Database.defaultLayer),
  Layer.provideMerge(SessionStore.defaultLayer),
  Layer.provideMerge(EventV2.defaultLayer),
  Layer.provideMerge(current),
  Layer.provideMerge(sessions),
  Layer.provideMerge(SessionExecution.noopLayer),
  Layer.provideMerge(PermissionSaved.defaultLayer),
)
const it = testEffect(layer)

function setup(rules: PermissionV2.Ruleset = []) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: SessionV2.ID.make("ses_test"),
        project_id: Project.ID.global,
        slug: "test",
        directory: "/project",
        title: "test",
        version: "test",
        agent: "test",
        // 根会话默认有人值守（attended NULL），与计划 §3.4 契约一致；
        // 列默认 0 仅为历史迁移兼容。
        attended: null,
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* setRules(rules)
  })
}

function setRules(rules: PermissionV2.Ruleset) {
  return Effect.gen(function* () {
    const agents = yield* AgentV2.Service
    yield* agents.transform((editor) =>
      editor.update(AgentV2.ID.make("test"), (agent) => {
        agent.permissions = [...rules]
      }),
    )
  })
}

function assertion(input: Partial<PermissionV2.AssertInput> = {}) {
  return {
    id: PermissionV2.ID.create("per_test"),
    sessionID: SessionV2.ID.make("ses_test"),
    action: "read",
    resources: ["src/index.ts"],
    ...input,
  } satisfies PermissionV2.AssertInput
}

function waitForRequest() {
  return Effect.gen(function* () {
    const service = yield* PermissionV2.Service
    const events = yield* EventV2.Service
    const asked = yield* Deferred.make<PermissionV2.Request>()
    const unsubscribe = yield* events.listen((event) =>
      event.type === PermissionV2.Event.Asked.type
        ? Deferred.succeed(asked, event.data as PermissionV2.Request).pipe(Effect.asVoid)
        : Effect.void,
    )
    yield* Effect.addFinalizer(() => unsubscribe)
    const fiber = yield* service.assert(assertion()).pipe(Effect.forkScoped)
    const request = yield* Deferred.await(asked)
    return { service, fiber, request }
  })
}

describe("PermissionV2", () => {
  it.effect("returns the evaluated effect and only queues prompts", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "read", resource: "*", effect: "allow" }])
      const service = yield* PermissionV2.Service
      expect(yield* service.ask(assertion())).toEqual({ id: PermissionV2.ID.create("per_test"), effect: "allow" })
      expect(yield* service.list()).toEqual([])
      yield* setRules([{ action: "read", resource: "*", effect: "deny" }])
      expect(yield* service.ask(assertion())).toEqual({ id: PermissionV2.ID.create("per_test"), effect: "deny" })
      expect(yield* service.list()).toEqual([])
      yield* setRules([])
      expect(yield* service.ask(assertion())).toEqual({ id: PermissionV2.ID.create("per_test"), effect: "ask" })
      expect(yield* service.get(PermissionV2.ID.create("per_test"))).toBeDefined()
    }),
  )

  it.effect("evaluates against an explicit provider-turn agent", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "read", resource: "*", effect: "allow" }])
      const agents = yield* AgentV2.Service
      yield* agents.transform((editor) =>
        editor.update(AgentV2.ID.make("reviewer"), (agent) => {
          agent.permissions.push({ action: "read", resource: "*", effect: "deny" })
        }),
      )
      const service = yield* PermissionV2.Service

      expect(yield* service.ask(assertion())).toMatchObject({ effect: "allow" })
      expect(yield* service.ask(assertion({ agent: AgentV2.ID.make("reviewer") }))).toMatchObject({ effect: "deny" })
      yield* agents.transform((editor) =>
        editor.update(AgentV2.ID.make("reviewer"), (agent) => {
          agent.permissions = []
        }),
      )
      expect(yield* service.ask(assertion({ agent: AgentV2.ID.make("reviewer") }))).toMatchObject({ effect: "ask" })
      expect(yield* service.get(PermissionV2.ID.create("per_test"))).not.toHaveProperty("agent")
    }),
  )

  it.effect("allows and denies from explicit rules without asking", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "read", resource: "*", effect: "allow" }])
      const service = yield* PermissionV2.Service
      yield* service.assert(assertion())
      yield* setRules([{ action: "read", resource: "*", effect: "deny" }])
      const denied = yield* service.assert(assertion()).pipe(Effect.flip)
      expect(denied).toBeInstanceOf(PermissionV2.DeniedError)
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("allows managed output reads without granting external directory access", () =>
    Effect.gen(function* () {
      yield* setup([
        { action: "*", resource: "*", effect: "deny" },
        { action: "read", resource: "*", effect: "allow" },
      ])
      const service = yield* PermissionV2.Service

      expect(yield* service.ask(assertion({ resources: ["tool_123"] }))).toMatchObject({ effect: "allow" })
      expect(
        yield* service.ask(assertion({ action: "external_directory", resources: ["/tmp/tool-output/*"] })),
      ).toMatchObject({ effect: "deny" })
    }),
  )

  it.effect("uses build permissions when the Session agent is omitted", () =>
    Effect.gen(function* () {
      yield* setup()
      const { db } = yield* Database.Service
      yield* db
        .update(SessionTable)
        .set({ agent: null })
        .where(eq(SessionTable.id, SessionV2.ID.make("ses_test")))
        .run()
        .pipe(Effect.orDie)
      const agents = yield* AgentV2.Service
      yield* agents.transform((editor) =>
        editor.update(AgentV2.ID.make("build"), (agent) => {
          agent.permissions = [{ action: "todowrite", resource: "*", effect: "allow" }]
        }),
      )

      const service = yield* PermissionV2.Service
      expect(yield* service.ask(assertion({ action: "todowrite", resources: ["*"] }))).toEqual({
        id: PermissionV2.ID.create("per_test"),
        effect: "allow",
      })
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("denies omitted-agent permissions when no primary default agent exists", () =>
    Effect.gen(function* () {
      yield* setup()
      const { db } = yield* Database.Service
      yield* db
        .update(SessionTable)
        .set({ agent: null })
        .where(eq(SessionTable.id, SessionV2.ID.make("ses_test")))
        .run()
        .pipe(Effect.orDie)
      const agents = yield* AgentV2.Service
      yield* agents.transform((editor) => {
        editor.remove(AgentV2.ID.make("test"))
        editor.remove(AgentV2.ID.make("build"))
      })

      const service = yield* PermissionV2.Service
      expect(yield* service.ask(assertion())).toEqual({ id: PermissionV2.ID.create("per_test"), effect: "deny" })
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("evaluates bash with the normal configured-rule semantics", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "*", resource: "*", effect: "allow" }])
      const service = yield* PermissionV2.Service
      const bash = assertion({ action: "bash", resources: ["pwd"] })
      expect(yield* service.ask(bash)).toEqual({ id: PermissionV2.ID.create("per_test"), effect: "allow" })

      yield* setRules([])
      expect(yield* service.ask(bash)).toEqual({ id: PermissionV2.ID.create("per_test"), effect: "ask" })
      expect(yield* service.get(PermissionV2.ID.create("per_test"))).toBeDefined()
    }),
  )

  it.effect("uses saved bash approvals while preserving configured deny precedence", () =>
    Effect.gen(function* () {
      yield* setup()
      const saved = yield* PermissionSaved.Service
      yield* saved.add({ projectID: Project.ID.global, action: "bash", resources: ["pwd"] })

      const service = yield* PermissionV2.Service
      expect(yield* service.ask(assertion({ action: "bash", resources: ["pwd"] }))).toEqual({
        id: PermissionV2.ID.create("per_test"),
        effect: "allow",
      })
      expect(yield* service.list()).toEqual([])

      yield* setRules([{ action: "bash", resource: "*", effect: "deny" }])
      expect(yield* service.ask(assertion({ action: "bash", resources: ["pwd"] }))).toEqual({
        id: PermissionV2.ID.create("per_test"),
        effect: "deny",
      })
    }),
  )

  it.effect("resolves an asked permission once", () =>
    Effect.gen(function* () {
      yield* setup()
      const { service, fiber, request } = yield* waitForRequest()
      expect(yield* service.list()).toEqual([request])
      expect(yield* service.forSession(request.sessionID)).toEqual([request])
      expect(yield* service.forSession(SessionV2.ID.make("ses_other"))).toEqual([])
      expect(yield* service.get(request.id)).toEqual(request)
      yield* service.reply({ requestID: request.id, reply: "once" })
      yield* Fiber.join(fiber)
      expect(yield* service.list()).toEqual([])
      expect(yield* service.get(request.id)).toBeUndefined()
    }),
  )

  it.effect("stores and removes saved resources for a project", () =>
    Effect.gen(function* () {
      yield* setup()
      const service = yield* PermissionV2.Service
      const asked = yield* Deferred.make<PermissionV2.Request>()
      const events = yield* EventV2.Service
      const unsubscribe = yield* events.listen((event) =>
        event.type === PermissionV2.Event.Asked.type
          ? Deferred.succeed(asked, event.data as PermissionV2.Request).pipe(Effect.asVoid)
          : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const fiber = yield* service.assert(assertion({ save: ["src/*"] })).pipe(Effect.forkScoped)
      const request = yield* Deferred.await(asked)
      yield* service.reply({ requestID: request.id, reply: "always" })
      yield* Fiber.join(fiber)

      const { db } = yield* Database.Service
      expect(
        yield* db.select().from(PermissionTable).where(eq(PermissionTable.project_id, Project.ID.global)).all(),
      ).toMatchObject([{ action: "read", resource: "src/*" }])
      const saved = yield* PermissionSaved.Service
      const id = (yield* saved.list())[0].id
      expect(yield* saved.list()).toEqual([{ id, projectID: Project.ID.global, action: "read", resource: "src/*" }])
      yield* service.assert(assertion({ id: PermissionV2.ID.create("per_next"), resources: ["src/next.ts"] }))
      yield* saved.remove(id)
      expect(yield* saved.list()).toEqual([])
    }),
  )

  it.effect("root Session preserves ask rules (user is present)", () =>
    Effect.gen(function* () {
      // ses_test has no parentID → root session. ask rules stay as ask.
      yield* setup([{ action: "read", resource: "*", effect: "ask" }])
      const service = yield* PermissionV2.Service
      expect(yield* service.ask(assertion())).toMatchObject({ effect: "ask" })
    }),
  )

  it.effect("unattended child Session converts ask to deny", () =>
    Effect.gen(function* () {
      // Agent has an explicit ask rule for read.
      yield* setup([{ action: "read", resource: "*", effect: "ask" }])
      // Mark ses_test as a child (parent_id set) with attended=false (default).
      const { db } = yield* Database.Service
      yield* db
        .update(SessionTable)
        .set({ parent_id: SessionV2.ID.make("ses_parent"), attended: 0 })
        .where(eq(SessionTable.id, SessionV2.ID.make("ses_test")))
        .run()
        .pipe(Effect.orDie)

      const service = yield* PermissionV2.Service
      // Unattended child → ask rule converted to deny.
      expect(yield* service.ask(assertion())).toMatchObject({ effect: "deny" })
    }),
  )

  it.effect("attended child Session preserves ask rules", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "read", resource: "*", effect: "ask" }])
      const { db } = yield* Database.Service
      yield* db
        .update(SessionTable)
        .set({ parent_id: SessionV2.ID.make("ses_parent"), attended: 1 })
        .where(eq(SessionTable.id, SessionV2.ID.make("ses_test")))
        .run()
        .pipe(Effect.orDie)

      const service = yield* PermissionV2.Service
      // attended=true → ask preserved (user will respond).
      expect(yield* service.ask(assertion())).toMatchObject({ effect: "ask" })
    }),
  )

  it.effect("unattended child Session with a pre-auth allow ruleset reads without silent denial (M3)", () =>
    Effect.gen(function* () {
      // Scheduled jobs run under an agent whose permissions pre-authorize the
      // tools they need (plan §8 G2). An explicit allow rule is NOT converted
      // to deny, so the unattended job can read files instead of being silently
      // rejected by the ask→deny fallback.
      yield* setup([{ action: "read", resource: "*", effect: "allow" }])
      const { db } = yield* Database.Service
      yield* db
        .update(SessionTable)
        .set({ parent_id: SessionV2.ID.make("ses_parent"), attended: 0 })
        .where(eq(SessionTable.id, SessionV2.ID.make("ses_test")))
        .run()
        .pipe(Effect.orDie)

      const service = yield* PermissionV2.Service
      expect(yield* service.ask(assertion())).toMatchObject({ effect: "allow" })
    }),
  )

  it.effect("unattended child Session denies an unmatched action instead of parking on the ask fallback", () =>
    Effect.gen(function* () {
      // No configured rule matches: previously evaluate's fallback ask parked
      // assert on a Deferred until teardown (a hung unattended task). The
      // catch-all deny makes it fail fast with DeniedError, queueing nothing.
      yield* setup()
      const { db } = yield* Database.Service
      yield* db
        .update(SessionTable)
        .set({ parent_id: SessionV2.ID.make("ses_parent"), attended: 0 })
        .where(eq(SessionTable.id, SessionV2.ID.make("ses_test")))
        .run()
        .pipe(Effect.orDie)

      const service = yield* PermissionV2.Service
      const denied = yield* service.assert(assertion()).pipe(Effect.flip)
      expect(denied).toBeInstanceOf(PermissionV2.DeniedError)
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("unattended child Session asserts cleanly under an explicit allow rule", () =>
    Effect.gen(function* () {
      // Regression guard: the catch-all deny sits at the head of the ruleset,
      // so a configured allow still wins findLast and the assert passes.
      yield* setup([{ action: "read", resource: "*", effect: "allow" }])
      const { db } = yield* Database.Service
      yield* db
        .update(SessionTable)
        .set({ parent_id: SessionV2.ID.make("ses_parent"), attended: 0 })
        .where(eq(SessionTable.id, SessionV2.ID.make("ses_test")))
        .run()
        .pipe(Effect.orDie)

      const service = yield* PermissionV2.Service
      yield* service.assert(assertion())
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("unattended child Session denies saved approvals (plan red-line 5)", () =>
    Effect.gen(function* () {
      // 计划红线 5：unattended 将 ask 转 deny，saved approval 不得重新放开
      // 无人值守调用（2026-08-16 计划反转）。
      yield* setup()
      const { db } = yield* Database.Service
      yield* db
        .update(SessionTable)
        .set({ parent_id: SessionV2.ID.make("ses_parent"), attended: 0 })
        .where(eq(SessionTable.id, SessionV2.ID.make("ses_test")))
        .run()
        .pipe(Effect.orDie)
      const saved = yield* PermissionSaved.Service
      yield* saved.add({ projectID: Project.ID.global, action: "read", resources: ["src/*"] })

      const service = yield* PermissionV2.Service
      const denied = yield* service.assert(assertion()).pipe(Effect.flip)
      expect(denied).toBeInstanceOf(PermissionV2.DeniedError)
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("exposes effective rules through the session-backed owner", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "read", resource: "*", effect: "allow" }])
      const service = yield* PermissionV2.Service

      // coding 模式默认忽略档位：owner 返回 Agent 固有信封。
      const rules = yield* service.effectiveRules(SessionV2.ID.make("ses_test"))
      expect(rules).toEqual([{ action: "read", resource: "*", effect: "allow" }])
    }),
  )

  it.effect("effective rules honor the session tier and drive assert identically", () =>
    Effect.gen(function* () {
      yield* setup()
      yield* (yield* AgentV2.Service).transform((editor) =>
        editor.update(AgentV2.ID.make("meta"), (agent) => {
          agent.permissions = [{ action: "read", resource: "*", effect: "allow" }]
        }),
      )
      const { db } = yield* Database.Service
      yield* db
        .update(SessionTable)
        .set({ mode: "chat", agent: "meta", permission_tier: "full" })
        .where(eq(SessionTable.id, SessionV2.ID.make("ses_test")))
        .run()
        .pipe(Effect.orDie)

      const service = yield* PermissionV2.Service
      const rules = yield* service.effectiveRules(SessionV2.ID.make("ses_test"))
      // full：未知 action 抬到 ask，read allow 保留。
      expect(rules.some((rule) => rule.action === "*" && rule.effect === "ask")).toBe(true)
      expect(PermissionV2.evaluate("some_future_tool", "*", rules).effect).toBe("ask")
      expect(PermissionV2.evaluate("read", "src/index.ts", rules).effect).toBe("allow")

      // 同一 owner 驱动执行授权：edit 为 ask → assert 进入 Permission Dock。
      const fiber = yield* service
        .assert({ ...assertion(), action: "edit", resources: ["foo.ts"] })
        .pipe(Effect.forkScoped)
      const asked = yield* Deferred.make<PermissionV2.Request>()
      const unsubscribe = yield* (yield* EventV2.Service).listen((event) =>
        event.type === PermissionV2.Event.Asked.type
          ? Deferred.succeed(asked, Schema.decodeUnknownSync(PermissionV2.Request)(event.data)).pipe(Effect.asVoid)
          : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const request = yield* Deferred.await(asked)
      expect(request.action).toBe("edit")
      yield* service.reply({ requestID: request.id, reply: "reject" })
    }),
  )
})
