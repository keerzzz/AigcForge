import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Schema } from "effect"
import { Agent } from "@aigcfroge/core/agent"
import { Database } from "@aigcfroge/core/database/database"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Bus } from "@aigcfroge/core/bus"
import { Location } from "@aigcfroge/core/location"
import { Permission } from "@aigcfroge/core/permission"
import { PermissionTable } from "@aigcfroge/core/permission/sql"
import { PermissionSaved } from "@aigcfroge/core/permission/saved"
import { ApprovalPresence } from "@aigcfroge/core/permission/approval-presence"
import { SessionPermissionOverride } from "@aigcfroge/core/permission/session-override"
import { PluginHooks } from "@aigcfroge/core/plugin/hooks"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Session } from "@aigcfroge/core/session"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { SessionStore } from "@aigcfroge/core/session/store"
import { eq } from "drizzle-orm"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const attachResponder = () =>
  Effect.gen(function* () {
    const presence = yield* ApprovalPresence.Service
    yield* presence.bindResponder({ custom: true })
  })

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
      PermissionSaved.node,
      Agent.node,
      ApprovalPresence.node,
      SessionPermissionOverride.node,
      PluginHooks.node,
      Permission.node,
    ]),
    [Location.node.replace(current)],
  ),
)

function setup(rules: Permission.Ruleset = [], sessionRules: Permission.Ruleset = []) {
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
        id: Session.ID.make("ses_test"),
        project_id: Project.ID.global,
        slug: "test",
        directory: "/project",
        title: "test",
        version: "test",
        mode: "coding",
        agent: "test",
        permission: sessionRules,
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

function setRules(rules: Permission.Ruleset) {
  return Effect.gen(function* () {
    const agents = yield* Agent.Service
    yield* agents.transform((editor) =>
      editor.update(Agent.ID.make("test"), (agent) => {
        agent.permissions = [...rules]
      }),
    )
  })
}

function assertion(input: Partial<Permission.AssertInput> = {}) {
  return {
    id: Permission.ID.create("per_test"),
    sessionID: Session.ID.make("ses_test"),
    action: "read",
    resources: ["src/index.ts"],
    ...input,
  } satisfies Permission.AssertInput
}

function waitForRequest() {
  return Effect.gen(function* () {
    const service = yield* Permission.Service
    const bus = yield* Bus.Service
    const asked = yield* Deferred.make<Permission.Request>()
    const unsubscribe = yield* bus.listen((event) =>
      event.type === Permission.Event.Asked.type
        ? Deferred.succeed(asked, event.data as Permission.Request).pipe(Effect.asVoid)
        : Effect.void,
    )
    yield* Effect.addFinalizer(() => unsubscribe)
    const fiber = yield* service.assert(assertion()).pipe(Effect.forkScoped)
    const request = yield* Deferred.await(asked)
    return { service, fiber, request }
  })
}

describe("Permission", () => {
  it.effect("returns the evaluated effect and only queues prompts", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "read", resource: "*", effect: "allow" }])
      const service = yield* Permission.Service
      expect(yield* service.ask(assertion())).toEqual({ id: Permission.ID.create("per_test"), effect: "allow" })
      expect(yield* service.list()).toEqual([])
      yield* setRules([{ action: "read", resource: "*", effect: "deny" }])
      expect(yield* service.ask(assertion())).toEqual({ id: Permission.ID.create("per_test"), effect: "deny" })
      expect(yield* service.list()).toEqual([])
      yield* setRules([])
      expect(yield* service.ask(assertion())).toEqual({ id: Permission.ID.create("per_test"), effect: "ask" })
      expect(yield* service.get(Permission.ID.create("per_test"))).toBeDefined()
    }),
  )

  it.effect("evaluates against an explicit provider-turn agent", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "read", resource: "*", effect: "allow" }])
      const agents = yield* Agent.Service
      yield* agents.transform((editor) =>
        editor.update(Agent.ID.make("reviewer"), (agent) => {
          agent.permissions.push({ action: "read", resource: "*", effect: "deny" })
        }),
      )
      const service = yield* Permission.Service

      expect(yield* service.ask(assertion())).toMatchObject({ effect: "allow" })
      expect(yield* service.ask(assertion({ agent: Agent.ID.make("reviewer") }))).toMatchObject({ effect: "deny" })
      yield* agents.transform((editor) =>
        editor.update(Agent.ID.make("reviewer"), (agent) => {
          agent.permissions = []
        }),
      )
      expect(yield* service.ask(assertion({ agent: Agent.ID.make("reviewer") }))).toMatchObject({ effect: "ask" })
      expect(yield* service.get(Permission.ID.create("per_test"))).not.toHaveProperty("agent")
    }),
  )

  it.effect("allows and denies from explicit rules without asking", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "read", resource: "*", effect: "allow" }])
      const service = yield* Permission.Service
      yield* service.assert(assertion())
      yield* setRules([{ action: "read", resource: "*", effect: "deny" }])
      const denied = yield* service.assert(assertion()).pipe(Effect.flip)
      expect(denied).toBeInstanceOf(Permission.BlockedError)
      expect(yield* service.list()).toEqual([])
    }),
  )
  ;[false, true].forEach((hasSaved) => {
    it.effect(`Coding Session allow overrides Agent deny ${hasSaved ? "with" : "without"} saved approvals`, () =>
      Effect.gen(function* () {
        yield* attachResponder()
        yield* setup(
          [{ action: "read", resource: "*", effect: "deny" }],
          [{ action: "read", resource: "*", effect: "allow" }],
        )
        const saved = yield* PermissionSaved.Service
        if (hasSaved) yield* saved.add({ projectID: Project.ID.global, action: "read", resources: ["src/*"] })
        expect(yield* saved.list()).toHaveLength(hasSaved ? 1 : 0)
        const override = yield* SessionPermissionOverride.Service
        expect(yield* override.get(Session.ID.make("ses_test"))).toBe(false)
        const hooks = yield* PluginHooks.Service
        const effects: string[] = []
        yield* hooks.register("permission", "evaluate", (event) =>
          Effect.sync(() => {
            effects.push(event.effect)
          }),
        )

        const service = yield* Permission.Service
        const rules = yield* service.effectiveRules(Session.ID.make("ses_test"))
        expect(Permission.evaluate("read", "src/index.ts", rules).effect).toBe("allow")
        expect(yield* service.ask(assertion())).toMatchObject({ effect: "allow" })
        yield* service.assert(assertion())
        expect(effects).toEqual(["allow", "allow"])
        expect(yield* service.list()).toEqual([])
      }),
    )
  })

  it.effect("Coding master keeps explicit denies and disabling it restores Session overrides", () =>
    Effect.gen(function* () {
      yield* setup(
        [{ action: "read", resource: "*", effect: "deny" }],
        [{ action: "read", resource: "*", effect: "allow" }],
      )
      const service = yield* Permission.Service
      const override = yield* SessionPermissionOverride.Service
      const sessionID = Session.ID.make("ses_test")
      const unknown = assertion({ action: "some_future_tool" })
      expect(yield* override.get(sessionID)).toBe(false)
      const configured = yield* service.effectiveRules(sessionID)
      expect(Permission.evaluate("read", "src/index.ts", configured).effect).toBe("allow")
      expect(Permission.evaluate(unknown.action, "src/index.ts", configured).effect).toBe("ask")
      yield* service.assert(assertion())

      yield* override.enable(sessionID)
      expect(yield* override.get(sessionID)).toBe(true)
      const master = yield* service.effectiveRules(sessionID)
      expect(Permission.evaluate("read", "src/index.ts", master).effect).toBe("deny")
      expect(Permission.evaluate(unknown.action, "src/index.ts", master).effect).toBe("allow")
      expect(yield* service.ask(assertion())).toMatchObject({ effect: "deny" })
      const denied = yield* service.assert(assertion()).pipe(Effect.flip)
      expect(denied).toBeInstanceOf(Permission.BlockedError)
      expect(yield* service.ask(unknown)).toMatchObject({ effect: "allow" })
      yield* service.assert(unknown)
      expect(yield* service.list()).toEqual([])

      yield* override.disable(sessionID)
      expect(yield* override.get(sessionID)).toBe(false)
      const restored = yield* service.effectiveRules(sessionID)
      expect(Permission.evaluate("read", "src/index.ts", restored).effect).toBe("allow")
      expect(Permission.evaluate(unknown.action, "src/index.ts", restored).effect).toBe("ask")
      expect(yield* service.ask(assertion())).toMatchObject({ effect: "allow" })
      yield* service.assert(assertion())
      expect(yield* service.list()).toEqual([])
    }),
  )
  ;[
    { name: "one resource", resources: ["secrets/token.txt"] },
    { name: "a denied resource last", resources: ["src/index.ts", "secrets/token.txt"] },
    { name: "a denied resource first", resources: ["secrets/token.txt", "src/index.ts"] },
  ].forEach((input) => {
    it.effect(`keeps final Session deny ahead of saved approvals and hooks for ${input.name}`, () =>
      Effect.gen(function* () {
        yield* setup(
          [{ action: "read", resource: "*", effect: "allow" }],
          [{ action: "read", resource: "secrets/*", effect: "deny" }],
        )
        const saved = yield* PermissionSaved.Service
        yield* saved.add({ projectID: Project.ID.global, action: "read", resources: ["*"] })
        const hooks = yield* PluginHooks.Service
        const effects: string[] = []
        yield* hooks.register("permission", "evaluate", (event) =>
          Effect.sync(() => {
            effects.push(event.effect)
            event.effect = "allow"
          }),
        )

        const service = yield* Permission.Service
        const rules = yield* service.effectiveRules(Session.ID.make("ses_test"))
        expect(Permission.evaluate("read", "src/index.ts", rules).effect).toBe("allow")
        expect(Permission.evaluate("read", "secrets/token.txt", rules).effect).toBe("deny")
        expect(yield* service.ask(assertion({ resources: input.resources }))).toMatchObject({ effect: "deny" })
        const denied = yield* service.assert(assertion({ resources: input.resources })).pipe(Effect.flip)
        expect(denied).toBeInstanceOf(Permission.BlockedError)
        expect(denied).toMatchObject({ permission: "read", resources: input.resources })
        expect(effects).toEqual([])
        expect(yield* service.list()).toEqual([])
      }),
    )
  })

  it.effect("lets permission hooks allow an ask and require approval after a saved allow", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "read", resource: "*", effect: "ask" }])
      const hooks = yield* PluginHooks.Service
      const effects: string[] = []
      const allow = yield* hooks.register("permission", "evaluate", (event) =>
        Effect.sync(() => {
          effects.push(event.effect)
          event.effect = "allow"
        }),
      )
      const service = yield* Permission.Service
      expect(yield* service.ask(assertion())).toMatchObject({ effect: "allow" })
      yield* service.assert(assertion())
      expect(yield* service.list()).toEqual([])
      yield* allow.dispose

      const saved = yield* PermissionSaved.Service
      yield* saved.add({ projectID: Project.ID.global, action: "read", resources: ["src/*"] })
      const rules = yield* service.effectiveRules(Session.ID.make("ses_test"))
      expect(Permission.evaluate("read", "src/index.ts", rules).effect).toBe("ask")
      yield* hooks.register("permission", "evaluate", (event) =>
        Effect.sync(() => {
          effects.push(event.effect)
          event.effect = "ask"
          event.message = "Plugin requires approval"
        }),
      )
      const asked = yield* service.ask(assertion())
      expect(asked.effect).toBe("ask")
      expect(yield* service.get(asked.id)).toMatchObject({ message: "Plugin requires approval" })
      yield* service.reply({ requestID: asked.id, reply: "once" })

      yield* attachResponder()
      const pending = yield* waitForRequest()
      expect(pending.request).toMatchObject({ action: "read", message: "Plugin requires approval" })
      yield* service.reply({ requestID: pending.request.id, reply: "once" })
      yield* Fiber.join(pending.fiber)
      expect(effects).toEqual(["ask", "ask", "allow", "allow"])
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("allows managed output reads without granting external directory access", () =>
    Effect.gen(function* () {
      yield* setup([
        { action: "*", resource: "*", effect: "deny" },
        { action: "read", resource: "*", effect: "allow" },
      ])
      const service = yield* Permission.Service

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
        .where(eq(SessionTable.id, Session.ID.make("ses_test")))
        .run()
        .pipe(Effect.orDie)
      const agents = yield* Agent.Service
      yield* agents.transform((editor) =>
        editor.update(Agent.ID.make("build"), (agent) => {
          agent.permissions = [{ action: "todowrite", resource: "*", effect: "allow" }]
        }),
      )

      const service = yield* Permission.Service
      expect(yield* service.ask(assertion({ action: "todowrite", resources: ["*"] }))).toEqual({
        id: Permission.ID.create("per_test"),
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
        .where(eq(SessionTable.id, Session.ID.make("ses_test")))
        .run()
        .pipe(Effect.orDie)
      const agents = yield* Agent.Service
      yield* agents.transform((editor) => {
        editor.remove(Agent.ID.make("test"))
        editor.remove(Agent.ID.make("build"))
      })

      const service = yield* Permission.Service
      expect(yield* service.ask(assertion())).toEqual({ id: Permission.ID.create("per_test"), effect: "deny" })
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("evaluates bash with the normal configured-rule semantics", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "*", resource: "*", effect: "allow" }])
      const service = yield* Permission.Service
      const bash = assertion({ action: "bash", resources: ["pwd"] })
      expect(yield* service.ask(bash)).toEqual({ id: Permission.ID.create("per_test"), effect: "allow" })

      yield* setRules([])
      expect(yield* service.ask(bash)).toEqual({ id: Permission.ID.create("per_test"), effect: "ask" })
      expect(yield* service.get(Permission.ID.create("per_test"))).toBeDefined()
    }),
  )

  it.effect("uses saved bash approvals while preserving configured deny precedence", () =>
    Effect.gen(function* () {
      yield* setup()
      const saved = yield* PermissionSaved.Service
      yield* saved.add({ projectID: Project.ID.global, action: "bash", resources: ["pwd"] })

      const service = yield* Permission.Service
      expect(yield* service.ask(assertion({ action: "bash", resources: ["pwd"] }))).toEqual({
        id: Permission.ID.create("per_test"),
        effect: "allow",
      })
      expect(yield* service.list()).toEqual([])

      yield* setRules([{ action: "bash", resource: "*", effect: "deny" }])
      expect(yield* service.ask(assertion({ action: "bash", resources: ["pwd"] }))).toEqual({
        id: Permission.ID.create("per_test"),
        effect: "deny",
      })
    }),
  )

  it.effect("resolves an asked permission once", () =>
    Effect.gen(function* () {
      yield* attachResponder()
      yield* setup()
      const { service, fiber, request } = yield* waitForRequest()
      expect(yield* service.list()).toEqual([request])
      expect(yield* service.forSession(request.sessionID)).toEqual([request])
      expect(yield* service.forSession(Session.ID.make("ses_other"))).toEqual([])
      expect(yield* service.get(request.id)).toEqual(request)
      yield* service.reply({ requestID: request.id, reply: "once" })
      yield* Fiber.join(fiber)
      expect(yield* service.list()).toEqual([])
      expect(yield* service.get(request.id)).toBeUndefined()
    }),
  )

  it.effect("stores and removes saved resources for a project", () =>
    Effect.gen(function* () {
      yield* attachResponder()
      yield* setup()
      const service = yield* Permission.Service
      const asked = yield* Deferred.make<Permission.Request>()
      const bus = yield* Bus.Service
      const unsubscribe = yield* bus.listen((event) =>
        event.type === Permission.Event.Asked.type
          ? Deferred.succeed(asked, event.data as Permission.Request).pipe(Effect.asVoid)
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
      expect(yield* saved.list()).toMatchObject([
        { id, projectID: Project.ID.global, action: "read", resource: "src/*" },
      ])
      yield* service.assert(assertion({ id: Permission.ID.create("per_next"), resources: ["src/next.ts"] }))
      yield* saved.remove(id)
      expect(yield* saved.list()).toEqual([])
    }),
  )

  it.effect("root Session preserves ask rules (user is present)", () =>
    Effect.gen(function* () {
      // ses_test has no parentID → root session. ask rules stay as ask.
      yield* setup([{ action: "read", resource: "*", effect: "ask" }])
      const service = yield* Permission.Service
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
        .set({ parent_id: Session.ID.make("ses_parent"), attended: 0 })
        .where(eq(SessionTable.id, Session.ID.make("ses_test")))
        .run()
        .pipe(Effect.orDie)

      const service = yield* Permission.Service
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
        .set({ parent_id: Session.ID.make("ses_parent"), attended: 1 })
        .where(eq(SessionTable.id, Session.ID.make("ses_test")))
        .run()
        .pipe(Effect.orDie)

      const service = yield* Permission.Service
      // attended=true → ask preserved (user will respond).
      expect(yield* service.ask(assertion())).toMatchObject({ effect: "ask" })
    }),
  )

  it.effect("unattended Coding executes a Session allow that overrides Agent deny", () =>
    Effect.gen(function* () {
      yield* setup(
        [{ action: "read", resource: "*", effect: "deny" }],
        [{ action: "read", resource: "*", effect: "allow" }],
      )
      const { db } = yield* Database.Service
      yield* db
        .update(SessionTable)
        .set({ parent_id: Session.ID.make("ses_parent"), attended: 0 })
        .where(eq(SessionTable.id, Session.ID.make("ses_test")))
        .run()
        .pipe(Effect.orDie)

      const service = yield* Permission.Service
      const rules = yield* service.effectiveRules(Session.ID.make("ses_test"))
      expect(Permission.evaluate("read", "src/index.ts", rules).effect).toBe("allow")
      expect(yield* service.ask(assertion())).toMatchObject({ effect: "allow" })
      yield* service.assert(assertion())
      expect(yield* service.list()).toEqual([])
    }),
  )
  ;[true, false].forEach((hasAsk) => {
    it.effect(
      `unattended Coding denies ${hasAsk ? "Session ask rules" : "unmatched actions"} before saved approvals and hooks`,
      () =>
        Effect.gen(function* () {
          yield* setup(
            [{ action: "read", resource: "*", effect: "allow" }],
            hasAsk ? [{ action: "read", resource: "*", effect: "ask" }] : [],
          )
          const { db } = yield* Database.Service
          yield* db
            .update(SessionTable)
            .set({ parent_id: Session.ID.make("ses_parent"), attended: 0 })
            .where(eq(SessionTable.id, Session.ID.make("ses_test")))
            .run()
            .pipe(Effect.orDie)
          const input = assertion({ action: hasAsk ? "read" : "some_future_tool" })
          const saved = yield* PermissionSaved.Service
          yield* saved.add({ projectID: Project.ID.global, action: input.action, resources: ["src/*"] })
          const hooks = yield* PluginHooks.Service
          const effects: string[] = []
          yield* hooks.register("permission", "evaluate", (event) =>
            Effect.sync(() => {
              effects.push(event.effect)
              event.effect = "allow"
            }),
          )

          const service = yield* Permission.Service
          const rules = yield* service.effectiveRules(Session.ID.make("ses_test"))
          expect(Permission.evaluate(input.action, "src/index.ts", rules).effect).toBe("deny")
          expect(yield* service.ask(input)).toMatchObject({ effect: "deny" })
          const denied = yield* service.assert(input).pipe(Effect.flip)
          expect(denied).toBeInstanceOf(Permission.BlockedError)
          expect(effects).toEqual([])
          expect(yield* service.list()).toEqual([])
        }),
    )
  })

  it.effect("unattended Coding denies asks introduced by permission hooks even with a responder", () =>
    Effect.gen(function* () {
      yield* attachResponder()
      yield* setup([{ action: "read", resource: "*", effect: "allow" }])
      const database = yield* Database.Service
      yield* database.db
        .update(SessionTable)
        .set({ parent_id: Session.ID.make("ses_parent"), attended: 0 })
        .where(eq(SessionTable.id, Session.ID.make("ses_test")))
        .run()
        .pipe(Effect.orDie)
      const hooks = yield* PluginHooks.Service
      const effects: string[] = []
      yield* hooks.register("permission", "evaluate", (event) =>
        Effect.sync(() => {
          effects.push(event.effect)
          event.effect = "ask"
        }),
      )

      const service = yield* Permission.Service
      const asked = yield* service.ask(assertion())
      expect(effects).toEqual(["allow"])
      expect(asked).toMatchObject({ effect: "deny" })
      expect(yield* service.list()).toEqual([])
      const denied = yield* service.assert(assertion()).pipe(Effect.flip)
      expect(denied).toBeInstanceOf(Permission.BlockedError)
      expect(effects).toEqual(["allow", "allow"])
      expect(yield* service.list()).toEqual([])
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
        .set({ parent_id: Session.ID.make("ses_parent"), attended: 0 })
        .where(eq(SessionTable.id, Session.ID.make("ses_test")))
        .run()
        .pipe(Effect.orDie)

      const service = yield* Permission.Service
      expect(yield* service.ask(assertion())).toMatchObject({ effect: "allow" })
    }),
  )

  it.effect("unattended child Session denies an unmatched action instead of parking on the ask fallback", () =>
    Effect.gen(function* () {
      // No configured rule matches: previously evaluate's fallback ask parked
      // assert on a Deferred until teardown (a hung unattended task). The
      // catch-all deny makes it fail fast with BlockedError, queueing nothing.
      yield* setup()
      const { db } = yield* Database.Service
      yield* db
        .update(SessionTable)
        .set({ parent_id: Session.ID.make("ses_parent"), attended: 0 })
        .where(eq(SessionTable.id, Session.ID.make("ses_test")))
        .run()
        .pipe(Effect.orDie)

      const service = yield* Permission.Service
      const denied = yield* service.assert(assertion()).pipe(Effect.flip)
      expect(denied).toBeInstanceOf(Permission.BlockedError)
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
        .set({ parent_id: Session.ID.make("ses_parent"), attended: 0 })
        .where(eq(SessionTable.id, Session.ID.make("ses_test")))
        .run()
        .pipe(Effect.orDie)

      const service = yield* Permission.Service
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
        .set({ parent_id: Session.ID.make("ses_parent"), attended: 0 })
        .where(eq(SessionTable.id, Session.ID.make("ses_test")))
        .run()
        .pipe(Effect.orDie)
      const saved = yield* PermissionSaved.Service
      yield* saved.add({ projectID: Project.ID.global, action: "read", resources: ["src/*"] })

      const service = yield* Permission.Service
      const denied = yield* service.assert(assertion()).pipe(Effect.flip)
      expect(denied).toBeInstanceOf(Permission.BlockedError)
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("exposes effective rules through the session-backed owner", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "read", resource: "*", effect: "allow" }])
      const service = yield* Permission.Service

      // coding 模式默认忽略档位：owner 返回 Agent 固有信封。
      const rules = yield* service.effectiveRules(Session.ID.make("ses_test"))
      expect(rules).toEqual([{ action: "read", resource: "*", effect: "allow" }])
    }),
  )

  it.effect("effective rules honor the session tier and drive assert identically", () =>
    Effect.gen(function* () {
      yield* attachResponder()
      yield* setup()
      yield* (yield* Agent.Service).transform((editor) =>
        editor.update(Agent.ID.make("meta"), (agent) => {
          agent.permissions = [{ action: "read", resource: "*", effect: "allow" }]
        }),
      )
      const { db } = yield* Database.Service
      yield* db
        .update(SessionTable)
        .set({ mode: "chat", agent: "meta", permission_tier: "full" })
        .where(eq(SessionTable.id, Session.ID.make("ses_test")))
        .run()
        .pipe(Effect.orDie)

      const service = yield* Permission.Service
      const rules = yield* service.effectiveRules(Session.ID.make("ses_test"))
      // full：未知 action 抬到 ask，read allow 保留。
      expect(rules.some((rule) => rule.action === "*" && rule.effect === "ask")).toBe(true)
      expect(Permission.evaluate("some_future_tool", "*", rules).effect).toBe("ask")
      expect(Permission.evaluate("read", "src/index.ts", rules).effect).toBe("allow")

      // 同一 owner 驱动执行授权：edit 为 ask → assert 进入 Permission Dock。
      yield* service.assert({ ...assertion(), action: "edit", resources: ["foo.ts"] }).pipe(Effect.forkScoped)
      const asked = yield* Deferred.make<Permission.Request>()
      const unsubscribe = yield* (yield* Bus.Service).listen((event) =>
        event.type === Permission.Event.Asked.type
          ? Deferred.succeed(asked, Schema.decodeUnknownSync(Permission.Request)(event.data)).pipe(Effect.asVoid)
          : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const request = yield* Deferred.await(asked)
      expect(request.action).toBe("edit")
      yield* service.reply({ requestID: request.id, reply: "reject" })
    }),
  )
})

