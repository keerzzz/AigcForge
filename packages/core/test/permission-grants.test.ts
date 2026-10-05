import { describe, expect } from "bun:test"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { AgentV2 } from "@aigcfroge/core/agent"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { Location } from "@aigcfroge/core/location"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionV2 } from "@aigcfroge/core/session"
import { PermissionSaved } from "@aigcfroge/core/permission/saved"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { ApprovalPresence } from "@aigcfroge/core/permission/approval-presence"
import { GrantEvent } from "@aigcfroge/core/grant/event"
import { ScopedGrantStore } from "@aigcfroge/core/grant/store"
import { Cause, Context, Deferred, Duration, Effect, Exit, Fiber, Layer, Schema } from "effect"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import * as TestClock from "effect/testing/TestClock"
import { withCustomModeEnabled } from "./lib/product-mode"

// ADR-20 §2.2 consultation order, exercised through the real PermissionV2
// layer: policy rulesets decide first — deny rejects outright, allow passes
// outright, and only an `ask` verdict consults candidate grants. A consumed
// `once` grant must make the very next identical call fall back to asking.

withCustomModeEnabled()

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
const grantDependencies = Layer.mergeAll(Database.defaultLayer, EventV2.defaultLayer)
const grants = ScopedGrantStore.locationLayer.pipe(Layer.provide(Layer.mergeAll(grantDependencies, current)))

const layer = PermissionV2.locationLayer.pipe(
  Layer.provideMerge(Database.defaultLayer),
  Layer.provideMerge(SessionStore.defaultLayer),
  Layer.provideMerge(EventV2.defaultLayer),
  Layer.provideMerge(current),
  Layer.provideMerge(sessions),
  Layer.provideMerge(SessionExecution.noopLayer),
  Layer.provideMerge(PermissionSaved.defaultLayer),
  Layer.provideMerge(grants),
  Layer.provideMerge(ApprovalPresence.defaultLayer),
)
const it = testEffect(layer)

function setup(rules: PermissionV2.Ruleset, sessionID = SessionV2.ID.make("ses_grant_perm")) {
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
        id: sessionID,
        project_id: Project.ID.global,
        slug: "ses_grant_perm",
        directory: AbsolutePath.make("/project"),
        title: "grants",
        version: "test",
        mode: "custom",
        agent: AgentV2.ID.make("test"),
        attended: null,
        time_created: Date.now(),
        time_updated: Date.now(),
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    const agents = yield* AgentV2.Service
    yield* agents.transform((editor) =>
      editor.update(AgentV2.ID.make("test"), (agent) => {
        agent.permissions = [...rules]
      }),
    )
    return sessionID
  })
}

