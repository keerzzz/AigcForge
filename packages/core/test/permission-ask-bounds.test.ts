import { describe, expect } from "bun:test"
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Option, Schema, Scope } from "effect"
import { eq } from "drizzle-orm"
import { AbsolutePath } from "@omnixa/core/schema"
import { Agent } from "@omnixa/core/agent"
import { ApprovalPresence } from "@omnixa/core/permission/approval-presence"
import { Database } from "@omnixa/core/database/database"
import { AppNodeBuilder } from "@omnixa/core/effect/app-node-builder"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { Bus } from "@omnixa/core/bus"
import { Location } from "@omnixa/core/location"
import { Project } from "@omnixa/core/project"
import { ProjectTable } from "@omnixa/core/project/sql"
import { SessionStore } from "@omnixa/core/session/store"
import { SessionComposition } from "@omnixa/core/session/composition"
import { SessionTable } from "@omnixa/core/session/sql"
import { Session } from "@omnixa/core/session"
import { PermissionSaved } from "@omnixa/core/permission/saved"
import { Permission } from "@omnixa/core/permission"
import { SessionTask } from "@omnixa/schema/session-task"
import { location } from "./fixture/location"
import { CompositionFixture } from "./lib/composition"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "./lib/effect"

// ADR-20 §2.7: an `ask` may only wait while a capable responder is attached,
// and never longer than the configured TTL. Both bounds fail typed and clear
// the pending request.

const current = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
)
const harness = (presence: Layer.Layer<ApprovalPresence.Service> = ApprovalPresence.defaultLayer) =>
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionStore.node,
      SessionComposition.node,
      PermissionSaved.node,
      Agent.node,
      ApprovalPresence.node,
      Permission.node,
    ]),
    [Location.node.replace(current), ApprovalPresence.node.replace(presence)],
  )
const it = testEffect(harness())

const setup = (rules: Permission.Ruleset) =>
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
        id: Session.ID.make("ses_ask_ttl"),
        project_id: Project.ID.global,
        slug: "ses_ask_ttl",
        directory: AbsolutePath.make("/project"),
        title: "ask ttl",
        version: "test",
        mode: "custom",
        agent: Agent.ID.make("test"),
        attended: null,
        time_created: Date.now(),
        time_updated: Date.now(),
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    const agents = yield* Agent.Service
    const info = Agent.Info.make({ ...Agent.Info.default(Agent.ID.make("test")), permissions: [...rules] })
    yield* agents.transform((editor) =>
      editor.update(Agent.ID.make("test"), (agent) => {
        Object.assign(agent, info)
      }),
    )
    yield* CompositionFixture.attach(Session.ID.make("ses_ask_ttl"), info)
    return Session.ID.make("ses_ask_ttl")
  })

