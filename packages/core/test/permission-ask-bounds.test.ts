import { describe, expect } from "bun:test"
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Option, Schema, Scope } from "effect"
import { eq } from "drizzle-orm"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { AgentV2 } from "@aigcfroge/core/agent"
import { ApprovalPresence } from "@aigcfroge/core/permission/approval-presence"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { Location } from "@aigcfroge/core/location"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { SessionV2 } from "@aigcfroge/core/session"
import { PermissionSaved } from "@aigcfroge/core/permission/saved"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { location } from "./fixture/location"
import { pollWithTimeout, testEffect } from "./lib/effect"

// ADR-20 §2.7: an `ask` may only wait while a capable responder is attached,
// and never longer than the configured TTL. Both bounds fail typed and clear
// the pending request.

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
const harness = (presence: Layer.Layer<ApprovalPresence.Service> = ApprovalPresence.defaultLayer) =>
  PermissionV2.locationLayer.pipe(
    Layer.provideMerge(Database.defaultLayer),
    Layer.provideMerge(SessionStore.defaultLayer),
    Layer.provideMerge(EventV2.defaultLayer),
    Layer.provideMerge(current),
    Layer.provideMerge(sessions),
    Layer.provideMerge(SessionExecution.noopLayer),
    Layer.provideMerge(PermissionSaved.defaultLayer),
    Layer.provideMerge(presence),
  )
const it = testEffect(harness())

const setup = (rules: PermissionV2.Ruleset) =>
  Effect.gen(function* () {
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
        id: SessionV2.ID.make("ses_ask_ttl"),
        project_id: Project.ID.global,
        slug: "ses_ask_ttl",
        directory: AbsolutePath.make("/project"),
        title: "ask ttl",
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
    return SessionV2.ID.make("ses_ask_ttl")
  })

describe("ApprovalPresence × ask bounds (ADR-20 §2.7)", () => {
  it.effect("rejects the ask immediately when no capable responder is attached", () =>
    Effect.gen(function* () {
      const presence = yield* ApprovalPresence.Service
      // No responder is bound for this runtime: the fact source reports zero.
      const sessionID = yield* setup([{ action: "bash", resource: "*", effect: "ask" }])
      const service = yield* PermissionV2.Service

      const exit = yield* service
        .assert({ sessionID, action: "bash", resources: ["/tmp/run.sh"], agent: AgentV2.ID.make("test") })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause) instanceof PermissionV2.RejectedError).toBe(true)
      }
      expect(yield* service.forSession(sessionID)).toHaveLength(0)
    }),
  )

  it.effect("rejects a custom execution ask immediately when only a legacy responder is attached", () =>
    Effect.gen(function* () {
      const presence = yield* ApprovalPresence.Service
      yield* presence.bindResponder({ custom: false })
      const sessionID = yield* setup([{ action: "bash", resource: "*", effect: "ask" }])
      const service = yield* PermissionV2.Service

      const exit = yield* service
        .assert({ sessionID, action: "bash", resources: ["/tmp/run.sh"], agent: AgentV2.ID.make("test") })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      const error = Exit.isFailure(exit) ? Option.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
      expect(error).toBeInstanceOf(PermissionV2.RejectedError)
      if (error instanceof PermissionV2.RejectedError) expect(error.reason).toBe("no_responder")
      expect(yield* service.forSession(sessionID)).toHaveLength(0)
    }),
  )

  it.effect("publishes and resolves a custom ask when a capable responder is attached", () =>
    Effect.gen(function* () {
      const presence = yield* ApprovalPresence.Service
      yield* presence.bindResponder({ custom: true })
      const sessionID = yield* setup([{ action: "bash", resource: "*", effect: "ask" }])
      const service = yield* PermissionV2.Service
      const events = yield* EventV2.Service
      const asked = yield* Deferred.make<PermissionV2.Request>()
      const unsubscribe = yield* events.listen((event) =>
        event.type === PermissionV2.Event.Asked.type
          ? Deferred.succeed(asked, Schema.decodeUnknownSync(PermissionV2.Request)(event.data)).pipe(Effect.asVoid)
          : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const fiber = yield* service
        .assert({ sessionID, action: "bash", resources: ["/tmp/run.sh"], agent: AgentV2.ID.make("test") })
        .pipe(Effect.forkScoped)
      const request = yield* Deferred.await(asked)

      expect(request.sessionID).toBe(sessionID)
      expect(yield* service.forSession(sessionID)).toEqual([request])
      yield* service.reply({ requestID: request.id, reply: "once" })
      yield* Fiber.join(fiber)
      expect(yield* service.forSession(sessionID)).toHaveLength(0)
    }),
  )

  it.effect("keeps a non-custom execution ask answerable through a legacy responder", () =>
    Effect.gen(function* () {
      const presence = yield* ApprovalPresence.Service
      yield* presence.bindResponder({ custom: false })
      const sessionID = yield* setup([{ action: "bash", resource: "*", effect: "ask" }])
      const { db } = yield* Database.Service
      yield* db
        .update(SessionTable)
        .set({ mode: "coding" })
        .where(eq(SessionTable.id, sessionID))
        .run()
        .pipe(Effect.orDie)
      const service = yield* PermissionV2.Service
      const events = yield* EventV2.Service
      const asked = yield* Deferred.make<PermissionV2.Request>()
      const unsubscribe = yield* events.listen((event) =>
        event.type === PermissionV2.Event.Asked.type
          ? Deferred.succeed(asked, Schema.decodeUnknownSync(PermissionV2.Request)(event.data)).pipe(Effect.asVoid)
          : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const fiber = yield* service
        .assert({ sessionID, action: "bash", resources: ["/tmp/run.sh"], agent: AgentV2.ID.make("test") })
        .pipe(Effect.forkScoped)
      const request = yield* Deferred.await(asked)

      expect(request.sessionID).toBe(sessionID)
      yield* service.reply({ requestID: request.id, reply: "once" })
      yield* Fiber.join(fiber)
      expect(yield* service.forSession(sessionID)).toHaveLength(0)
    }),
  )

  it.effect("does not let a responder from another Location answer a custom execution ask", () =>
    Effect.gen(function* () {
      const presence = yield* ApprovalPresence.Service
      yield* presence.bindResponder({
        location: { directory: AbsolutePath.make("/other-project") },
        custom: true,
      })
      const sessionID = yield* setup([{ action: "bash", resource: "*", effect: "ask" }])
      const service = yield* PermissionV2.Service

      const exit = yield* service
        .assert({ sessionID, action: "bash", resources: ["/tmp/run.sh"], agent: AgentV2.ID.make("test") })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      const error = Exit.isFailure(exit) ? Option.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
      expect(error).toBeInstanceOf(PermissionV2.RejectedError)
      if (error instanceof PermissionV2.RejectedError) expect(error.reason).toBe("no_responder")
      expect(yield* service.forSession(sessionID)).toHaveLength(0)
    }),
  )

  // Short-TTL variant runs on its own runtime (real clock, 10ms bound).
  it.effect("still resolves through reply while inside the TTL window", () =>
    Effect.gen(function* () {
      const presence = yield* ApprovalPresence.Service
      yield* presence.bindResponder({ custom: true })
      const sessionID = yield* setup([{ action: "bash", resource: "*", effect: "ask" }])
      const service = yield* PermissionV2.Service

      yield* service.ask({ sessionID, action: "bash", resources: ["/tmp/run.sh"], agent: AgentV2.ID.make("test") })
      const pending = yield* service.forSession(sessionID)
      expect(pending).toHaveLength(1)
      yield* service.reply({ requestID: pending[0]!.id, reply: "once" })
      expect(yield* service.forSession(sessionID)).toHaveLength(0)
    }),
  )
})

