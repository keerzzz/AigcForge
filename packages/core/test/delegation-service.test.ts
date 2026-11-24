import { describe, expect } from "bun:test"
import { asc, eq } from "drizzle-orm"
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Option } from "effect"
import { TestClock } from "effect/testing"
import { Bus } from "@omnixa/core/bus"
import { Database } from "@omnixa/core/database/database"
import { KV } from "@omnixa/core/kv"
import { AppNodeBuilder } from "@omnixa/core/effect/app-node-builder"
import { DelegationEvent } from "@omnixa/core/delegation/event"
import { DelegationProjector } from "@omnixa/core/delegation/projector"
import { DelegationPresentation } from "@omnixa/core/delegation/presentation"
import { DelegationService } from "@omnixa/core/delegation/service"
import { MetaAgentService } from "@omnixa/core/meta-agent/service"
import { MetaAgentTable, MetaAgentSessionTable } from "@omnixa/core/meta-agent/sql"
import { DelegationParticipantTable, DelegationTable, DelegationTurnTable } from "@omnixa/core/delegation/sql"
import { EventSequenceTable, EventTable } from "@omnixa/core/event/sql"
import { Project } from "@omnixa/core/project"
import { Agent } from "@omnixa/core/agent"
import { Location } from "@omnixa/core/location"
import { LocationServiceMap } from "@omnixa/core/location-service-map"
import { Model } from "@omnixa/core/model"
import { Provider } from "@omnixa/core/provider"
import { SessionComposition } from "@omnixa/core/session/composition"
import { ProjectTable } from "@omnixa/core/project/sql"
import { AbsolutePath } from "@omnixa/core/schema"
import { SessionTable } from "@omnixa/core/session/sql"
import { CliAdapter } from "@omnixa/core/tool/cli-adapter"
import { Delegation } from "@omnixa/schema/delegation"
import { DelegationID, ParticipantID } from "@omnixa/schema/delegation-id"
import { Event } from "@omnixa/schema/event"
import { Session } from "@omnixa/core/session"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { Global } from "@omnixa/util/global"
import { MetaAgent } from "@omnixa/schema/meta-agent"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels, useOfflineCatalog } from "./fixture/models"
import { withEnv } from "./fixture/env"
import { tmpdirScoped } from "./fixture/tmpdir"
import { awaitWithTimeout, testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, DelegationService.node, MetaAgentService.node, KV.node]),
    [Bus.node.replace(Bus.configured({ persist: true }))],
  ),
)
const metaIt = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      Project.node,
      Session.node,
      SessionComposition.node,
      MetaAgentService.node,
      LocationServiceMap.node,
      DelegationService.node,
    ]),
    [Global.node.replace(tempGlobalLayer), Bus.node.replace(Bus.configured({ persist: true })), offlineModels],
  ),
)
const metaForkFixture = Effect.gen(function* () {
  const directory = yield* tmpdirScoped()
  const location = Location.Ref.make({ directory: AbsolutePath.make(directory.path) })
  const metaModel = Model.Ref.make({
    providerID: Provider.ID.make("meta-fork-keeper"),
    id: Model.ID.make("meta"),
    variant: Model.VariantID.make("default"),
  })
  const workerModel = Model.Ref.make({
    providerID: Provider.ID.make("worker-fork-keeper"),
    id: Model.ID.make("worker"),
    variant: Model.VariantID.make("low"),
  })
  const reviewerModel = Model.Ref.make({
    providerID: workerModel.providerID,
    id: Model.ID.make("reviewer"),
    variant: Model.VariantID.make("high"),
  })
  const locations = yield* LocationServiceMap.Service
  yield* useOfflineCatalog(
    [metaModel.providerID, workerModel.providerID].map((providerID) => ({
      info: Provider.Info.make({
        ...Provider.Info.empty(providerID),
        activation: "enabled",
        package: "@omnixa/ai/providers/openai/responses",
      }),
      models: [metaModel, workerModel, reviewerModel]
        .filter((model) => model.providerID === providerID)
        .map((model) =>
          Model.Info.make({
            ...Model.Info.default(model.providerID, model.id),
            variants: [
              { id: Model.VariantID.make("default"), settings: {} },
              { id: Model.VariantID.make("low"), settings: { reasoningEffort: "low" } },
              { id: Model.VariantID.make("high"), settings: { reasoningEffort: "high" } },
            ],
          }),
        ),
    })),
  ).pipe(Effect.provide(locations.get(location)))
  const projects = yield* Project.Service
  yield* projects.resolve(location.directory)
  const sessions = yield* Session.Service
  const metas = yield* MetaAgentService.Service
  const service = yield* DelegationService.Service
  const database = yield* Database.Service
  const parent = yield* sessions.create({
    location,
    agent: Agent.ID.make("meta"),
    model: metaModel,
    executorPreference: new MetaAgent.ExecutorPreference({ agent: Agent.ID.make("build"), model: workerModel }),
  })
  if (parent.controller?.kind !== "root") return yield* Effect.die(new Error("Meta parent owner is missing"))
  yield* metas.assertOwner(parent)
  expect(parent.agent).toBe(Agent.ID.make("meta"))
  expect(parent.controller.rootSessionID).toBe(parent.id)
  const bindings = yield* Effect.gen(function* () {
    const agents = yield* Agent.Service
    const build = yield* agents.get(Agent.ID.make("build"))
    const explore = yield* agents.get(Agent.ID.make("explore"))
    if (!build || !explore) return yield* Effect.die(new Error("Meta fork agents are missing"))
    return [
      yield* Session.resolveExecutor(parent, build),
      yield* Session.resolveExecutor(parent, explore, reviewerModel),
    ]
  }).pipe(Effect.provide(locations.get(location)))
  expect(bindings).toEqual([
    new MetaAgent.ExecutorBinding({ agent: Agent.ID.make("build"), model: workerModel, source: "preference" }),
    new MetaAgent.ExecutorBinding({ agent: Agent.ID.make("explore"), model: reviewerModel, source: "tool" }),
  ])
  return {
    parent,
    sessions,
    metas,
    service,
    database,
    locations,
    location,
    metaModel,
    workerModel,
    reviewerModel,
    bindings,
  }
})

const itWithoutPersistence = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, DelegationService.node])),
)