describe("PermissionV2 × ScopedGrant consultation (ADR-20 §2.2)", () => {
  it.effect("full chain: ask verdict hits grant, skips the prompt, consumes once, next call asks again", () =>
    Effect.gen(function* () {
      const sessionID = yield* setup([{ action: "bash", resource: "*", effect: "ask" }])
      const store = yield* ScopedGrantStore.Service
      const service = yield* PermissionV2.Service

      yield* store.issue({ scope: { level: "once" }, action: "bash", resources: ["/tmp/*"] })

      // First call: the grant answers the ask — no pending request is created.
      yield* service.assert({
        sessionID,
        action: "bash",
        resources: ["/tmp/run.sh"],
        agent: AgentV2.ID.make("test"),
      })
      expect(yield* service.forSession(sessionID)).toHaveLength(0)

      // Second identical call: the once grant is gone, so the ask surfaces.
      const result = yield* service.ask({
        sessionID,
        action: "bash",
        resources: ["/tmp/run.sh"],
        agent: AgentV2.ID.make("test"),
      })
      expect(result.effect).toBe("ask")
      expect(yield* service.forSession(sessionID)).toHaveLength(1)

      // The consumed grant is terminal in the store itself.
      const all = yield* store.findValid({ action: "bash", resources: ["/tmp/x"], sessionID })
      expect(all).toBeUndefined()
    }),
  )

  it.effect("a grant never flips a policy deny", () =>
    Effect.gen(function* () {
      const sessionID = yield* setup([{ action: "bash", resource: "*", effect: "deny" }])
      const store = yield* ScopedGrantStore.Service
      const service = yield* PermissionV2.Service

      yield* store.issue({ scope: { level: "location" }, action: "bash", resources: ["*"] })

      const exit = yield* service
        .assert({ sessionID, action: "bash", resources: ["/anywhere"], agent: AgentV2.ID.make("test") })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(yield* service.forSession(sessionID)).toHaveLength(0)
    }),
  )

  it.effect("an allow rule passes without consulting or consuming any grant", () =>
    Effect.gen(function* () {
      const sessionID = yield* setup([{ action: "read", resource: "*", effect: "allow" }])
      const store = yield* ScopedGrantStore.Service
      const service = yield* PermissionV2.Service

      const grant = yield* store.issue({ scope: { level: "once" }, action: "read", resources: ["*"] })

      yield* service.assert({
        sessionID,
        action: "read",
        resources: ["src/index.ts"],
        agent: AgentV2.ID.make("test"),
      })

      const after = yield* store.get(grant.grant.id)
      expect(after?.status).toBe("active")
    }),
  )

  it.effect("saved always approvals keep working alongside grants (no migration of meaning)", () =>
    Effect.gen(function* () {
      const sessionID = yield* setup([])
      const saved = yield* PermissionSaved.Service
      const location = yield* Location.Service
      yield* saved.add({ projectID: location.project.id, action: "edit", resources: ["docs/*"] })
      const service = yield* PermissionV2.Service

      const rules = yield* service.effectiveRules(sessionID, AgentV2.ID.make("test"))
      expect(
        rules.some((rule) => rule.action === "edit" && rule.resource === "docs/*" && rule.effect === "allow"),
      ).toBe(true)

      // And the stored shape is untouched: four fields, Project-scoped.
      const listed = yield* saved.list({})
      expect(listed).toHaveLength(1)
      expect(Object.keys(Schema.decodeUnknownSync(Schema.Any)(listed[0]) ?? {}).sort()).toEqual([
        "action",
        "id",
        "projectID",
        "resource",
      ])
    }),
  )
  it.effect("attended custom allow-all asset really surfaces the ask prompt (full chain)", () =>
    Effect.gen(function* () {
      const sessionID = yield* setup([{ action: "bash", resource: "*", effect: "allow" }])
      const service = yield* PermissionV2.Service

      // Pre-fix this assert returned silently (allow). The rewrite must make
      // the approval request actually appear.
      const result = yield* service.ask({
        sessionID,
        action: "bash",
        resources: ["/workspace/build.sh"],
        agent: AgentV2.ID.make("test"),
      })
      expect(result.effect).toBe("ask")
      const pending = yield* service.forSession(sessionID)
      expect(pending).toHaveLength(1)

      // Replying settles the surfaced prompt.
      yield* service.reply({ requestID: pending[0]!.id, reply: "reject" })
      expect(yield* service.forSession(sessionID)).toHaveLength(0)
    }),
  )
})