// The SSE route layer and `LocationServiceMap` dependencies each provide
// `ApprovalPresence.defaultLayer` independently, under one shared MemoMap. If
// that ever yields two instances, connections bind a counter the Locations
// cannot see and every prompt is rejected again — the same P0 in a subtler
// shape, invisible to any single-composition test.
describe("ApprovalPresence instance sharing", () => {
  it.live("shares responder mode facts across independently provided compositions", () =>
    Effect.gen(function* () {
      const memoMap = Layer.makeMemoMapUnsafe()
      const scope = yield* Scope.make()
      const first = yield* Layer.buildWithMemoMap(ApprovalPresence.defaultLayer, memoMap, scope)
      const second = yield* Layer.buildWithMemoMap(ApprovalPresence.defaultLayer, memoMap, scope)
      const viaRoute = Context.get(first, ApprovalPresence.Service)
      const viaLocation = Context.get(second, ApprovalPresence.Service)

      expect(
        yield* viaLocation.hasResponder({
          location: { directory: AbsolutePath.make("/project") },
          mode: "custom",
        }),
      ).toBe(false)
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* viaRoute.bindResponder({
            location: { directory: AbsolutePath.make("/project") },
            custom: true,
          })
          // Bound through one composition, observed through the other.
          expect(
            yield* viaLocation.hasResponder({
              location: { directory: AbsolutePath.make("/project") },
              mode: "custom",
            }),
          ).toBe(true)
        }),
      )
      expect(
        yield* viaLocation.hasResponder({
          location: { directory: AbsolutePath.make("/project") },
          mode: "custom",
        }),
      ).toBe(false)
      yield* Scope.close(scope, Exit.void)
    }),
  )
})