describe("Permission always auto-approval (H1)", () => {
  it.effect("keeps chat full dangerous actions ask-gated when another request is saved", () =>
    Effect.gen(function* () {
      yield* setup()
      yield* (yield* Agent.Service).transform((editor) =>
        editor.update(Agent.ID.make("meta"), (agent) => {
          agent.permissions = [
            { action: "*", resource: "*", effect: "deny" },
            { action: "read", resource: "*", effect: "allow" },
            { action: "edit", resource: "*", effect: "ask" },
          ]
        }),
      )
      const { db } = yield* Database.Service
      yield* db
        .update(SessionTable)
        .set({ mode: "chat", agent: "meta", permission_tier: "full" })
        .where(eq(SessionTable.id, Session.ID.make("ses_test")))
        .run()
        .pipe(Effect.orDie)

      const service = yield* Permission.Service
      // 两个 edit 请求都 ask（chat full 危险 action 逐次确认）。
      const first = yield* service.ask(
        assertion({ id: Permission.ID.create("per_always_a"), action: "edit", resources: ["src/a.ts"], save: ["*"] }),
      )
      const second = yield* service.ask(
        assertion({ id: Permission.ID.create("per_always_b"), action: "edit", resources: ["src/b.ts"] }),
      )
      expect(first.effect).toBe("ask")
      expect(second.effect).toBe("ask")

      // 对第一个 reply always → saved 产出 {edit, "*", allow}。
      yield* service.reply({ requestID: first.id, reply: "always" })

      // 第二个 edit 不得被自动放行（仍逐次确认）。
      const remaining = yield* service.list()
      expect(remaining.some((item) => item.resources[0] === "src/b.ts")).toBe(true)
      expect(remaining.every((item) => item.resources[0] === "src/a.ts")).toBe(false)
    }),
  )
})