describe("PermissionV2 grant settlement (AI-TDD-S03)", () => {
  for (const level of ["session", "location"] as const) {
    it.effect(`R04: ${level} grant facts and consumption stay within their owner scope`, () =>
      Effect.gen(function* () {
        const sessionID = yield* setup([{ action: "bash", resource: "*", effect: "ask" }])
        const other = yield* setup(
          [{ action: "bash", resource: "*", effect: "ask" }],
          SessionV2.ID.make("ses_grant_other"),
        )
        const service = yield* PermissionV2.Service
        const store = yield* ScopedGrantStore.Service
        const request = yield* service.ask({ sessionID, action: "bash", resources: ["/tmp/run.sh"] })
        const granted = yield* service.grant({ sessionID, requestID: request.id, level })
        expect(granted.grant.action).toBe("bash")
        expect(granted.grant.resources).toEqual(["/tmp/run.sh"])
        expect(granted.grant.scope).toEqual(level === "session" ? { level, sessionID } : { level })
        expect(yield* service.list()).toEqual([])
        expect((yield* service.ask({ sessionID, action: "bash", resources: ["/tmp/run.sh"] })).effect).toBe("allow")
        const otherDecision = yield* service.ask({ sessionID: other, action: "bash", resources: ["/tmp/run.sh"] })
        expect(otherDecision.effect).toBe(level === "session" ? "ask" : "allow")
        if (otherDecision.effect === "ask") yield* service.reply({ requestID: otherDecision.id, reply: "reject" })
        expect((yield* store.get(granted.grant.id))?.status).toBe("active")
        const elsewhere = Context.get(
          yield* Layer.build(
            Layer.fresh(
              ScopedGrantStore.layer.pipe(
                Layer.provide(
                  Layer.succeed(
                    Location.Service,
                    Location.Service.of(location({ directory: AbsolutePath.make("/other") })),
                  ),
                ),
              ),
            ),
          ),
          ScopedGrantStore.Service,
        )
        expect(yield* elsewhere.findValid({ sessionID, action: "bash", resources: ["/tmp/run.sh"] })).toBeUndefined()
      }),
    )
  }

  it.effect("R02/R03: missing, rejected, and foreign-session requests never issue grants", () =>
    Effect.gen(function* () {
      const sessionID = yield* setup([])
      const service = yield* PermissionV2.Service
      const store = yield* ScopedGrantStore.Service
      const request = yield* service.ask({ sessionID, action: "bash", resources: ["/tmp/run.sh"] })
      const foreign = yield* service
        .grant({ sessionID: SessionV2.ID.make("ses_wrong"), requestID: request.id, level: "session" })
        .pipe(Effect.exit)
      expect(Exit.isFailure(foreign)).toBe(true)
      expect(yield* service.get(request.id)).toBeDefined()
      expect(yield* store.list()).toEqual([])
      yield* service.reply({ requestID: request.id, reply: "reject" })
      for (const requestID of [request.id, PermissionV2.ID.create("per_missing")]) {
        expect(yield* service.grant({ sessionID, requestID, level: "location" }).pipe(Effect.flip)).toEqual(
          new PermissionV2.NotFoundError({ requestID }),
        )
      }
      expect(yield* store.list()).toEqual([])
    }),
  )

  it.effect("R03: simultaneous scoped approvals issue exactly one durable grant", () =>
    Effect.gen(function* () {
      const sessionID = yield* setup([])
      const service = yield* PermissionV2.Service
      const store = yield* ScopedGrantStore.Service
      const request = yield* service.ask({ sessionID, action: "bash", resources: ["/tmp/run.sh"] })
      const events = yield* EventV2.Service
      const off = yield* events.listen((event) =>
        event.type === GrantEvent.Updated.type ? Effect.yieldNow : Effect.void,
      )
      yield* Effect.addFinalizer(() => off)
      const results = yield* Effect.all(
        (["session", "location"] as const).map((level) =>
          service.grant({ sessionID, requestID: request.id, level }).pipe(Effect.exit),
        ),
        { concurrency: "unbounded" },
      )
      expect(results.filter(Exit.isSuccess)).toHaveLength(1)
      expect(results.filter(Exit.isFailure)).toHaveLength(1)
      expect(yield* store.list()).toHaveLength(1)
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("R06: rejected persistence preserves the prompt and emits no success", () =>
    Effect.gen(function* () {
      const sessionID = yield* setup([])
      const service = yield* PermissionV2.Service
      const store = yield* ScopedGrantStore.Service
      const request = yield* service.ask({ sessionID, action: "bash", resources: ["/tmp/run.sh"] })
      const events = yield* EventV2.Service
      const terminal: EventV2.Payload[] = []
      const off = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === PermissionV2.Event.Replied.type) terminal.push(event)
        }),
      )
      yield* Effect.addFinalizer(() => off)
      const result = yield* service.grant({ sessionID, requestID: request.id, level: "session" }).pipe(
        Effect.provide(
          Layer.mock(ScopedGrantStore.Service, {
            issue: () => new GrantEvent.CommitRejected({ grantID: "grant_failed", revision: 1 }),
          }),
        ),
        Effect.exit,
      )
      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) expect(Cause.squash(result.cause)).toBeInstanceOf(GrantEvent.CommitRejected)
      expect(yield* service.get(request.id)).toBeDefined()
      expect(yield* store.list()).toEqual([])
      expect(terminal).toEqual([])
      yield* service.reply({ requestID: request.id, reply: "reject" })
    }),
  )

  it.effect("R06: lost settlement notification cannot reopen a committed grant or issue a duplicate", () =>
    Effect.gen(function* () {
      const sessionID = yield* setup([])
      const service = yield* PermissionV2.Service
      const store = yield* ScopedGrantStore.Service
      const request = yield* service.ask({ sessionID, action: "bash", resources: ["/tmp/run.sh"] })
      const events = yield* EventV2.Service
      const off = yield* events.listen((event) =>
        event.type === PermissionV2.Event.Replied.type ? Effect.die("permission notification failed") : Effect.void,
      )
      yield* Effect.addFinalizer(() => off)
      const input = { sessionID, requestID: request.id, level: "session" as const }
      expect(Exit.isFailure(yield* service.grant(input).pipe(Effect.exit))).toBe(true)
      expect(yield* service.list()).toEqual([])
      expect(yield* store.list({ status: "active" })).toHaveLength(1)
      expect(yield* service.grant(input).pipe(Effect.flip)).toEqual(
        new PermissionV2.NotFoundError({ requestID: request.id }),
      )
      expect(yield* store.list()).toHaveLength(1)
    }),
  )
})