// The two halves of Phase D composed. Every other case in this file hands
// `effect: "ask"` to the evaluator directly, so none of them exercise the path
// that actually ships: an ordinary asset-declared `allow` rewritten to `ask` by
// the custom ceiling, then meeting the responder-fact gate. That gap is how a
// build shipped where the rewrite was live and the fact source was not, turning
// every prompt into a hard denial (ADR-20 §2.6 + §2.7).
describe("custom ceiling × responder facts (composed)", () => {
  it.effect("a rewritten allow reaches a real prompt while a responder is attached", () =>
    Effect.gen(function* () {
      const presence = yield* ApprovalPresence.Service
      yield* presence.bindResponder({ custom: true })
      // Exactly what `tools: [bash]` in an agent file compiles to — no author
      // wrote "ask" anywhere.
      const sessionID = yield* setup([{ action: "bash", resource: "*", effect: "allow" }])
      const service = yield* PermissionV2.Service

      const verdict = yield* service.ask({
        sessionID,
        action: "bash",
        resources: ["/tmp/run.sh"],
        agent: AgentV2.ID.make("test"),
      })
      expect(verdict.effect).toBe("ask")
      const pending = yield* service.forSession(sessionID)
      expect(pending).toHaveLength(1)

      // And it is answerable: the ceiling restores the approval surface rather
      // than removing the capability.
      yield* service.reply({ requestID: pending[0]!.id, reply: "once" })
      expect(yield* service.forSession(sessionID)).toHaveLength(0)
    }),
  )

  it.effect("a whitelisted readonly allow is untouched by the ceiling and never prompts", () =>
    Effect.gen(function* () {
      const presence = yield* ApprovalPresence.Service
      yield* presence.bindResponder({ custom: true })
      const sessionID = yield* setup([{ action: "read", resource: "*", effect: "allow" }])
      const service = yield* PermissionV2.Service

      yield* service.assert({
        sessionID,
        action: "read",
        resources: ["src/index.ts"],
        agent: AgentV2.ID.make("test"),
      })
      expect(yield* service.forSession(sessionID)).toHaveLength(0)
    }),
  )

  it.effect("a rewritten allow is denied with no prompt when nothing can answer", () =>
    Effect.gen(function* () {
      const sessionID = yield* setup([{ action: "bash", resource: "*", effect: "allow" }])
      const service = yield* PermissionV2.Service

      const exit = yield* service
        .assert({ sessionID, action: "bash", resources: ["/tmp/run.sh"], agent: AgentV2.ID.make("test") })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = Cause.squash(exit.cause)
        expect(failure instanceof PermissionV2.RejectedError).toBe(true)
        if (failure instanceof PermissionV2.RejectedError) expect(failure.reason).toBe("no_responder")
      }
      expect(yield* service.forSession(sessionID)).toHaveLength(0)
    }),
  )
})

/**
 * The third bound on the same `Deferred.await`, alongside responder facts and
 * the TTL: the owning layer scope closing.
 *
 * `permission.ts` registers a finalizer that fails every parked ask when its
 * scope goes away — the release path a Session close or Location unload
 * ultimately runs through. Nothing exercised it, and a leak here is the worst
 * shape available: the tool call's fiber never settles, so the turn hangs with
 * no error and no timeout left to save it (the TTL fiber died with the scope).
 *
 * Asserting the tag is only half of it. `reply` publishes
 * `permission.v2.replied`; this finalizer publishes nothing, so a shutdown-
 * cancelled approval leaves no ledger entry at all. That asymmetry is pinned
 * here so it stays a deliberate choice rather than drifting silently.
 */