const seedParent = Effect.fnUntraced(function* (parentID?: Session.ID) {
  const database = yield* Database.Service
  const id = parentID ?? Session.ID.create()
  yield* database.db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
  yield* database.db
    .insert(SessionTable)
    .values({
      id,
      project_id: Project.ID.global,
      slug: "delegation-service",
      directory: "/project",
      title: "Delegation owner",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
  return id
})

const setup = Effect.gen(function* () {
  const service = yield* DelegationService.Service
  const bus = yield* Bus.Service
  const database = yield* Database.Service
  const parentSessionID = yield* seedParent()
  const delegation = yield* service.create({ parentSessionID, title: "Build and review", metaAgentID: undefined })
  const implementer = yield* service.addParticipant({
    delegationID: delegation.id,
    provider: "internal",
    target: "build",
    role: "implementer",
    context: "fresh",
    childSessionID: undefined,
    externalThreadID: undefined,
  })
  const reviewer = yield* service.addParticipant({
    delegationID: delegation.id,
    provider: "codex",
    target: "review",
    role: "reviewer",
    context: "fresh",
  })
  const input = {
    delegationID: delegation.id,
    kind: "task" as const,
    participantIDs: [implementer.id, reviewer.id],
    delivery: "steer" as const,
    origin: { deliveryOrigin: "parent-task", senderParticipantID: implementer.id },
  }
  return { service, bus, database, parentSessionID, delegation, implementer, reviewer, input }
})

const storedEvents = Effect.fnUntraced(function* (delegationID: DelegationID.ID) {
  const database = yield* Database.Service
  return yield* database.db
    .select()
    .from(EventTable)
    .where(eq(EventTable.aggregate_id, delegationID))
    .orderBy(asc(EventTable.seq))
    .all()
})

// Pause at the real command's read/publish boundary. The forwarding Bus still
// uses production transactions, projectors, retained events and notifications.
const pausePublication = Effect.fnUntraced(function* (type: string) {
  const bus = yield* Bus.Service
  const started = yield* Deferred.make<void>()
  const overlapping = yield* Deferred.make<void>()
  const release = yield* Deferred.make<void>()
  const publications: string[] = []
  const publish: Bus.Interface["publish"] = (definition, data, options) =>
    Effect.gen(function* () {
      if (definition.type === type) {
        publications.push(definition.type)
        if (publications.length === 1) {
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(release)
        }
        if (publications.length === 2) yield* Deferred.succeed(overlapping, undefined)
      }
      return yield* bus.publish(definition, data, options)
    })
  const context = yield* Effect.context<Database.Service | Bus.Service | MetaAgentService.Service | KV.Service>()
  const services = yield* Layer.build(
    Layer.fresh(DelegationService.layer).pipe(
      Layer.provide(Layer.succeedContext(Context.add(context, Bus.Service, Bus.Service.of({ ...bus, publish })))),
    ),
  )
  yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
  return { service: Context.get(services, DelegationService.Service), started, overlapping, release, publications }
})

const retryableStatuses = ["failed", "cancelled", "recovery_required"] as const

describe("DelegationService retained Bus owner", () => {
  it.live("persists internally decoded optional fields and rebuilds the real projection", () =>
    Effect.gen(function* () {
      const seed = yield* setup
      const revisionDigest = Delegation.RevisionDigest.make(`rev_${"a".repeat(64)}`)
      const turn = yield* seed.service.appendTurn({
        ...seed.input,
        promptSummary: "safe summary",
        evidenceDigest: undefined,
        revisionDigest: undefined,
      })
      expect(seed.bus.retainsEvents).toBe(true)
      expect((yield* seed.service.foldState(seed.delegation.id))?.deliveries.size).toBe(2)
      yield* seed.service.recordDelivery({
        delegationID: seed.delegation.id,
        turnID: turn.id,
        participantID: seed.implementer.id,
        ...seed.input.origin,
        attempt: 1,
        status: "completed",
        externalTurnID: undefined,
        summary: "built",
      })
      yield* seed.service.recordDelivery({
        delegationID: seed.delegation.id,
        turnID: turn.id,
        participantID: seed.reviewer.id,
        ...seed.input.origin,
        attempt: 1,
        status: "completed",
      })
      yield* seed.service.recordRevision({
        delegationID: seed.delegation.id,
        turnID: turn.id,
        participantID: seed.implementer.id,
        commitSha: "sha-service",
        revisionDigest,
        changeKind: "rework",
        diffSummary: undefined,
      })
      yield* seed.service.recordReview({
        delegationID: seed.delegation.id,
        turnID: turn.id,
        participantID: seed.reviewer.id,
        reviewedRevisionDigest: revisionDigest,
        verdict: "approved",
        findings: [],
        summary: undefined,
      })

      const folded = yield* seed.service.foldState(seed.delegation.id)
      if (folded === undefined) return yield* Effect.fail(new Error("Created delegation must fold"))
      expect(folded.delegation.metaAgentID).toBeUndefined()
      expect(folded.delegation.latestRevisionDigest).toBe(revisionDigest)
      expect(folded.turns.get(turn.id)?.status).toBe("completed")
      expect([...folded.deliveries.values()].map((delivery) => delivery.status)).toEqual(["completed", "completed"])
      expect(folded.revisions).toHaveLength(1)
      expect(folded.reviews).toHaveLength(1)
      expect((yield* storedEvents(seed.delegation.id)).map((event) => event.type)).toEqual(
        [
          DelegationEvent.Created,
          DelegationEvent.ParticipantAdded,
          DelegationEvent.ParticipantAdded,
          DelegationEvent.TurnAdmitted,
          DelegationEvent.DeliveryAdmitted,
          DelegationEvent.DeliveryAdmitted,
          DelegationEvent.DeliveryCompleted,
          DelegationEvent.DeliveryCompleted,
          DelegationEvent.RevisionRecorded,
          DelegationEvent.ReviewApproved,
        ].map((definition) => Event.versionedType(definition.type, definition.durable.version)),
      )
      const before = yield* seed.database.db
        .select()
        .from(DelegationTable)
        .where(eq(DelegationTable.id, seed.delegation.id))
        .get()
      expect(before?.status).toBe(folded.delegation.status)
      expect(before?.latest_revision_digest).toBe(revisionDigest)
      expect(before?.meta_agent_id).toBeNull()
      expect(
        (yield* seed.database.db
          .select({ id: DelegationParticipantTable.id })
          .from(DelegationParticipantTable)
          .where(eq(DelegationParticipantTable.delegation_id, seed.delegation.id))
          .all()).map((participant) => participant.id),
      ).toEqual([seed.implementer.id, seed.reviewer.id])
      yield* seed.database.db
        .delete(DelegationTurnTable)
        .where(eq(DelegationTurnTable.delegation_id, seed.delegation.id))
        .run()
      yield* DelegationProjector.rebuild(seed.database.db, seed.delegation.id)
      expect(
        yield* seed.database.db.select().from(DelegationTable).where(eq(DelegationTable.id, seed.delegation.id)).get(),
      ).toEqual(before)
      expect(
        yield* seed.database.db
          .select({ id: DelegationTurnTable.id, status: DelegationTurnTable.status })
          .from(DelegationTurnTable)
          .where(eq(DelegationTurnTable.delegation_id, seed.delegation.id))
          .all(),
      ).toEqual([{ id: turn.id, status: "completed" }])
      expect(yield* storedEvents(seed.delegation.id)).toHaveLength(10)
      yield* awaitWithTimeout(
        seed.service.close({ delegationID: seed.delegation.id, reason: undefined }),
        "Delegation close did not finish",
      )
      expect((yield* seed.service.get(seed.delegation.id))?.status).toBe("closing")
      const closed = yield* storedEvents(seed.delegation.id)
      yield* seed.service.close({ delegationID: seed.delegation.id })
      expect(yield* storedEvents(seed.delegation.id)).toEqual(closed)
      expect(String(yield* seed.service.appendTurn(seed.input).pipe(Effect.exit))).toContain(
        "Cannot append a turn while delegation is closing",
      )
      expect(yield* storedEvents(seed.delegation.id)).toEqual(closed)
      yield* awaitWithTimeout(
        seed.service.complete({ delegationID: seed.delegation.id, summary: undefined }),
        "Delegation complete and archive did not finish",
      )
      expect((yield* seed.service.get(seed.delegation.id))?.status).toBe("archived")
      expect(yield* seed.service.list({ parentSessionID: seed.parentSessionID })).toEqual([])
      expect(
        (yield* seed.service.list({ parentSessionID: seed.parentSessionID, includeArchived: true })).map(
          (state) => state.delegation.id,
        ),
      ).toEqual([seed.delegation.id])
      const archived = yield* storedEvents(seed.delegation.id)
      const terminal = yield* seed.service.get(seed.delegation.id)
      yield* seed.service.complete({ delegationID: seed.delegation.id })
      expect(yield* storedEvents(seed.delegation.id)).toEqual(archived)
      yield* seed.service.unarchive({ delegationID: seed.delegation.id })
      expect(yield* seed.service.get(seed.delegation.id)).toMatchObject({
        status: "completed",
        completedAt: terminal?.completedAt,
        closedAt: terminal?.closedAt,
      })
      expect((yield* seed.service.get(seed.delegation.id))?.archivedAt).toBeUndefined()
      yield* awaitWithTimeout(
        seed.service.complete({ delegationID: seed.delegation.id }),
        "Already completed delegation archive did not finish",
      )
      expect((yield* seed.service.get(seed.delegation.id))?.status).toBe("archived")
      yield* seed.service.recordReview({
        delegationID: seed.delegation.id,
        turnID: turn.id,
        participantID: seed.reviewer.id,
        reviewedRevisionDigest: revisionDigest,
        verdict: "rejected",
        findings: [],
        summary: "Late review blocks completed visibility restoration",
      })
      const blocked = yield* storedEvents(seed.delegation.id)
      const exit = yield* seed.service.unarchive({ delegationID: seed.delegation.id }).pipe(Effect.exit)
      const error = Exit.isFailure(exit) ? Option.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
      expect(error).toBeInstanceOf(Delegation.DelegationBarrierNotMetError)
      expect((yield* seed.service.get(seed.delegation.id))?.status).toBe("archived")
      expect(yield* storedEvents(seed.delegation.id)).toEqual(blocked)
    }),
  )

  it.effect("restores cancelled visibility without changing deliveries or the review blocker", () =>
    Effect.gen(function* () {
      const seed = yield* setup
      const turn = yield* seed.service.appendTurn(seed.input)
      yield* Effect.forEach(seed.input.participantIDs, (participantID) =>
        seed.service.recordDelivery({
          delegationID: seed.delegation.id,
          turnID: turn.id,
          participantID,
          ...seed.input.origin,
          attempt: 1,
          status: "cancelled",
          summary: "cancelled before execution",
        }),
      )
      yield* seed.service.recordReview({
        delegationID: seed.delegation.id,
        turnID: turn.id,
        participantID: seed.reviewer.id,
        reviewedRevisionDigest: Delegation.RevisionDigest.make(`rev_${"c".repeat(64)}`),
        verdict: "rejected",
        findings: [],
        summary: "Cancellation does not erase review rejection",
      })
      yield* seed.bus.publish(DelegationEvent.Cancelled, {
        delegationID: seed.delegation.id,
        reason: "cancelled by owner",
        timestamp: 0,
      })
      yield* seed.service.archive({ delegationID: seed.delegation.id })
      const archived = yield* seed.service.foldState(seed.delegation.id)
      expect(archived?.delegation.status).toBe("archived")
      expect(archived?.archivedFrom).toBe("cancelled")
      expect(archived?.turns.get(turn.id)?.status).toBe("cancelled")
      expect([...(archived?.deliveries.values() ?? [])].map((delivery) => delivery.status)).toEqual([
        "cancelled",
        "cancelled",
      ])
      const snapshot = Effect.gen(function* () {
        return {
          delegation: yield* seed.database.db
            .select()
            .from(DelegationTable)
            .where(eq(DelegationTable.id, seed.delegation.id))
            .get(),
          participants: yield* seed.database.db
            .select()
            .from(DelegationParticipantTable)
            .where(eq(DelegationParticipantTable.delegation_id, seed.delegation.id))
            .orderBy(asc(DelegationParticipantTable.id))
            .all(),
          turns: yield* seed.database.db
            .select()
            .from(DelegationTurnTable)
            .where(eq(DelegationTurnTable.delegation_id, seed.delegation.id))
            .orderBy(asc(DelegationTurnTable.seq))
            .all(),
          events: yield* storedEvents(seed.delegation.id),
          sequence: yield* seed.database.db
            .select()
            .from(EventSequenceTable)
            .where(eq(EventSequenceTable.aggregate_id, seed.delegation.id))
            .get(),
        }
      })
      const before = yield* snapshot
      const observed: string[] = []
      const unsubscribe = yield* seed.bus.listen((event) =>
        Effect.sync(() => {
          if (event.durable?.aggregateID === seed.delegation.id) observed.push(event.type)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)

      yield* seed.service.unarchive({ delegationID: seed.delegation.id })
      const restored = yield* seed.service.foldState(seed.delegation.id)
      expect(restored?.delegation).toMatchObject({
        status: "cancelled",
        closedAt: archived?.delegation.closedAt,
        rejectionBlocked: true,
        rejectionReason: "Cancellation does not erase review rejection",
      })
      expect(restored?.delegation.completedAt).toBeUndefined()
      expect(restored?.delegation.archivedAt).toBeUndefined()
      expect(restored?.archivedFrom).toBeUndefined()
      expect(restored?.turns).toEqual(archived?.turns)
      expect(restored?.deliveries).toEqual(archived?.deliveries)
      expect(restored?.reviews).toEqual(archived?.reviews)
      const after = yield* snapshot
      expect(after.participants).toEqual(before.participants)
      expect(after.turns).toEqual(before.turns)
      expect(after.events.slice(0, -1)).toEqual(before.events)
      expect(after.events.at(-1)?.type).toBe(
        Event.versionedType(DelegationEvent.Unarchived.type, DelegationEvent.Unarchived.durable.version),
      )
      expect(Object.keys(after.events.at(-1)?.data ?? {}).sort()).toEqual(["delegationID", "timestamp"])
      expect(observed).toEqual([DelegationEvent.Unarchived.type])
      expect((yield* seed.service.list()).map((state) => state.delegation.id)).toEqual([seed.delegation.id])

      const exit = yield* seed.service.unarchive({ delegationID: seed.delegation.id }).pipe(Effect.exit)
      const error = Exit.isFailure(exit) ? Option.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
      expect(error).toBeInstanceOf(Delegation.DelegationInvalidStateError)
      expect(Exit.isFailure(exit) ? exit.cause.reasons.filter(Cause.isDieReason) : []).toEqual([])
      expect(yield* snapshot).toEqual(after)
      expect(observed).toEqual([DelegationEvent.Unarchived.type])
      const admission = yield* seed.service.appendTurn(seed.input).pipe(Effect.exit)
      expect(String(admission)).toContain("Cannot append a turn while delegation is cancelled")
      expect(yield* snapshot).toEqual(after)
    }),
  )

  it.live("serializes concurrent cancelled unarchive commands without publishing twice", () =>
    Effect.gen(function* () {
      const seed = yield* setup
      yield* seed.bus.publish(DelegationEvent.Cancelled, {
        delegationID: seed.delegation.id,
        reason: "Cancelled before admission",
        timestamp: 0,
      })
      yield* seed.service.archive({ delegationID: seed.delegation.id })
      const paused = yield* pausePublication(DelegationEvent.Unarchived.type)
      const scope = yield* Effect.scope
      const first = yield* paused.service
        .unarchive({ delegationID: seed.delegation.id })
        .pipe(Effect.exit, Effect.forkIn(scope, { startImmediately: true }))
      yield* awaitWithTimeout(Deferred.await(paused.started), "Unarchive did not reach its publication boundary")
      const second = yield* paused.service
        .unarchive({ delegationID: seed.delegation.id })
        .pipe(Effect.exit, Effect.forkIn(scope, { startImmediately: true }))
      yield* Deferred.succeed(paused.release, undefined)
      const exits = yield* awaitWithTimeout(
        Effect.all([Fiber.join(first), Fiber.join(second)]),
        "Concurrent unarchive commands did not finish",
      )
      expect(exits.filter(Exit.isSuccess)).toHaveLength(1)
      expect(exits.filter(Exit.isFailure)).toHaveLength(1)
      expect(paused.publications).toEqual([DelegationEvent.Unarchived.type])
      expect((yield* seed.service.get(seed.delegation.id))?.status).toBe("cancelled")
      expect(
        (yield* storedEvents(seed.delegation.id)).filter(
          (event) =>
            event.type ===
            Event.versionedType(DelegationEvent.Unarchived.type, DelegationEvent.Unarchived.durable.version),
        ),
      ).toHaveLength(1)
    }),
  )

  it.live("restores a cancelled archive after closing and reopening the real database", () =>
    Effect.gen(function* () {
      const graph = AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, DelegationService.node]), [
        Database.node.replace(Database.configured({ path: `${(yield* tmpdirScoped()).path}/delegation.db` })),
        Bus.node.replace(Bus.configured({ persist: true })),
      ])
      const archived = yield* Effect.gen(function* () {
        const seed = yield* setup
        const turn = yield* seed.service.appendTurn({
          ...seed.input,
          participantIDs: [seed.implementer.id],
          delivery: "queue",
        })
        yield* seed.service.recordDelivery({
          delegationID: seed.delegation.id,
          turnID: turn.id,
          participantID: seed.implementer.id,
          ...seed.input.origin,
          attempt: 1,
          status: "cancelled",
        })
        yield* seed.bus.publish(DelegationEvent.Cancelled, {
          delegationID: seed.delegation.id,
          reason: "Owner cancelled queued work",
          timestamp: 20,
        })
        yield* seed.service.archive({ delegationID: seed.delegation.id })
        const state = yield* seed.service.foldState(seed.delegation.id)
        if (state === undefined) return yield* Effect.fail(new Error("Archived delegation must exist"))
        return state
      }).pipe(Effect.scoped, Effect.provide(Layer.fresh(graph)))

      const restored = yield* Effect.gen(function* () {
        const service = yield* DelegationService.Service
        const database = yield* Database.Service
        expect(yield* service.foldState(archived.delegation.id)).toEqual(archived)
        yield* service.unarchive({ delegationID: archived.delegation.id })
        yield* DelegationProjector.rebuild(database.db, archived.delegation.id)
        const state = yield* service.foldState(archived.delegation.id)
        if (state === undefined) return yield* Effect.fail(new Error("Restored delegation must exist"))
        expect(state.delegation.status).toBe("cancelled")
        expect(state.delegation.closedAt).toBe(20)
        expect(state.delegation.completedAt).toBeUndefined()
        expect(state.delegation.archivedAt).toBeUndefined()
        expect(state.deliveries).toEqual(archived.deliveries)
        expect(
          yield* database.db.select().from(DelegationTable).where(eq(DelegationTable.id, archived.delegation.id)).get(),
        ).toMatchObject({ status: "cancelled", time_closed: 20, time_archived: null })
        return state
      }).pipe(Effect.scoped, Effect.provide(Layer.fresh(graph)))

      yield* Effect.gen(function* () {
        const service = yield* DelegationService.Service
        expect(yield* service.foldState(restored.delegation.id)).toEqual(restored)
        expect((yield* service.list()).map((state) => state.delegation.id)).toEqual([restored.delegation.id])
        expect((yield* storedEvents(restored.delegation.id)).at(-1)?.type).toBe(
          Event.versionedType(DelegationEvent.Unarchived.type, DelegationEvent.Unarchived.durable.version),
        )
      }).pipe(Effect.scoped, Effect.provide(Layer.fresh(graph)))
    }),
  )

  it.effect("rejects missing parents and conflicting create IDs without durable writes", () =>
    Effect.gen(function* () {
      const service = yield* DelegationService.Service
      const database = yield* Database.Service
      const delegationID = DelegationID.ID.create()
      const missing = yield* service
        .create({ delegationID, parentSessionID: Session.ID.create(), title: "Missing parent" })
        .pipe(Effect.exit)
      expect(String(missing)).toContain("DelegationParentSessionNotFoundError")
      expect(yield* storedEvents(delegationID)).toEqual([])
      expect(yield* database.db.select().from(DelegationTable).all()).toEqual([])
      expect(yield* database.db.select().from(EventSequenceTable).all()).toEqual([])

      const parentSessionID = yield* seedParent()
      yield* service.create({ delegationID, parentSessionID, title: "Original" })
      const conflict = yield* service.create({ delegationID, parentSessionID, title: "Changed" }).pipe(Effect.exit)
      expect(String(conflict)).toContain("DelegationInvalidStateError")
      expect((yield* service.get(delegationID))?.title).toBe("Original")
      expect(yield* storedEvents(delegationID)).toHaveLength(1)
    }),
  )

  itWithoutPersistence.effect("fails closed before creating without event retention", () =>
    Effect.gen(function* () {
      const service = yield* DelegationService.Service
      const database = yield* Database.Service
      const delegationID = DelegationID.ID.create()
      const parentSessionID = yield* seedParent()
      const exit = yield* service.create({ delegationID, parentSessionID, title: "Not retained" }).pipe(Effect.exit)
      expect(String(exit)).toContain("Persistent delegations require retained Bus events")
      expect(yield* storedEvents(delegationID)).toEqual([])
      expect(yield* database.db.select().from(DelegationTable).all()).toEqual([])
    }),
  )

  it.effect("commits every fanout delivery before the first Bus notification", () =>
    Effect.gen(function* () {
      const seed = yield* setup
      const observed: { type: string; deliveries: number; targets: readonly ParticipantID[] | undefined }[] = []
      const unsubscribe = yield* seed.bus.listen((event) => {
        if (event.durable?.aggregateID !== seed.delegation.id) return Effect.void
        return seed.service.foldState(seed.delegation.id).pipe(
          Effect.orDie,
          Effect.map((state) =>
            observed.push({
              type: event.type,
              deliveries: state?.deliveries.size ?? 0,
              targets: [...(state?.turns.values() ?? [])][0]?.participantIDs,
            }),
          ),
          Effect.asVoid,
        )
      })
      yield* Effect.addFinalizer(() => unsubscribe)
      const turn = yield* seed.service.appendTurn(seed.input)

      expect(observed).toEqual([
        { type: DelegationEvent.TurnAdmitted.type, deliveries: 2, targets: seed.input.participantIDs },
        { type: DelegationEvent.DeliveryAdmitted.type, deliveries: 2, targets: seed.input.participantIDs },
        { type: DelegationEvent.DeliveryAdmitted.type, deliveries: 2, targets: seed.input.participantIDs },
      ])
      expect((yield* storedEvents(seed.delegation.id)).map((event) => event.seq)).toEqual([0, 1, 2, 3, 4, 5])
      expect((yield* seed.service.listTurns(seed.delegation.id)).map((item) => item.id)).toEqual([turn.id])
    }),
  )

  it.effect("rolls back the entire fanout when a later real projector fails", () =>
    Effect.gen(function* () {
      const seed = yield* setup
      const observed: string[] = []
      const rejected = new Set([seed.reviewer.id])
      yield* seed.bus.project(DelegationEvent.DeliveryAdmitted, (event) =>
        rejected.has(event.data.participantID) ? Effect.die(new Error("later delivery projector failed")) : Effect.void,
      )
      const unsubscribe = yield* seed.bus.listen((event) =>
        Effect.sync(() => {
          if (event.durable?.aggregateID === seed.delegation.id) observed.push(event.type)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const exit = yield* seed.service.appendTurn(seed.input).pipe(Effect.exit)
      expect(String(exit)).toContain("later delivery projector failed")
      expect((yield* storedEvents(seed.delegation.id)).map((event) => event.seq)).toEqual([0, 1, 2])
      expect(yield* seed.service.listTurns(seed.delegation.id)).toEqual([])
      expect((yield* seed.service.foldState(seed.delegation.id))?.deliveries.size).toBe(0)
      expect((yield* seed.service.get(seed.delegation.id))?.status).toBe("draft")
      expect(
        yield* seed.database.db
          .select({ seq: EventSequenceTable.seq })
          .from(EventSequenceTable)
          .where(eq(EventSequenceTable.aggregate_id, seed.delegation.id))
          .get(),
      ).toEqual({ seq: 2 })
      expect(observed).toEqual([])
      rejected.clear()
      const retried = yield* seed.service.appendTurn(seed.input)
      expect(retried.seq).toBe(1)
      expect((yield* storedEvents(seed.delegation.id)).map((event) => event.seq)).toEqual([0, 1, 2, 3, 4, 5])
    }),
  )

  it.live("serializes concurrent turn sequence allocation while the first transaction is gated", () =>
    Effect.gen(function* () {
      const seed = yield* setup
      const scope = yield* Effect.scope
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const admitted: number[] = []
      yield* seed.bus.project(DelegationEvent.TurnAdmitted, (event) =>
        Effect.gen(function* () {
          admitted.push(event.data.seq)
          if (admitted.length !== 1) return
          yield* Deferred.succeed(started, undefined)
          yield* awaitWithTimeout(Deferred.await(release), "First admission gate was not released").pipe(Effect.orDie)
        }),
      )
      const first = yield* seed.service.appendTurn(seed.input).pipe(Effect.forkIn(scope, { startImmediately: true }))
      yield* awaitWithTimeout(Deferred.await(started), "First admission did not reach its projector")
      const second = yield* seed.service.appendTurn(seed.input).pipe(Effect.forkIn(scope, { startImmediately: true }))
      expect(admitted).toEqual([1])
      expect(second.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(release, undefined)
      const turns = yield* awaitWithTimeout(
        Effect.all([Fiber.join(first), Fiber.join(second)]),
        "Admissions did not finish",
      )
      expect(turns.map((turn) => turn.seq)).toEqual([1, 2])
      expect(admitted).toEqual([1, 2])
      expect((yield* seed.service.listTurns(seed.delegation.id)).map((turn) => turn.seq)).toEqual([1, 2])
      expect((yield* seed.service.foldState(seed.delegation.id))?.deliveries.size).toBe(4)
    }),
  )

  it.effect("rejects empty, duplicate, unknown target and unknown sender admissions atomically", () =>
    Effect.gen(function* () {
      const seed = yield* setup
      const unknown = ParticipantID.create()
      const invalid = [
        { ...seed.input, participantIDs: [] },
        { ...seed.input, participantIDs: [seed.implementer.id, seed.implementer.id] },
        { ...seed.input, participantIDs: [seed.implementer.id, unknown] },
        { ...seed.input, origin: { ...seed.input.origin, senderParticipantID: unknown } },
      ]
      const exits = yield* Effect.forEach(invalid, (input) => seed.service.appendTurn(input).pipe(Effect.exit))
      expect(exits.every(Exit.isFailure)).toBe(true)
      expect(String(exits[0])).toContain("unique participant")
      expect(String(exits[1])).toContain("unique participant")
      expect(String(exits[2])).toContain("DelegationParticipantNotFoundError")
      expect(String(exits[3])).toContain("DelegationParticipantNotFoundError")
      expect(yield* seed.service.listTurns(seed.delegation.id)).toEqual([])
      expect(yield* storedEvents(seed.delegation.id)).toHaveLength(3)
    }),
  )

  it.effect("uses the complete roster identity for repeated sequential admission", () =>
    Effect.gen(function* () {
      const seed = yield* setup
      const input = {
        delegationID: seed.delegation.id,
        provider: "internal",
        target: "build",
        role: "implementer" as const,
        context: "fresh" as const,
      }
      const repeated = yield* seed.service.addParticipant(input)
      expect(repeated.id).toBe(seed.implementer.id)
      expect(yield* storedEvents(seed.delegation.id)).toHaveLength(3)
      const variants = [
        { ...input, provider: "different" },
        { ...input, target: "different" },
        { ...input, role: "observer" as const },
        { ...input, context: "fork" as const },
        { ...input, externalThreadID: "different-thread" },
      ]
      const participants = yield* Effect.forEach(variants, (variant) => seed.service.addParticipant(variant))
      expect(new Set(participants.map((participant) => participant.id)).size).toBe(5)
      expect(participants.every((participant) => participant.id !== repeated.id)).toBe(true)
      expect((yield* seed.service.foldState(seed.delegation.id))?.participants.size).toBe(7)
    }),
  )

  it.live("coalesces concurrent roster admission with identical parameters", () =>
    Effect.gen(function* () {
      const seed = yield* setup
      const scope = yield* Effect.scope
      const start = yield* Deferred.make<void>()
      const input = {
        delegationID: seed.delegation.id,
        provider: "internal",
        target: "concurrent",
        role: "observer" as const,
        context: "fresh" as const,
      }
      const fibers = yield* Effect.forEach(Array.from({ length: 16 }), () =>
        Deferred.await(start).pipe(
          Effect.andThen(seed.service.addParticipant(input)),
          Effect.forkIn(scope, { startImmediately: true }),
        ),
      )
      yield* Deferred.succeed(start, undefined)
      const participants = yield* awaitWithTimeout(
        Effect.forEach(fibers, Fiber.join, { concurrency: "unbounded" }),
        "Concurrent roster admissions did not finish",
      )
      expect(new Set(participants.map((participant) => participant.id)).size).toBe(1)
      expect((yield* seed.service.foldState(seed.delegation.id))?.participants.size).toBe(3)
      expect(yield* storedEvents(seed.delegation.id)).toHaveLength(4)
    }),
  )

  it.live("prevents duplicate roster rows when a publication pauses after reading state", () =>
    Effect.gen(function* () {
      const seed = yield* setup
      const paused = yield* pausePublication(DelegationEvent.ParticipantAdded.type)
      const scope = yield* Effect.scope
      const input = {
        delegationID: seed.delegation.id,
        provider: "internal",
        target: "paused-roster",
        role: "observer" as const,
        context: "fresh" as const,
      }
      const first = yield* paused.service.addParticipant(input).pipe(Effect.forkIn(scope, { startImmediately: true }))
      yield* awaitWithTimeout(Deferred.await(paused.started), "Roster did not reach the publication boundary")
      const second = yield* paused.service.addParticipant(input).pipe(Effect.forkIn(scope, { startImmediately: true }))
      yield* Deferred.await(paused.overlapping).pipe(Effect.timeoutOption("200 millis"))
      yield* Deferred.succeed(paused.release, undefined)
      const participants = yield* awaitWithTimeout(
        Effect.all([Fiber.join(first), Fiber.join(second)]),
        "Paused roster admissions did not finish",
      )
      expect(paused.publications).toEqual([DelegationEvent.ParticipantAdded.type])
      expect((yield* seed.service.foldState(seed.delegation.id))?.participants.size).toBe(3)
      expect(yield* storedEvents(seed.delegation.id)).toHaveLength(4)
      expect(participants[0].id).toBe(participants[1].id)
    }),
  )

  it.live("continues writes to another delegation while the first delegation is locked", () =>
    Effect.gen(function* () {
      const seed = yield* setup
      const other = yield* seed.service.create({ parentSessionID: seed.parentSessionID, title: "Independent" })
      const paused = yield* pausePublication(DelegationEvent.ParticipantAdded.type)
      const scope = yield* Effect.scope
      const input = { provider: "internal", target: "parallel", role: "observer" as const, context: "fresh" as const }
      const first = yield* paused.service
        .addParticipant({ ...input, delegationID: seed.delegation.id })
        .pipe(Effect.forkIn(scope, { startImmediately: true }))
      yield* awaitWithTimeout(Deferred.await(paused.started), "First delegation did not acquire its mutation lock")
      const second = yield* awaitWithTimeout(
        paused.service.addParticipant({ ...input, delegationID: other.id }),
        "Another delegation was blocked by the first mutation lock",
      )
      expect(second.delegationID).toBe(other.id)
      expect(first.pollUnsafe()).toBeUndefined()
      expect((yield* seed.service.foldState(other.id))?.participants.size).toBe(1)
      yield* Deferred.succeed(paused.release, undefined)
      expect((yield* awaitWithTimeout(Fiber.join(first), "First delegation did not finish")).delegationID).toBe(
        seed.delegation.id,
      )
    }),
  )

  it.effect("preserves child ownership and immutable participant bindings", () =>
    Effect.gen(function* () {
      const seed = yield* setup
      const childID = Session.ID.create()
      const secondChildID = Session.ID.create()
      const foreignID = Session.ID.create()
      yield* seed.database.db
        .insert(SessionTable)
        .values(
          [childID, secondChildID, foreignID].map((id) => ({
            id,
            parent_id: id === foreignID ? Session.ID.create() : seed.parentSessionID,
            project_id: Project.ID.global,
            slug: "delegation-child",
            directory: "/project",
            title: "Child",
            version: "test",
          })),
        )
        .run()
      const foreign = yield* seed.service
        .addParticipant({
          delegationID: seed.delegation.id,
          provider: "internal",
          target: "foreign",
          role: "observer",
          context: "fresh",
          childSessionID: foreignID,
        })
        .pipe(Effect.exit)
      expect(String(foreign)).toContain("does not belong to parent session")
      yield* seed.service.bindParticipant({
        delegationID: seed.delegation.id,
        participantID: seed.implementer.id,
        childSessionID: childID,
      })
      yield* seed.service.bindParticipant({
        delegationID: seed.delegation.id,
        participantID: seed.reviewer.id,
        externalThreadID: "review-thread",
      })
      const before = yield* storedEvents(seed.delegation.id)
      yield* seed.service.bindParticipant({
        delegationID: seed.delegation.id,
        participantID: seed.implementer.id,
        childSessionID: childID,
      })
      yield* seed.service.bindParticipant({
        delegationID: seed.delegation.id,
        participantID: seed.reviewer.id,
        externalThreadID: "review-thread",
      })
      expect(yield* storedEvents(seed.delegation.id)).toEqual(before)
      const invalid = [
        { delegationID: seed.delegation.id, participantID: seed.implementer.id },
        { delegationID: seed.delegation.id, participantID: seed.implementer.id, childSessionID: secondChildID },
        { delegationID: seed.delegation.id, participantID: seed.reviewer.id, childSessionID: childID },
        { delegationID: seed.delegation.id, participantID: seed.reviewer.id, externalThreadID: "changed-thread" },
        { delegationID: seed.delegation.id, participantID: seed.implementer.id, externalThreadID: "review-thread" },
      ]
      const exits = yield* Effect.forEach(invalid, (input) => seed.service.bindParticipant(input).pipe(Effect.exit))
      expect(exits.every(Exit.isFailure)).toBe(true)
      expect(yield* storedEvents(seed.delegation.id)).toEqual(before)
      const participant = yield* seed.service.getParticipant({
        delegationID: seed.delegation.id,
        participantID: seed.implementer.id,
      })
      expect(participant.childSessionID).toBe(childID)
      expect(participant.externalThreadID).toBeUndefined()
      const other = yield* seed.service.create({ parentSessionID: seed.parentSessionID, title: "Second owner" })
      const stolen = yield* seed.service
        .addParticipant({
          delegationID: other.id,
          provider: "internal",
          target: "stolen",
          role: "observer",
          context: "fresh",
          childSessionID: childID,
        })
        .pipe(Effect.exit)
      expect(String(stolen)).toContain("does not belong to parent session")
      const bound = yield* seed.service.addParticipant({
        delegationID: seed.delegation.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
        childSessionID: childID,
      })
      const differentChild = yield* seed.service.addParticipant({
        delegationID: seed.delegation.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
        childSessionID: secondChildID,
      })
      expect(bound.id).toBe(seed.implementer.id)
      expect(differentChild.id).not.toBe(bound.id)
    }),
  )

  it.effect("enforces child and thread ownership across both participant admission paths", () =>
    Effect.gen(function* () {
      const seed = yield* setup
      const childSessionID = Session.ID.create()
      const movedChildSessionID = Session.ID.create()
      yield* seed.database.db
        .insert(SessionTable)
        .values(
          [childSessionID, movedChildSessionID].map((id) => ({
            id,
            parent_id: seed.parentSessionID,
            project_id: Project.ID.global,
            slug: "binding-owner",
            directory: id === childSessionID ? "/project" : "/other",
            title: "Binding child",
            version: "test",
          })),
        )
        .run()
      yield* seed.service.bindParticipant({
        delegationID: seed.delegation.id,
        participantID: seed.implementer.id,
        childSessionID,
      })
      yield* seed.service.bindParticipant({
        delegationID: seed.delegation.id,
        participantID: seed.reviewer.id,
        externalThreadID: "owned-thread",
      })
      const before = yield* storedEvents(seed.delegation.id)
      const results = yield* Effect.all([
        seed.service
          .addParticipant({
            delegationID: seed.delegation.id,
            provider: "internal",
            target: "second-owner",
            role: "observer",
            context: "fresh",
            childSessionID,
          })
          .pipe(Effect.exit),
        seed.service
          .addParticipant({
            delegationID: seed.delegation.id,
            provider: "codex",
            target: "second-thread-owner",
            role: "observer",
            context: "fresh",
            externalThreadID: "owned-thread",
          })
          .pipe(Effect.exit),
        seed.service
          .bindParticipant({
            delegationID: seed.delegation.id,
            participantID: seed.reviewer.id,
            childSessionID: movedChildSessionID,
          })
          .pipe(Effect.exit),
      ])
      expect(results.map((result) => result._tag === "Failure")).toEqual([true, true, true])
      expect(yield* storedEvents(seed.delegation.id)).toEqual(before)
    }),
  )

  it.effect("deduplicates evidence by complete delivery identity and an order independent participant set", () =>
    Effect.gen(function* () {
      const seed = yield* setup
      const input = {
        ...seed.input,
        kind: "evidence" as const,
        evidenceDigest: "evidence-digest",
        promptSummary: "first",
      }
      const first = yield* seed.service.appendTurn(input)
      const repeated = yield* seed.service.appendTurn({
        ...input,
        participantIDs: [seed.reviewer.id, seed.implementer.id],
        promptSummary: "changed summary",
        revisionDigest: Delegation.RevisionDigest.make(`rev_${"b".repeat(64)}`),
      })
      expect(repeated.id).toBe(first.id)
      expect(repeated.promptSummary).toBe("first")
      expect(yield* storedEvents(seed.delegation.id)).toHaveLength(6)
      const variants = [
        { ...input, evidenceDigest: "different-digest" },
        { ...input, kind: "task" as const },
        { ...input, delivery: "queue" as const },
        { ...input, participantIDs: [seed.implementer.id] },
        { ...input, origin: { ...input.origin, deliveryOrigin: "different-origin" } },
        { ...input, origin: { ...input.origin, senderParticipantID: seed.reviewer.id } },
      ]
      const distinct = yield* Effect.forEach(variants, (variant) => seed.service.appendTurn(variant))
      expect(new Set(distinct.map((turn) => turn.id)).size).toBe(6)
      expect(distinct.every((turn) => turn.id !== first.id)).toBe(true)
      expect((yield* seed.service.listTurns(seed.delegation.id)).map((turn) => turn.seq)).toEqual([1, 2, 3, 4, 5, 6, 7])
      const queued = distinct.find((turn) => turn.delivery === "queue")
      const state = yield* seed.service.foldState(seed.delegation.id)
      expect(
        [...(state?.deliveries.values() ?? [])]
          .filter((delivery) => delivery.turnID === queued?.id)
          .map((delivery) => delivery.status),
      ).toEqual(["queued", "queued"])
    }),
  )

  retryableStatuses.forEach((status) => {
    it.effect(`retries a ${status} delivery without changing its turn or origin`, () =>
      Effect.gen(function* () {
        const seed = yield* setup
        const turn = yield* seed.service.appendTurn({ ...seed.input, participantIDs: [seed.implementer.id] })
        const input = { delegationID: seed.delegation.id, turnID: turn.id, participantID: seed.implementer.id }
        yield* seed.service.recordDelivery({
          ...input,
          ...seed.input.origin,
          attempt: 1,
          status,
          summary: undefined,
          errorCode: undefined,
        })
        yield* seed.service.retry(input)
        const retried = yield* seed.service.foldState(seed.delegation.id)
        expect([...(retried?.deliveries.values() ?? [])]).toEqual([
          {
            turnID: turn.id,
            participantID: seed.implementer.id,
            ...seed.input.origin,
            attempt: 2,
            status: "admitted",
            updatedAt: 0,
          },
        ])
        expect(yield* seed.service.listTurns(seed.delegation.id)).toHaveLength(1)
        yield* seed.service.recordDelivery({ ...input, ...seed.input.origin, attempt: 2, status: "started" })
        expect((yield* seed.service.get(seed.delegation.id))?.status).toBe("running")
        if (status === "failed") {
          expect(
            (yield* seed.service.getParticipant({
              delegationID: input.delegationID,
              participantID: input.participantID,
            })).phase,
          ).toBe("active")
        }
        yield* seed.service.recordDelivery({ ...input, ...seed.input.origin, attempt: 2, status: "completed" })
        expect((yield* seed.service.listTurns(seed.delegation.id))[0]?.status).toBe("completed")
        const before = yield* storedEvents(seed.delegation.id)
        const completedRetry = yield* seed.service.retry(input).pipe(Effect.exit)
        expect(String(completedRetry)).toContain("Completed delivery requires a new Turn")
        expect(yield* storedEvents(seed.delegation.id)).toEqual(before)
      }),
    )
  })

  it.effect("rejects retry of admitted, running and queued deliveries without publishing", () =>
    Effect.gen(function* () {
      const seed = yield* setup
      const admitted = yield* seed.service.appendTurn({ ...seed.input, participantIDs: [seed.implementer.id] })
      const input = { delegationID: seed.delegation.id, turnID: admitted.id, participantID: seed.implementer.id }
      const before = yield* storedEvents(seed.delegation.id)
      expect(String(yield* seed.service.retry(input).pipe(Effect.exit))).toContain("Delivery is not retryable")
      expect(yield* storedEvents(seed.delegation.id)).toEqual(before)
      yield* seed.service.recordDelivery({ ...input, ...seed.input.origin, attempt: 1, status: "started" })
      const running = yield* storedEvents(seed.delegation.id)
      expect(String(yield* seed.service.retry(input).pipe(Effect.exit))).toContain("Delivery is not retryable")
      expect(yield* storedEvents(seed.delegation.id)).toEqual(running)
      const queued = yield* seed.service.appendTurn({
        ...seed.input,
        participantIDs: [seed.reviewer.id],
        delivery: "queue",
      })
      const pending = yield* storedEvents(seed.delegation.id)
      expect(
        String(
          yield* seed.service
            .retry({ delegationID: seed.delegation.id, turnID: queued.id, participantID: seed.reviewer.id })
            .pipe(Effect.exit),
        ),
      ).toContain("Delivery is not retryable")
      expect(yield* storedEvents(seed.delegation.id)).toEqual(pending)
    }),
  )

  it.effect("keeps recovery required until every interrupted delivery has left that state", () =>
    Effect.gen(function* () {
      const seed = yield* setup
      const turn = yield* seed.service.appendTurn(seed.input)
      const input = { delegationID: seed.delegation.id, turnID: turn.id, ...seed.input.origin, attempt: 1 }
      yield* Effect.forEach(seed.input.participantIDs, (participantID) =>
        seed.service.recordDelivery({ ...input, participantID, status: "recovery_required" }),
      )
      yield* seed.service.retry({
        delegationID: seed.delegation.id,
        turnID: turn.id,
        participantID: seed.implementer.id,
      })
      yield* seed.service.recordDelivery({
        ...input,
        participantID: seed.implementer.id,
        attempt: 2,
        status: "started",
      })
      expect((yield* seed.service.get(seed.delegation.id))?.status).toBe("recovery_required")
      expect((yield* seed.service.listTurns(seed.delegation.id))[0]?.status).toBe("recovery_required")
      yield* seed.service.retry({ delegationID: seed.delegation.id, turnID: turn.id, participantID: seed.reviewer.id })
      yield* seed.service.recordDelivery({ ...input, participantID: seed.reviewer.id, attempt: 2, status: "started" })
      expect((yield* seed.service.get(seed.delegation.id))?.status).toBe("running")
      expect((yield* seed.service.listTurns(seed.delegation.id))[0]?.status).toBe("running")
    }),
  )

  it.live("admits only one next attempt for concurrent retries of the same delivery", () =>
    Effect.gen(function* () {
      const seed = yield* setup
      const turn = yield* seed.service.appendTurn({ ...seed.input, participantIDs: [seed.implementer.id] })
      const input = { delegationID: seed.delegation.id, turnID: turn.id, participantID: seed.implementer.id }
      yield* seed.service.recordDelivery({ ...input, ...seed.input.origin, attempt: 1, status: "failed" })
      const scope = yield* Effect.scope
      const start = yield* Deferred.make<void>()
      const fibers = yield* Effect.forEach(Array.from({ length: 16 }), () =>
        Deferred.await(start).pipe(
          Effect.andThen(seed.service.retry(input)),
          Effect.exit,
          Effect.forkIn(scope, { startImmediately: true }),
        ),
      )
      yield* Deferred.succeed(start, undefined)
      const exits = yield* awaitWithTimeout(
        Effect.forEach(fibers, Fiber.join, { concurrency: "unbounded" }),
        "Concurrent retries did not finish",
      )
      expect(exits.filter(Exit.isSuccess)).toHaveLength(1)
      expect(exits.filter(Exit.isFailure)).toHaveLength(15)
      const admissions = (yield* storedEvents(seed.delegation.id)).filter(
        (event) =>
          event.type ===
          Event.versionedType(DelegationEvent.DeliveryAdmitted.type, DelegationEvent.DeliveryAdmitted.durable.version),
      )
      expect(admissions.map((event) => event.data.attempt)).toEqual([1, 2])
      expect((yield* seed.service.foldState(seed.delegation.id))?.deliveries.size).toBe(1)
    }),
  )

  it.live("prevents duplicate next attempts when a retry publication pauses after reading state", () =>
    Effect.gen(function* () {
      const seed = yield* setup
      const turn = yield* seed.service.appendTurn({ ...seed.input, participantIDs: [seed.implementer.id] })
      const input = { delegationID: seed.delegation.id, turnID: turn.id, participantID: seed.implementer.id }
      yield* seed.service.recordDelivery({ ...input, ...seed.input.origin, attempt: 1, status: "failed" })
      const paused = yield* pausePublication(DelegationEvent.DeliveryAdmitted.type)
      const scope = yield* Effect.scope
      const first = yield* paused.service
        .retry(input)
        .pipe(Effect.exit, Effect.forkIn(scope, { startImmediately: true }))
      yield* awaitWithTimeout(Deferred.await(paused.started), "Retry did not reach the publication boundary")
      const second = yield* paused.service
        .retry(input)
        .pipe(Effect.exit, Effect.forkIn(scope, { startImmediately: true }))
      yield* Deferred.await(paused.overlapping).pipe(Effect.timeoutOption("200 millis"))
      yield* Deferred.succeed(paused.release, undefined)
      const exits = yield* awaitWithTimeout(
        Effect.all([Fiber.join(first), Fiber.join(second)]),
        "Paused retries did not finish",
      )
      const admissions = (yield* storedEvents(seed.delegation.id)).filter(
        (event) =>
          event.type ===
          Event.versionedType(DelegationEvent.DeliveryAdmitted.type, DelegationEvent.DeliveryAdmitted.durable.version),
      )
      expect(admissions.map((event) => event.data.attempt)).toEqual([1, 2])
      expect(exits.filter(Exit.isSuccess)).toHaveLength(1)
      expect(exits.filter(Exit.isFailure)).toHaveLength(1)
      expect(paused.publications).toEqual([DelegationEvent.DeliveryAdmitted.type])
    }),
  )

  it.live("keeps unknown effects unresolved even when an adapter can continue its bound thread", () =>
    Effect.gen(function* () {
      const seed = yield* setup
      const adapterName = `delegation-service-${seed.delegation.id}`
      const callbacks: string[] = []
      CliAdapter.registerCliAdapter(adapterName, {
        name: adapterName,
        command: "fixture",
        description: "Bound thread capability fixture",
        detect: () => Effect.succeed(true),
        buildArgs: () => Effect.succeed([]),
        parseOutput: () => Effect.succeed({ status: "success", summary: "fixture" }),
        resumeThread: (threadId) =>
          Effect.sync(() => {
            callbacks.push(threadId)
            return { threadId }
          }),
      })
      // Registry has no delete API. Disable this unique entry at scope release
      // instead of changing another test's registered transport.
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          const adapter = CliAdapter.getCliAdapter(adapterName)
          if (adapter === undefined) return
          CliAdapter.registerCliAdapter(adapterName, { ...adapter, resumeThread: undefined })
        }),
      )
      const resumable = yield* seed.service.addParticipant({
        delegationID: seed.delegation.id,
        provider: adapterName,
        target: adapterName,
        role: "observer",
        context: "fresh",
        externalThreadID: "bound-thread",
      })
      const turn = yield* seed.service.appendTurn({
        ...seed.input,
        participantIDs: [seed.implementer.id, resumable.id],
      })
      yield* Effect.forEach([seed.implementer.id, resumable.id], (participantID) =>
        seed.service.recordDelivery({
          delegationID: seed.delegation.id,
          turnID: turn.id,
          participantID,
          ...seed.input.origin,
          attempt: 1,
          status: "recovery_required",
        }),
      )
      expect(
        yield* awaitWithTimeout(
          seed.service.reconcileResume({ delegationID: seed.delegation.id }),
          "Reconcile resume reentered the retry lock",
        ),
      ).toBe(0)
      const state = yield* seed.service.foldState(seed.delegation.id)
      expect(
        [...(state?.deliveries.values() ?? [])].map((delivery) => ({
          participantID: delivery.participantID,
          status: delivery.status,
          attempt: delivery.attempt,
        })),
      ).toEqual([
        { participantID: seed.implementer.id, status: "recovery_required", attempt: 1 },
        { participantID: resumable.id, status: "recovery_required", attempt: 1 },
      ])
      expect(yield* seed.service.reconcileResume({ delegationID: seed.delegation.id })).toBe(0)
      expect(callbacks).toEqual([])
      yield* seed.service.reconcile({ delegationID: seed.delegation.id })
      expect(
        [...((yield* seed.service.foldState(seed.delegation.id))?.deliveries.values() ?? [])].find(
          (delivery) => delivery.participantID === seed.implementer.id,
        )?.status,
      ).toBe("failed")
    }),
  )

  it.effect("forks a fresh roster without copying child bindings, external threads or turns", () =>
    Effect.gen(function* () {
      const seed = yield* setup
      const childSessionID = Session.ID.create()
      yield* seed.database.db
        .insert(SessionTable)
        .values({
          id: childSessionID,
          parent_id: seed.parentSessionID,
          project_id: Project.ID.global,
          slug: "fork-child",
          directory: "/project",
          title: "Bound child",
          version: "test",
        })
        .run()
      yield* seed.service.bindParticipant({
        delegationID: seed.delegation.id,
        participantID: seed.implementer.id,
        childSessionID,
      })
      yield* seed.service.bindParticipant({
        delegationID: seed.delegation.id,
        participantID: seed.reviewer.id,
        externalThreadID: "old-thread",
      })
      const originalTurn = yield* seed.service.appendTurn(seed.input)
      const forked = yield* seed.service.fork({ delegationID: seed.delegation.id, reason: undefined })
      expect(forked.delegation.id).not.toBe(seed.delegation.id)
      expect(forked.delegation.parentSessionID).toBe(seed.parentSessionID)
      expect(forked.delegation.metaAgentID).toBeUndefined()
      expect(forked.delegation.title).toBe("Build and review (fork)")
      expect(forked.delegation.status).toBe("draft")
      expect(forked.turns.size).toBe(0)
      expect(forked.deliveries.size).toBe(0)
      expect(forked.revisions).toEqual([])
      expect(forked.reviews).toEqual([])
      expect(
        [...forked.participants.values()].map((participant) => ({
          provider: participant.provider,
          target: participant.target,
          role: participant.role,
          context: participant.context,
          child: participant.childSessionID,
          thread: participant.externalThreadID,
        })),
      ).toEqual([
        {
          provider: "internal",
          target: "build",
          role: "implementer",
          context: "fork",
          child: undefined,
          thread: undefined,
        },
        { provider: "codex", target: "review", role: "reviewer", context: "fork", child: undefined, thread: undefined },
      ])
      expect([...forked.participants.keys()].every((id) => id !== seed.implementer.id && id !== seed.reviewer.id)).toBe(
        true,
      )
      expect((yield* seed.service.listTurns(seed.delegation.id)).map((turn) => turn.id)).toEqual([originalTurn.id])
      expect(
        (yield* seed.service.getParticipant({ delegationID: seed.delegation.id, participantID: seed.implementer.id }))
          .childSessionID,
      ).toBe(childSessionID)
      expect(
        (yield* seed.service.getParticipant({ delegationID: seed.delegation.id, participantID: seed.reviewer.id }))
          .externalThreadID,
      ).toBe("old-thread")
      const forkEvents = (yield* storedEvents(seed.delegation.id)).filter(
        (event) =>
          event.type === Event.versionedType(DelegationEvent.Forked.type, DelegationEvent.Forked.durable.version),
      )
      expect(forkEvents.map((event) => event.data.forkedDelegationID)).toEqual([forked.delegation.id])
    }),
  )

  metaIt.live("forks every Meta roster slot with first bindings and fresh runtime identities", () =>
    Effect.gen(function* () {
      const seed = yield* metaForkFixture
      if (seed.parent.controller?.kind !== "root") return yield* Effect.die(new Error("Meta parent owner is missing"))
      const delegation = yield* seed.service.create({ parentSessionID: seed.parent.id, title: "Meta fork source" })
      const participants = yield* Effect.forEach(seed.bindings, (executor, index) =>
        seed.service.addParticipant({
          delegationID: delegation.id,
          provider: "internal",
          target: executor.agent,
          role: index === 0 ? "implementer" : "reviewer",
          context: "fresh",
          executor,
        }),
      )
      const children = yield* Effect.forEach(participants, (participant, index) =>
        Effect.gen(function* () {
          const executor = seed.bindings[index]
          if (!executor) return yield* Effect.die(new Error("Meta fork binding is missing"))
          const child = yield* seed.sessions.create({
            parentID: seed.parent.id,
            agent: executor.agent,
            model: executor.model,
            executor,
            source: new MetaAgent.TaskControllerSource({
              kind: "task",
              delegationID: delegation.id,
              participantID: participant.id,
            }),
          })
          yield* seed.service.bindParticipant({
            delegationID: delegation.id,
            participantID: participant.id,
            childSessionID: child.id,
          })
          yield* seed.metas.assertOwner(child)
          return child
        }),
      )
      const highBinding = yield* Effect.gen(function* () {
        const agents = yield* Agent.Service
        const build = yield* agents.get(Agent.ID.make("build"))
        if (!build) return yield* Effect.die(new Error("Meta fork Build agent is missing"))
        return yield* Session.resolveExecutor(
          seed.parent,
          build,
          Model.Ref.make({ ...seed.workerModel, variant: Model.VariantID.make("high") }),
        )
      }).pipe(Effect.provide(seed.locations.get(seed.location)))
      const same = yield* seed.service.addParticipant({
        delegationID: delegation.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
        executor: seed.bindings[0],
      })
      const different = yield* seed.service.addParticipant({
        delegationID: delegation.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fork",
        executor: highBinding,
      })
      expect(same.id).not.toBe(participants[0]?.id)
      expect(different.id).not.toBe(same.id)
      const expectedBindings = [seed.bindings[0], seed.bindings[1], seed.bindings[0], highBinding]
      const implementer = participants[0]
      const reviewer = participants[1]
      if (!implementer || !reviewer) return yield* Effect.die(new Error("Meta fork roster is missing"))
      const origin = { deliveryOrigin: "meta-fork-keeper", senderParticipantID: implementer.id }
      const turn = yield* seed.service.appendTurn({
        delegationID: delegation.id,
        kind: "task",
        promptSummary: "Preserve the source history",
        participantIDs: participants.map((participant) => participant.id),
        delivery: "steer",
        origin,
      })
      yield* Effect.forEach(participants, (participant) =>
        seed.service.recordDelivery({
          delegationID: delegation.id,
          turnID: turn.id,
          participantID: participant.id,
          ...origin,
          attempt: 1,
          status: "completed",
        }),
      )
      const revisionDigest = Delegation.RevisionDigest.make("rev_" + "a".repeat(64))
      yield* seed.service.recordRevision({
        delegationID: delegation.id,
        turnID: turn.id,
        participantID: implementer.id,
        commitSha: "meta-fork-keeper",
        revisionDigest,
        changeKind: "rework",
      })
      yield* seed.service.recordReview({
        delegationID: delegation.id,
        turnID: turn.id,
        participantID: reviewer.id,
        reviewedRevisionDigest: revisionDigest,
        verdict: "approved",
        findings: [],
      })
      yield* seed.sessions.switchModel({
        sessionID: seed.parent.id,
        model: Model.Ref.make({ ...seed.metaModel, variant: Model.VariantID.make("high") }),
      })
      const selectedParent = yield* seed.sessions.selectExecutor({
        sessionID: seed.parent.id,
        executorPreference: new MetaAgent.ExecutorPreference({
          agent: Agent.ID.make("explore"),
          model: Model.Ref.make({ ...seed.reviewerModel, variant: Model.VariantID.make("low") }),
        }),
      })
      const original = yield* seed.service.foldState(delegation.id)
      if (!original) return yield* Effect.die(new Error("Meta source delegation is missing"))
      expect(original.turns.size).toBe(1)
      expect(original.deliveries.size).toBe(2)
      expect(original.revisions).toHaveLength(1)
      expect(original.reviews).toHaveLength(1)
      const originalEvents = yield* storedEvents(delegation.id)
      const originalParticipants = yield* seed.database.db
        .select()
        .from(DelegationParticipantTable)
        .where(eq(DelegationParticipantTable.delegation_id, delegation.id))
        .orderBy(asc(DelegationParticipantTable.id))
        .all()
      const originalSessions = yield* seed.database.db.select().from(SessionTable).orderBy(asc(SessionTable.id)).all()
      const originalMetas = yield* seed.database.db.select().from(MetaAgentTable).orderBy(asc(MetaAgentTable.id)).all()
      const originalOwners = yield* seed.database.db
        .select()
        .from(MetaAgentSessionTable)
        .orderBy(asc(MetaAgentSessionTable.meta_agent_id), asc(MetaAgentSessionTable.session_id))
        .all()
      expect(originalMetas).toHaveLength(1)
      expect(originalMetas[0]?.id).toBe(seed.parent.controller.metaAgentID)
      expect(originalOwners).toHaveLength(3)
      expect(originalOwners.find((owner) => owner.session_id === seed.parent.id)).toMatchObject({
        meta_agent_id: seed.parent.controller.metaAgentID,
        role: "orchestrator",
      })
      const beforeIDs = (yield* seed.service.list({ parentSessionID: seed.parent.id, includeArchived: true })).map(
        (state) => state.delegation.id,
      )
      const attempt = yield* seed.service
        .fork({ delegationID: delegation.id, title: "Meta fork destination" })
        .pipe(Effect.exit)
      const newDrafts = (yield* seed.service.list({ parentSessionID: seed.parent.id, includeArchived: true })).filter(
        (state) => !beforeIDs.includes(state.delegation.id),
      )
      const persisted = (yield* seed.database.db
        .select()
        .from(DelegationParticipantTable)
        .orderBy(asc(DelegationParticipantTable.target))
        .all()).filter((participant) => newDrafts.some((state) => state.delegation.id === participant.delegation_id))
      const error = Exit.isFailure(attempt) ? Cause.findErrorOption(attempt.cause) : Option.none()
      expect({
        status: Exit.isSuccess(attempt) ? "success" : "failure",
        error: Option.isSome(error) ? error.value._tag : undefined,
        newDrafts: newDrafts.length,
        persistedRoster: persisted.length,
      }).toEqual({ status: "success", error: undefined, newDrafts: 1, persistedRoster: 4 })
      if (Exit.isFailure(attempt)) return yield* Effect.failCause(attempt.cause)
      const forked = attempt.value
      expect(forked.delegation).toMatchObject({
        parentSessionID: seed.parent.id,
        metaAgentID: seed.parent.controller.metaAgentID,
        title: "Meta fork destination",
        status: "draft",
      })
      expect([...forked.participants.keys()].every((id) => !original.participants.has(id))).toBe(true)
      expect(
        [...forked.participants.values()].map((participant) => ({
          provider: participant.provider,
          target: participant.target,
          role: participant.role,
          context: participant.context,
          phase: participant.phase,
          executor: participant.executor,
          child: participant.childSessionID,
          thread: participant.externalThreadID,
          runtime: participant.runtimeStatus,
        })),
      ).toEqual([
        {
          provider: "internal",
          target: "build",
          role: "implementer",
          context: "fork",
          phase: "provisioning",
          executor: seed.bindings[0],
          child: undefined,
          thread: undefined,
          runtime: undefined,
        },
        {
          provider: "internal",
          target: "explore",
          role: "reviewer",
          context: "fork",
          phase: "provisioning",
          executor: seed.bindings[1],
          child: undefined,
          thread: undefined,
          runtime: undefined,
        },
        {
          provider: "internal",
          target: "build",
          role: "implementer",
          context: "fork",
          phase: "provisioning",
          executor: seed.bindings[0],
          child: undefined,
          thread: undefined,
          runtime: undefined,
        },
        {
          provider: "internal",
          target: "build",
          role: "implementer",
          context: "fork",
          phase: "provisioning",
          executor: highBinding,
          child: undefined,
          thread: undefined,
          runtime: undefined,
        },
      ])
      expect(persisted.map((participant) => participant.id).sort()).toEqual([...forked.participants.keys()].sort())
      expect(
        [...forked.participants.values()].map(
          (participant) => persisted.find((row) => row.id === participant.id)?.executor,
        ),
      ).toEqual(expectedBindings)
      expect(
        persisted.every(
          (participant) => participant.child_session_id === null && participant.external_thread_id === null,
        ),
      ).toBe(true)
      expect(forked.turns.size).toBe(0)
      expect(forked.deliveries.size).toBe(0)
      expect(forked.revisions).toEqual([])
      expect(forked.reviews).toEqual([])
      expect(forked.delegation.latestRevisionDigest).toBeUndefined()
      const destinationEvents = yield* storedEvents(forked.delegation.id)
      expect(destinationEvents.map((event) => event.type)).toEqual(
        [
          DelegationEvent.Created,
          DelegationEvent.ParticipantAdded,
          DelegationEvent.ParticipantAdded,
          DelegationEvent.ParticipantAdded,
          DelegationEvent.ParticipantAdded,
        ].map((definition) => Event.versionedType(definition.type, definition.durable.version)),
      )
      expect(destinationEvents.slice(1).map((event) => event.data.executor)).toEqual(expectedBindings)
      const sourceEvents = yield* storedEvents(delegation.id)
      expect(sourceEvents.slice(0, originalEvents.length)).toEqual(originalEvents)
      expect(sourceEvents).toHaveLength(originalEvents.length + 1)
      expect(sourceEvents.at(-1)).toMatchObject({
        type: Event.versionedType(DelegationEvent.Forked.type, DelegationEvent.Forked.durable.version),
        data: { forkedDelegationID: forked.delegation.id },
      })
      const retained = yield* seed.service.foldState(delegation.id)
      expect(retained?.participants).toEqual(original.participants)
      expect(retained?.turns).toEqual(original.turns)
      expect(retained?.deliveries).toEqual(original.deliveries)
      expect(retained?.revisions).toEqual(original.revisions)
      expect(retained?.reviews).toEqual(original.reviews)
      expect(
        yield* seed.database.db
          .select()
          .from(DelegationParticipantTable)
          .where(eq(DelegationParticipantTable.delegation_id, delegation.id))
          .orderBy(asc(DelegationParticipantTable.id))
          .all(),
      ).toEqual(originalParticipants)
      expect(yield* seed.sessions.get(seed.parent.id)).toEqual(selectedParent)
      expect(yield* Effect.forEach(children, (child) => seed.sessions.get(child.id))).toEqual(children)
      expect(yield* seed.database.db.select().from(SessionTable).orderBy(asc(SessionTable.id)).all()).toEqual(
        originalSessions,
      )
      expect(yield* seed.database.db.select().from(MetaAgentTable).orderBy(asc(MetaAgentTable.id)).all()).toEqual(
        originalMetas,
      )
      expect(
        yield* seed.database.db
          .select()
          .from(MetaAgentSessionTable)
          .orderBy(asc(MetaAgentSessionTable.meta_agent_id), asc(MetaAgentSessionTable.session_id))
          .all(),
      ).toEqual(originalOwners)
      const immutable = yield* seed.service
        .addParticipant({
          delegationID: forked.delegation.id,
          provider: "internal",
          target: "build",
          role: "implementer",
          context: "fork",
          executor: new MetaAgent.ExecutorBinding({
            agent: Agent.ID.make("build"),
            model: seed.reviewerModel,
            source: "tool",
          }),
        })
        .pipe(Effect.exit)
      const immutableError = Exit.isFailure(immutable) ? Cause.findErrorOption(immutable.cause) : Option.none()
      expect(Option.getOrUndefined(immutableError)).toBeInstanceOf(Delegation.DelegationInvalidStateError)
      expect(String(immutable)).toContain("Participant executor binding changed")
      expect(yield* storedEvents(forked.delegation.id)).toEqual(destinationEvents)
    }),
  )

  metaIt.live("rejects unsupported Meta fork rosters before any fork mutation", () =>
    Effect.gen(function* () {
      const seed = yield* metaForkFixture
      const bus = yield* Bus.Service
      for (const invalid of [
        { provider: "internal", target: "build", executor: undefined },
        { provider: "external", target: "build", executor: seed.bindings[0] },
        { provider: "internal", target: "explore", executor: seed.bindings[0] },
      ]) {
        const source = yield* seed.service.create({
          parentSessionID: seed.parent.id,
          title: "Invalid Meta fork source",
        })
        yield* bus.publish(DelegationEvent.ParticipantAdded, {
          delegationID: source.id,
          participantID: ParticipantID.create(),
          ...invalid,
          role: "implementer",
          context: "fresh",
          phase: "provisioning",
          timestamp: 1,
        })
        const snapshot = Effect.all({
          delegations: seed.database.db.select().from(DelegationTable).orderBy(asc(DelegationTable.id)).all(),
          participants: seed.database.db
            .select()
            .from(DelegationParticipantTable)
            .orderBy(asc(DelegationParticipantTable.id))
            .all(),
          events: seed.database.db.select().from(EventTable).orderBy(asc(EventTable.id)).all(),
          sequences: seed.database.db
            .select()
            .from(EventSequenceTable)
            .orderBy(asc(EventSequenceTable.aggregate_id))
            .all(),
          sessions: seed.database.db.select().from(SessionTable).orderBy(asc(SessionTable.id)).all(),
          metas: seed.database.db.select().from(MetaAgentTable).orderBy(asc(MetaAgentTable.id)).all(),
          owners: seed.database.db
            .select()
            .from(MetaAgentSessionTable)
            .orderBy(asc(MetaAgentSessionTable.meta_agent_id), asc(MetaAgentSessionTable.session_id))
            .all(),
        })
        const before = yield* snapshot
        const result = yield* seed.service.fork({ delegationID: source.id }).pipe(Effect.exit)
        const error = Exit.isFailure(result) ? Cause.findErrorOption(result.cause) : Option.none()
        expect(Option.getOrUndefined(error)).toBeInstanceOf(Delegation.DelegationInvalidStateError)
        expect(String(result)).toContain("Meta participant requires its first internal executor binding")
        expect(yield* snapshot).toEqual(before)
      }
    }),
  )

  it.effect("uses the same exact soft expiry threshold as the public presentation", () =>
    withEnv({ OMNIXA_DELEGATION_SOFT_EXPIRY_DAYS: "1" }, () =>
      Effect.gen(function* () {
        const seed = yield* setup
        yield* TestClock.adjust("23 hours")
        expect((yield* seed.service.resolveActive(seed.parentSessionID))?.delegation.id).toBe(seed.delegation.id)
        yield* TestClock.adjust("1 hour")
        const expired = yield* seed.service.foldState(seed.delegation.id)
        if (expired === undefined) return yield* Effect.fail(new Error("Expired delegation must remain auditable"))
        expect(DelegationPresentation.isSoftExpired(expired, 86_400_000)).toBe(true)
        expect(yield* seed.service.resolveActive(seed.parentSessionID)).toBeUndefined()
        expect((yield* seed.service.get(seed.delegation.id))?.status).toBe("draft")
        const fresh = yield* seed.service.resolve({ parentSessionID: seed.parentSessionID, title: "Fresh" })
        expect(fresh.delegation.id).not.toBe(seed.delegation.id)
        const explicit = yield* seed.service.resolve({
          parentSessionID: seed.parentSessionID,
          delegationID: seed.delegation.id,
          title: "Ignored",
        })
        expect(explicit.delegation.id).toBe(seed.delegation.id)
        expect(explicit.delegation.title).toBe("Build and review")
        expect(
          (yield* seed.service.list({ parentSessionID: seed.parentSessionID })).map((state) => state.delegation.id),
        ).toEqual([fresh.delegation.id, seed.delegation.id])
        const foreignParent = yield* seedParent()
        const wrongOwner = yield* seed.service
          .resolve({ parentSessionID: foreignParent, delegationID: seed.delegation.id, title: "Foreign" })
          .pipe(Effect.exit)
        expect(String(wrongOwner)).toContain("does not belong to parent session")
      }),
    ),
  )
})

metaIt.live("MC07 external governance admits implemented Meta roles and rejects cross-parent thread reuse", () =>
  Effect.gen(function* () {
    const f = yield* metaForkFixture
    const first = yield* f.service.create({ parentSessionID: f.parent.id, title: "External implementation" })
    const participant = yield* f.service.addParticipant({
      delegationID: first.id,
      provider: "codex",
      target: "codex",
      role: "implementer",
      context: "fresh",
    })
    yield* f.service.bindParticipant({
      delegationID: first.id,
      participantID: participant.id,
      externalThreadID: "mc06-owned-thread",
    })
    expect(participant.executor).toBeUndefined()
    const other = yield* f.sessions.create({
      location: f.location,
      agent: Agent.ID.make("build"),
      model: f.workerModel,
    })
    const second = yield* f.service.create({ parentSessionID: other.id, title: "Different parent" })
    const otherParticipant = yield* f.service.addParticipant({
      delegationID: second.id,
      provider: "codex",
      target: "codex",
      role: "implementer",
      context: "fresh",
    })
    const before = yield* f.service.foldState(second.id)
    expect(
      yield* f.service
        .bindParticipant({
          delegationID: second.id,
          participantID: otherParticipant.id,
          externalThreadID: "mc06-owned-thread",
        })
        .pipe(Effect.flip),
    ).toMatchObject({ _tag: "Delegation.DelegationInvalidStateError" })
    expect(yield* f.service.foldState(second.id)).toEqual(before)
    const reviewer = yield* f.service.addParticipant({
      delegationID: first.id,
      provider: "codex",
      target: "codex",
      role: "reviewer",
      context: "fresh",
    })
    expect(reviewer).toMatchObject({ provider: "codex", target: "codex", role: "reviewer" })
    expect(reviewer.childSessionID).toBeUndefined()
    expect(
      yield* f.service
        .addParticipant({
          delegationID: first.id,
          provider: "codex",
          target: "codex",
          role: "approver",
          context: "fresh",
        })
        .pipe(Effect.flip),
    ).toMatchObject({ _tag: "Delegation.DelegationInvalidStateError" })
    expect(
      yield* f.service
        .addParticipant({
          delegationID: first.id,
          provider: "codex",
          target: "codex",
          role: "implementer",
          context: "fork",
        })
        .pipe(Effect.flip),
    ).toMatchObject({ _tag: "Delegation.DelegationInvalidStateError" })
    expect((yield* f.sessions.list({ parentID: f.parent.id })).data).toEqual([])
  }),
)