it.effect("AI-TDD-S03-R03/R06: a grant owning the decision wins a concurrent TTL boundary", () =>
  Effect.gen(function* () {
    const sessionID = yield* setup([])
    const service = yield* PermissionV2.Service
    const presence = yield* ApprovalPresence.Service
    yield* presence.bindResponder({ custom: true })
    const id = PermissionV2.ID.create("per_grant_expiry")
    const asked = yield* Deferred.make<void>()
    const issued = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const terminal: EventV2.Payload[] = []
    const events = yield* EventV2.Service
    const off = yield* events.listen((event) => {
      if (event.type === PermissionV2.Event.Asked.type) return Deferred.succeed(asked, undefined).pipe(Effect.asVoid)
      if (event.type === GrantEvent.Updated.type)
        return Deferred.succeed(issued, undefined).pipe(Effect.andThen(Deferred.await(release)))
      if (event.type === PermissionV2.Event.Replied.type) terminal.push(event)
      return Effect.void
    })
    yield* Effect.addFinalizer(() => off)
    const scope = yield* Effect.scope
    const waiting = yield* service
      .assert({ id, sessionID, action: "bash", resources: ["/tmp/run.sh"] })
      .pipe(Effect.forkIn(scope))
    yield* Deferred.await(asked)
    const granting = yield* service.grant({ sessionID, requestID: id, level: "session" }).pipe(Effect.forkIn(scope))
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
    yield* Deferred.await(issued)
    yield* TestClock.adjust(Duration.millis(presence.ttlMs))
    yield* Deferred.succeed(release, undefined)
    const grant = yield* Fiber.join(granting)
    expect(Exit.isSuccess(yield* Fiber.await(waiting))).toBe(true)
    expect(grant.status).toBe("active")
    expect(terminal).toHaveLength(1)
    expect(yield* service.list()).toEqual([])
  }),
)