describe("PermissionV2 owner scope release (M3 Phase G §7.1)", () => {
  it.live("fails a parked ask when the owning scope closes, and records nothing for it", () =>
    Effect.gen(function* () {
      const replied: Array<string> = []
      const scope = yield* Scope.make()
      // `Layer.fresh` so this owns its own in-memory Database and pending map
      // rather than sharing the file-level harness instance. The 5s TTL is what
      // makes a missing release *observable*: `assert` runs inside
      // `uninterruptibleMask`, so no timeout the test wraps around it can cut it
      // short — the production TTL is the only bound that can fire, and it then
      // arrives as `AskExpiredError` instead of the `RejectedError` asserted
      // below. Without it a regression here shows up as the runner's own
      // timeout with no message.
      const context = yield* Layer.buildWithScope(Layer.fresh(harness(ApprovalPresence.make(5_000))), scope)

      const parked = yield* Effect.gen(function* () {
        const presence = yield* ApprovalPresence.Service
        yield* presence.bindResponder({ custom: true })
        const sessionID = yield* setup([{ action: "bash", resource: "*", effect: "ask" }])
        const service = yield* PermissionV2.Service
        const events = yield* EventV2.Service
        const unsubscribe = yield* events.listen((event) =>
          Effect.sync(() => {
            if (event.type === PermissionV2.Event.Replied.type) replied.push(event.type)
          }),
        )
        yield* Effect.addFinalizer(() => unsubscribe)

        const fiber = yield* service
          .assert({ sessionID, action: "bash", resources: ["/tmp/run.sh"], agent: AgentV2.ID.make("test") })
          .pipe(Effect.exit, Effect.forkScoped)
        // Wait for the request to actually be pending: forking only guarantees
        // the fiber started, and closing before `create` would prove nothing.
        // A present entry is also the control — `assert` deletes it on settle
        // (`ensuring`), so "still listed" means "still parked", and the failure
        // below has to have come from the close.
        const pending = yield* pollWithTimeout(
          service.forSession(sessionID).pipe(Effect.map((all) => (all.length === 1 ? all : undefined))),
          "the ask never became pending",
        )
        expect(pending).toHaveLength(1)
        return fiber
      }).pipe(
        Effect.provide(context),
        // Without this, anything throwing above leaves the parked fiber holding
        // the test scope open and the failure surfaces as a runner timeout.
        Effect.onError(() => Scope.close(scope, Exit.void)),
      )

      yield* Scope.close(scope, Exit.void)

      const exit = yield* Fiber.join(parked)
      expect(Exit.isFailure(exit)).toBe(true)
      const error = Exit.isFailure(exit) ? Option.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
      expect(error).toBeInstanceOf(PermissionV2.RejectedError)
      // No reason is carried, so this is indistinguishable from a user rejection
      // at the type level — see the block comment.
      expect(replied).toEqual([])
    }),
  )
})

describe("ApprovalPresence × ask TTL (short, live clock)", () => {
  const itTtl = testEffect(harness(ApprovalPresence.make(10)))
  itTtl.live("expires the ask with a typed error once the TTL elapses unanswered", () =>
    Effect.gen(function* () {
      const presence = yield* ApprovalPresence.Service
      yield* presence.bindResponder({ custom: true }) // attached but never answers
      expect(presence.ttlMs).toBe(10)
      const sessionID = yield* setup([{ action: "bash", resource: "*", effect: "ask" }])
      const service = yield* PermissionV2.Service

      const exit = yield* service
        .assert({ sessionID, action: "bash", resources: ["/tmp/run.sh"], agent: AgentV2.ID.make("test") })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause) instanceof PermissionV2.AskExpiredError).toBe(true)
      }
      expect(yield* service.forSession(sessionID)).toHaveLength(0)
    }),
  )
})

/**
 * `make` is exported and its doc comment promises `(0, MAX_TTL_MS]`, but nothing
 * held it to that. The bound matters in both directions and they fail
 * differently: a TTL that clamps to 0 turns every ask into an instant expiry
 * (F0's fix inverted into a denial), while an unbounded one restores the hang F0
 * removed by parking a tool call until the Location is evicted.
 *
 * The last case is the one that would actually bite: production only ever calls
 * `make(DEFAULT_TTL_MS)`, so a clamp that mangled its own default is the single
 * reachable defect here, and it is invisible to every other case in this file
 * because they all pass an explicit TTL.
 */
const ttlOf = (ttlMs: number) =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(ApprovalPresence.make(ttlMs))
      return Context.get(context, ApprovalPresence.Service).ttlMs
    }),
  )

describe("ApprovalPresence TTL clamp (ADR-20 §2.7)", () => {
  it.effect("raises a non-positive TTL to a still-waiting window rather than an instant expiry", () =>
    Effect.gen(function* () {
      expect(yield* ttlOf(0)).toBe(1)
      expect(yield* ttlOf(-5)).toBe(1)
      expect(yield* ttlOf(1)).toBe(1)
    }),
  )

  it.effect("caps a TTL above the ceiling so no ask can park indefinitely", () =>
    Effect.gen(function* () {
      expect(yield* ttlOf(ApprovalPresence.MAX_TTL_MS + 1)).toBe(ApprovalPresence.MAX_TTL_MS)
      expect(yield* ttlOf(Number.POSITIVE_INFINITY)).toBe(ApprovalPresence.MAX_TTL_MS)
    }),
  )

  it.effect("floors a fractional TTL instead of handing a non-integer to the timeout", () =>
    Effect.gen(function* () {
      expect(yield* ttlOf(10.9)).toBe(10)
    }),
  )

  it.effect("leaves the shipped default exactly as declared", () =>
    Effect.gen(function* () {
      // The positive control, and the only clamp input production reaches.
      expect(ApprovalPresence.DEFAULT_TTL_MS).toBe(300_000)
      expect(yield* ttlOf(ApprovalPresence.DEFAULT_TTL_MS)).toBe(ApprovalPresence.DEFAULT_TTL_MS)
      expect(ApprovalPresence.DEFAULT_TTL_MS).toBeLessThan(ApprovalPresence.MAX_TTL_MS)
    }),
  )
})