describe("ApprovalPresence × ask bounds (ADR-20 §2.7)", () => {
  it.effect("rejects the ask immediately when no capable responder is attached", () =>
    Effect.gen(function* () {
      // No responder is bound for this runtime: the fact source reports zero.
      const sessionID = yield* setup([{ action: "bash", resource: "*", effect: "ask" }])
      const service = yield* Permission.Service

      const exit = yield* service
        .assert({ sessionID, action: "bash", resources: ["/tmp/run.sh"], agent: Agent.ID.make("test") })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        expect(error).toBeInstanceOf(Permission.RejectedError)
        if (error instanceof Permission.RejectedError) {
          expect(error.reason).toBe("no_responder")
          expect(error.message).toBe("No approval responder is available for this session")
        }
      }
      expect(yield* service.forSession(sessionID)).toHaveLength(0)
    }),
  )

  it.effect("rejects a custom execution ask immediately when only a legacy responder is attached", () =>
    Effect.gen(function* () {
      const presence = yield* ApprovalPresence.Service
      yield* presence.bindResponder({ custom: false })
      const sessionID = yield* setup([{ action: "bash", resource: "*", effect: "ask" }])
      const service = yield* Permission.Service

      const exit = yield* service
        .assert({ sessionID, action: "bash", resources: ["/tmp/run.sh"], agent: Agent.ID.make("test") })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      const error = Exit.isFailure(exit) ? Option.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
      expect(error).toBeInstanceOf(Permission.RejectedError)
      if (error instanceof Permission.RejectedError) expect(error.reason).toBe("no_responder")
      expect(yield* service.forSession(sessionID)).toHaveLength(0)
    }),
  )

  it.effect("publishes and resolves a custom ask when a capable responder is attached", () =>
    Effect.gen(function* () {
      const presence = yield* ApprovalPresence.Service
      yield* presence.bindResponder({ custom: true })
      const sessionID = yield* setup([{ action: "bash", resource: "*", effect: "ask" }])
      const service = yield* Permission.Service
      const bus = yield* Bus.Service
      const asked = yield* Deferred.make<Permission.Request>()
      const unsubscribe = yield* bus.listen((event) =>
        event.type === Permission.Event.Asked.type
          ? Deferred.succeed(asked, Schema.decodeUnknownSync(Permission.Request)(event.data)).pipe(Effect.asVoid)
          : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const fiber = yield* service
        .assert({ sessionID, action: "bash", resources: ["/tmp/run.sh"], agent: Agent.ID.make("test") })
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
      const service = yield* Permission.Service
      const bus = yield* Bus.Service
      const asked = yield* Deferred.make<Permission.Request>()
      const unsubscribe = yield* bus.listen((event) =>
        event.type === Permission.Event.Asked.type
          ? Deferred.succeed(asked, Schema.decodeUnknownSync(Permission.Request)(event.data)).pipe(Effect.asVoid)
          : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const fiber = yield* service
        .assert({ sessionID, action: "bash", resources: ["/tmp/run.sh"], agent: Agent.ID.make("test") })
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
      const service = yield* Permission.Service

      const exit = yield* service
        .assert({ sessionID, action: "bash", resources: ["/tmp/run.sh"], agent: Agent.ID.make("test") })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      const error = Exit.isFailure(exit) ? Option.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
      expect(error).toBeInstanceOf(Permission.RejectedError)
      if (error instanceof Permission.RejectedError) expect(error.reason).toBe("no_responder")
      expect(yield* service.forSession(sessionID)).toHaveLength(0)
    }),
  )

  it.live("interrupts a parked ask and clears its pending request before the TTL", () =>
    Effect.gen(function* () {
      const presence = yield* ApprovalPresence.Service
      yield* presence.bindResponder({ custom: true })
      const sessionID = yield* setup([{ action: "bash", resource: "*", effect: "ask" }])
      const service = yield* Permission.Service
      const bus = yield* Bus.Service
      const asked = yield* Deferred.make<Permission.Request>()
      const unsubscribe = yield* bus.listen((event) =>
        event.type === Permission.Event.Asked.type
          ? Deferred.succeed(asked, Schema.decodeUnknownSync(Permission.Request)(event.data)).pipe(Effect.asVoid)
          : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const fiber = yield* service
        .assert({ sessionID, action: "bash", resources: ["/tmp/run.sh"], agent: Agent.ID.make("test") })
        .pipe(Effect.forkScoped)
      const request = yield* awaitWithTimeout(Deferred.await(asked), "The approval never became pending")
      expect(yield* service.forSession(sessionID)).toEqual([request])
      yield* awaitWithTimeout(Fiber.interrupt(fiber), "The pending approval did not interrupt")
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
      expect(yield* service.forSession(sessionID)).toHaveLength(0)
    }),
  )

  // Short-TTL variant runs on its own runtime (real clock, 10ms bound).
  it.effect("still resolves through reply while inside the TTL window", () =>
    Effect.gen(function* () {
      const presence = yield* ApprovalPresence.Service
      yield* presence.bindResponder({ custom: true })
      const sessionID = yield* setup([{ action: "bash", resource: "*", effect: "ask" }])
      const service = yield* Permission.Service

      yield* service.ask({ sessionID, action: "bash", resources: ["/tmp/run.sh"], agent: Agent.ID.make("test") })
      const pending = yield* service.forSession(sessionID)
      expect(pending).toHaveLength(1)
      yield* service.reply({ requestID: pending[0]!.id, reply: "once" })
      expect(yield* service.forSession(sessionID)).toHaveLength(0)
    }),
  )
})

describe("Permission rejection ownership", () => {
  for (const scenario of [
    {
      title: "rejects one operation ask while its sibling and Tool asks remain answerable",
      selected: "operation-a",
      rejected: ["operation-a"],
      remaining: ["operation-b", "tool-a", "tool-b", "legacy"],
      message: undefined,
    },
    {
      title: "keeps correction feedback local to the rejected operation",
      selected: "operation-a",
      rejected: ["operation-a"],
      remaining: ["operation-b", "tool-a", "tool-b", "legacy"],
      message: "Revise only operation A.",
    },
    {
      title: "keeps the historical Tool rejection batch separate from operation asks",
      selected: "tool-a",
      rejected: ["tool-a", "tool-b", "legacy"],
      remaining: ["operation-a", "operation-b"],
      message: undefined,
    },
    {
      title: "keeps source-less correction batches compatible without correcting independent operations",
      selected: "legacy",
      rejected: ["legacy", "tool-a", "tool-b"],
      remaining: ["operation-a", "operation-b"],
      message: "Revise the current Tool batch.",
    },
  ] as const) {
    it.effect(scenario.title, () =>
      Effect.gen(function* () {
        const presence = yield* ApprovalPresence.Service
        yield* presence.bindResponder({ custom: true })
        const sessionID = yield* setup([{ action: "bash", resource: "*", effect: "ask" }])
        const service = yield* Permission.Service
        const bus = yield* Bus.Service
        const asks = [
          {
            key: "operation-a",
            source: new Permission.OperationSource({
              type: "operation",
              sessionID,
              operationID: SessionTask.OperationID.make("top_rejection_a"),
            }),
          },
          {
            key: "operation-b",
            source: new Permission.OperationSource({
              type: "operation",
              sessionID,
              operationID: SessionTask.OperationID.make("top_rejection_b"),
            }),
          },
          {
            key: "tool-a",
            source: Permission.ToolSource.make({ type: "tool", messageID: "legacy-message", id: "legacy/call-a" }),
          },
          {
            key: "tool-b",
            source: Permission.ToolSource.make({ type: "tool", messageID: "legacy-message", id: "legacy/call-b" }),
          },
          { key: "legacy", source: undefined },
        ]
        const ready = yield* Deferred.make<void>()
        const asked = new Set<Permission.ID>()
        const replied = new Array<Permission.ID>()
        const unsubscribe = yield* bus.listen((event) =>
          Effect.gen(function* () {
            if (event.type === Permission.Event.Replied.type) {
              const reply = Schema.decodeUnknownSync(Permission.Event.Replied.data)(event.data)
              if (reply.sessionID === sessionID) replied.push(reply.requestID)
              return
            }
            if (event.type !== Permission.Event.Asked.type) return
            const request = Schema.decodeUnknownSync(Permission.Request)(event.data)
            if (request.sessionID !== sessionID) return
            asked.add(request.id)
            if (asked.size === asks.length) yield* Deferred.succeed(ready, undefined)
          }),
        )
        yield* Effect.addFinalizer(() => unsubscribe)
        const pending = yield* Effect.forEach(asks, (ask) =>
          Effect.gen(function* () {
            const id = Permission.ID.make("per_ask_ownership_" + ask.key)
            const fiber = yield* service
              .assert({
                id,
                sessionID,
                action: "bash",
                resources: ["/tmp/run.sh"],
                agent: Agent.ID.make("test"),
                ...(ask.source ? { source: ask.source } : {}),
              })
              .pipe(Effect.exit, Effect.forkScoped)
            return { key: ask.key, id, fiber }
          }),
        )
        yield* awaitWithTimeout(Deferred.await(ready), "The approval group did not become pending")
        expect(yield* service.forSession(sessionID)).toHaveLength(asks.length)
        yield* service.reply({
          requestID: Permission.ID.make("per_ask_ownership_" + scenario.selected),
          reply: "reject",
          ...(scenario.message ? { message: scenario.message } : {}),
        })
        yield* Effect.forEach(
          pending.filter((item) => scenario.rejected.some((key) => key === item.key)),
          (item) =>
            Effect.gen(function* () {
              const exit = yield* awaitWithTimeout(Fiber.join(item.fiber), "The rejected approval did not finish")
              expect(Exit.isFailure(exit)).toBe(true)
              const failure = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
              expect(failure).toBeInstanceOf(scenario.message ? Permission.CorrectedError : Permission.DeclinedError)
              if (failure instanceof Permission.CorrectedError && scenario.message !== undefined)
                expect(failure.feedback).toBe(scenario.message)
            }),
        )
        expect(replied.toSorted()).toEqual(
          scenario.rejected.map((key) => Permission.ID.make("per_ask_ownership_" + key)).toSorted(),
        )
        expect((yield* service.forSession(sessionID)).map((request) => request.id).toSorted()).toEqual(
          scenario.remaining.map((key) => Permission.ID.make("per_ask_ownership_" + key)).toSorted(),
        )
        yield* Effect.forEach(
          pending.filter((item) => scenario.remaining.some((key) => key === item.key)),
          (item) =>
            Effect.gen(function* () {
              yield* service.reply({ requestID: item.id, reply: "once" })
              const exit = yield* awaitWithTimeout(Fiber.join(item.fiber), "The retained approval did not resolve")
              expect(Exit.isSuccess(exit)).toBe(true)
            }),
        )
        expect(yield* service.forSession(sessionID)).toEqual([])
      }),
    )
  }
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
      const service = yield* Permission.Service

      const verdict = yield* service.ask({
        sessionID,
        action: "bash",
        resources: ["/tmp/run.sh"],
        agent: Agent.ID.make("test"),
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
      const service = yield* Permission.Service

      yield* service.assert({
        sessionID,
        action: "read",
        resources: ["src/index.ts"],
        agent: Agent.ID.make("test"),
      })
      expect(yield* service.forSession(sessionID)).toHaveLength(0)
    }),
  )

  it.effect("a rewritten allow is denied with no prompt when nothing can answer", () =>
    Effect.gen(function* () {
      const sessionID = yield* setup([{ action: "bash", resource: "*", effect: "allow" }])
      const service = yield* Permission.Service

      const exit = yield* service
        .assert({ sessionID, action: "bash", resources: ["/tmp/run.sh"], agent: Agent.ID.make("test") })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = Cause.squash(exit.cause)
        expect(failure instanceof Permission.RejectedError).toBe(true)
        if (failure instanceof Permission.RejectedError) expect(failure.reason).toBe("no_responder")
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
 * `permission.replied`; this finalizer publishes nothing, so a shutdown-
 * cancelled approval leaves no ledger entry at all. That asymmetry is pinned
 * here so it stays a deliberate choice rather than drifting silently.
 */
describe("Permission owner scope release (M3 Phase G §7.1)", () => {
  it.live("fails a parked ask when the owning scope closes, and records nothing for it", () =>
    Effect.gen(function* () {
      const replied: Array<string> = []
      const scope = yield* Scope.make()
      // An isolated pending map makes owner shutdown observable independently
      // of caller interruption: a missing release would expire with AskExpiredError.
      const context = yield* Layer.buildWithScope(Layer.fresh(harness(ApprovalPresence.make(5_000))), scope)

      const parked = yield* Effect.gen(function* () {
        const presence = yield* ApprovalPresence.Service
        yield* presence.bindResponder({ custom: true })
        const sessionID = yield* setup([{ action: "bash", resource: "*", effect: "ask" }])
        const service = yield* Permission.Service
        const bus = yield* Bus.Service
        const unsubscribe = yield* bus.listen((event) =>
          Effect.sync(() => {
            if (event.type === Permission.Event.Replied.type) replied.push(event.type)
          }),
        )
        yield* Effect.addFinalizer(() => unsubscribe)

        const fiber = yield* service
          .assert({ sessionID, action: "bash", resources: ["/tmp/run.sh"], agent: Agent.ID.make("test") })
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
      expect(error).toBeInstanceOf(Permission.RejectedError)
      if (error instanceof Permission.RejectedError) {
        expect(error.reason).toBeUndefined()
        expect(error.message).toBe("Approval request was withdrawn because its owner closed")
      }
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
      const service = yield* Permission.Service

      const exit = yield* service
        .assert({ sessionID, action: "bash", resources: ["/tmp/run.sh"], agent: Agent.ID.make("test") })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause) instanceof Permission.AskExpiredError).toBe(true)
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
