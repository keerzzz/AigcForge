import path from "node:path"
import { expect } from "bun:test"
import { Omnixa } from "@omnixa/client"
import { LanguageModel, LLMClient } from "../../ai/src"
import { OpenAIChat } from "../../ai/src/protocols"
import { TestLLM } from "../../ai/src/testing"
import { Agent } from "@omnixa/core/agent"
import { Bus } from "@omnixa/core/bus"
import { Database } from "@omnixa/core/database/database"
import { DelegationService } from "@omnixa/core/delegation/service"
import { DelegationEvent } from "@omnixa/core/delegation/event"
import { DelegationParticipantTable, DelegationTable, DelegationTurnTable } from "@omnixa/core/delegation/sql"
import { EventSequenceTable, EventTable } from "@omnixa/core/event/sql"
import { LayerNodePlatform } from "@omnixa/core/effect/app-node-platform"
import { Location } from "@omnixa/core/location"
import { LocationServiceMap } from "@omnixa/core/location-service-map"
import { Model } from "@omnixa/core/model"
import { Job } from "@omnixa/core/job"
import { Plugin } from "@omnixa/core/plugin"
import { Provider } from "@omnixa/core/provider"
import { SessionRunnerModel } from "@omnixa/core/session/runner/model"
import { SessionInbox } from "@omnixa/core/session/inbox"
import { SessionInboxTable, SessionMessageTable, SessionTable } from "@omnixa/core/session/sql"
import { Session } from "@omnixa/core/session"
import { DelegationExecution } from "@omnixa/core/delegation/execution"
import { LegacyDelegationState } from "@omnixa/protocol/groups/delegation"
import { Delegation } from "@omnixa/schema/delegation"
import { DelegationID, ParticipantID, TurnID } from "@omnixa/schema/delegation-id"
import { Event } from "@omnixa/schema/event"
import { AbsolutePath } from "@omnixa/schema/schema"
import { Context, DateTime, Effect, Layer, Option, Schema, Stream } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { withEnv } from "../../core/test/fixture/env"
import { createLegacySession } from "../../core/test/fixture/models"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { awaitWithTimeout, it } from "../../core/test/lib/effect"
import type { LayerNode } from "@omnixa/util/effect/layer-node"
import { createRoutes } from "../src/routes"
import type { ServerOptions } from "../src/options"

const boot = (directory: string, options: ServerOptions = {}, overrides: LayerNode.Replacements = []) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      createRoutes(
        {
          password: "secret",
          database: { path: ":memory:" },
          config: { directory: path.join(directory, "config"), project: false, content: "{}" },
          models: { fetch: false },
          fs: { filewatcher: false },
          ...options,
        },
        () => [],
        overrides,
      ).pipe(Layer.provide(HttpServer.layerServices)),
    )
    const handler = Context.get(context, HttpRouter.HttpRouter)
      .asHttpEffect()
      .pipe(HttpEffect.toWebHandlerWith(context))
    const request = (
      route: string,
      input: { body?: unknown; directory?: string; authenticated?: boolean; method?: string } = {},
    ) =>
      Effect.promise(() => {
        const url = new URL(route, "http://omnixa.local")
        url.searchParams.set("directory", input.directory ?? directory)
        return handler(
          new Request(url, {
            method: input.method ?? (input.body === undefined ? "GET" : "POST"),
            headers: {
              "content-type": "application/json",
              ...(input.authenticated === false ? {} : { authorization: `Basic ${btoa("omnixa:secret")}` }),
            },
            body: input.body === undefined ? undefined : JSON.stringify(input.body),
          }),
        )
      })
    // Historical rosters omit the CPU first binding; keep their parent identity legacy.
    // New root admission belongs to session-create.test.ts.
    const session = createLegacySession({
      location: Location.Ref.make({ directory: AbsolutePath.make(directory) }),
    }).pipe(
      Effect.provide(context),
      Effect.map((session) => session.id),
    )
    const api = Omnixa.make({
      baseUrl: "http://omnixa.local",
      headers: { authorization: `Basic ${btoa("omnixa:secret")}` },
      fetch: Object.assign((input: string | URL | Request, init?: RequestInit) => handler(new Request(input, init)), {
        preconnect: fetch.preconnect,
      }),
    })
    return { request, session, context, handler, api, directory }
  })

const state = (response: Response) =>
  Effect.gen(function* () {
    if (response.status !== 200) throw new Error(yield* Effect.promise(() => response.clone().text()))
    expect(response.status).toBe(200)
    return Schema.decodeUnknownSync(LegacyDelegationState)(yield* Effect.promise(() => response.json()))
  })

const lifecycle = Effect.fnUntraced(function* (test: Effect.Success<ReturnType<typeof boot>>, parentID?: Session.ID) {
  const parentSessionID = parentID ?? (yield* test.session)
  const created = Schema.decodeUnknownSync(LegacyDelegationState)(
    yield* Effect.promise(() =>
      test.api.delegation.create({ parentSessionID, title: "HTTP lifecycle", directory: test.directory }),
    ),
  )
  const participants = yield* Effect.forEach(["implementer", "reviewer"] as const, (role) =>
    Effect.gen(function* () {
      return Schema.decodeUnknownSync(Delegation.ParticipantInfo)(
        yield* Effect.promise(() =>
          test.api.delegation.addParticipant({
            delegationID: created.delegation.id,
            provider: "internal",
            target: role,
            role,
            context: "fresh",
            directory: test.directory,
          }),
        ),
      )
    }),
  )
  const turn = Schema.decodeUnknownSync(Delegation.TurnInfo)(
    yield* Effect.promise(() =>
      test.api.delegation.appendTurn({
        delegationID: created.delegation.id,
        kind: "task",
        participantIDs: participants.map((participant) => participant.id),
        delivery: "steer",
        deliveryOrigin: "human",
        senderParticipantID: participants[0].id,
        directory: test.directory,
      }),
    ),
  )
  return {
    delegationID: created.delegation.id,
    parentSessionID,
    implementer: participants[0],
    reviewer: participants[1],
    turn,
    service: Context.get(test.context, DelegationService.Service),
  }
})

const recordReviewedWork = Effect.fnUntraced(function* (
  seed: Effect.Success<ReturnType<typeof lifecycle>>,
  verdict: DelegationService.RecordReviewInput["verdict"],
) {
  yield* Effect.forEach([seed.implementer.id, seed.reviewer.id], (participantID) =>
    seed.service.recordDelivery({
      delegationID: seed.delegationID,
      turnID: seed.turn.id,
      participantID,
      deliveryOrigin: "human",
      senderParticipantID: seed.implementer.id,
      attempt: 1,
      status: "completed",
      summary: "Work receipt",
    }),
  )
  const revisionDigest = Delegation.RevisionDigest.make(`rev_${"a".repeat(64)}`)
  yield* seed.service.recordRevision({
    delegationID: seed.delegationID,
    turnID: seed.turn.id,
    participantID: seed.implementer.id,
    commitSha: "http-lifecycle-revision",
    revisionDigest,
    changeKind: "rework",
  })
  yield* seed.service.recordReview({
    delegationID: seed.delegationID,
    turnID: seed.turn.id,
    participantID: seed.reviewer.id,
    reviewedRevisionDigest: revisionDigest,
    verdict,
    findings: [],
  })
})

const storedLifecycle = Effect.fnUntraced(function* (database: Database.Interface, delegationID: DelegationID.ID) {
  return {
    events: (yield* database.db.select().from(EventTable).all()).filter((row) => row.aggregate_id === delegationID),
    sequences: (yield* database.db.select().from(EventSequenceTable).all()).filter(
      (row) => row.aggregate_id === delegationID,
    ),
    delegations: (yield* database.db.select().from(DelegationTable).all()).filter((row) => row.id === delegationID),
    participants: (yield* database.db.select().from(DelegationParticipantTable).all()).filter(
      (row) => row.delegation_id === delegationID,
    ),
    turns: (yield* database.db.select().from(DelegationTurnTable).all()).filter(
      (row) => row.delegation_id === delegationID,
    ),
  }
})

const lifecycleOperations = (delegationID: DelegationID.ID, participantID: ParticipantID, turnID: TurnID) => {
  const root = `/delegation/${delegationID}`
  return [
    { route: `${root}/review/retract-rejection`, method: "POST", body: { participantID, reason: "Reconsider" } },
    { route: `${root}/complete`, method: "POST", body: {} },
    { route: `${root}/archive`, method: "POST", body: undefined },
    { route: `${root}/unarchive`, method: "POST", body: undefined },
    { route: `${root}/fork`, method: "POST", body: { reason: "Fresh attempt" } },
    ...["resume", "retry", "fork", "close"].map((decision) => ({
      route: `${root}/reconcile`,
      method: "POST",
      body: { decision, participantID, turnID },
    })),
    { route: `${root}?purge=true`, method: "DELETE", body: undefined },
  ]
}

it.live("serves delegation lifecycle close, complete, and archive through the generated client", () =>
  withEnv({ OMNIXA_EXPERIMENTAL_PERSISTENT_DELEGATIONS: "true" }, () =>
    Effect.gen(function* () {
      const directory = (yield* tmpdirScoped()).path
      const test = yield* boot(directory)
      const seed = yield* lifecycle(test)
      yield* recordReviewedWork(seed, "approved")
      const input = { delegationID: seed.delegationID, directory }
      const database = Context.get(test.context, Database.Service)
      const before = yield* storedLifecycle(database, seed.delegationID)
      expect((yield* test.request(`/delegation/${seed.delegationID}/complete`, { body: {} })).status).toBe(400)
      expect(yield* storedLifecycle(database, seed.delegationID)).toEqual(before)
      const closed = yield* Effect.promise(() => test.api.delegation.close({ ...input, reason: "Owner closed" }))
      expect(closed.delegation.status).toBe("closing")
      const completed = yield* Effect.promise(() => test.api.delegation.complete({ ...input, summary: "Verified" }))
      expect(completed.delegation.status).toBe("archived")
      expect(completed.turns).toMatchObject([{ id: seed.turn.id, status: "completed" }])
      const archivedRows = yield* storedLifecycle(database, seed.delegationID)
      expect(yield* Effect.promise(() => test.api.delegation.complete(input))).toEqual(completed)
      expect(yield* Effect.promise(() => test.api.delegation.archive(input))).toEqual(completed)
      expect(yield* storedLifecycle(database, seed.delegationID)).toEqual(archivedRows)
      expect(
        yield* Effect.promise(() => test.api.delegation.list({ parentSessionID: seed.parentSessionID, directory })),
      ).toEqual([])
      expect(yield* Effect.promise(() => test.api.delegation.unarchive(input))).toMatchObject({
        delegation: { id: seed.delegationID, status: "completed" },
      })
      expect(yield* Effect.promise(() => test.api.delegation.archive(input))).toMatchObject({
        delegation: { id: seed.delegationID, status: "archived" },
      })
      const rows = yield* database.db.select().from(EventTable).all()
      expect(rows.filter((row) => row.aggregate_id === seed.delegationID).map((row) => row.type)).toContain(
        Event.versionedType(DelegationEvent.Completed.type, DelegationEvent.Completed.durable.version),
      )
    }),
  ),
)

it.live("keeps rejection retraction distinct from approval and rejects an unmet completion barrier", () =>
  withEnv({ OMNIXA_EXPERIMENTAL_PERSISTENT_DELEGATIONS: "true" }, () =>
    Effect.gen(function* () {
      const directory = (yield* tmpdirScoped()).path
      const test = yield* boot(directory)
      const seed = yield* lifecycle(test)
      yield* recordReviewedWork(seed, "rejected")
      const root = `/delegation/${seed.delegationID}`
      const database = Context.get(test.context, Database.Service)
      const before = yield* storedLifecycle(database, seed.delegationID)
      const wrong = yield* test.request(`${root}/review/retract-rejection`, {
        body: { participantID: seed.implementer.id, reason: "Wrong reviewer" },
      })
      expect(wrong.status).toBe(400)
      expect(yield* storedLifecycle(database, seed.delegationID)).toEqual(before)
      const reviewsBefore = (yield* seed.service.foldState(seed.delegationID))?.reviews
      const retracted = yield* Effect.promise(() =>
        test.api.delegation.retractRejection({
          delegationID: seed.delegationID,
          participantID: seed.reviewer.id,
          reason: "Reconsider evidence",
          directory,
        }),
      )
      expect(retracted.delegation.rejectionBlocked).toBe(false)
      expect(retracted.delegation.status).not.toBe("approved")
      expect((yield* seed.service.foldState(seed.delegationID))?.reviews).toEqual(reviewsBefore)
      const closed = yield* Effect.promise(() =>
        test.api.delegation.close({ delegationID: seed.delegationID, directory }),
      )
      expect(closed.delegation.status).toBe("closing")
      const fenced = yield* storedLifecycle(database, seed.delegationID)
      const rejected = yield* test.request(`${root}/complete`, { body: { summary: "Not approved" } })
      expect(rejected.status).toBe(400)
      expect(yield* Effect.promise(() => rejected.json())).toMatchObject({
        message: "Delegation completion barrier is not satisfied",
      })
      expect(yield* storedLifecycle(database, seed.delegationID)).toEqual(fenced)
    }),
  ),
)

it.live("keeps resume reconciliation receipts unchanged and forks fresh rosters without executing work", () =>
  withEnv({ OMNIXA_EXPERIMENTAL_PERSISTENT_DELEGATIONS: "true" }, () =>
    Effect.gen(function* () {
      const directory = (yield* tmpdirScoped()).path
      const test = yield* boot(directory)
      const seed = yield* lifecycle(test)
      yield* seed.service.recordDelivery({
        delegationID: seed.delegationID,
        turnID: seed.turn.id,
        participantID: seed.implementer.id,
        deliveryOrigin: "human",
        senderParticipantID: seed.implementer.id,
        attempt: 1,
        status: "recovery_required",
        summary: "Unknown external effects",
      })
      const input = { delegationID: seed.delegationID, directory }
      const root = `/delegation/${seed.delegationID}`
      const database = Context.get(test.context, Database.Service)
      const before = yield* storedLifecycle(database, seed.delegationID)
      const folded = yield* seed.service.foldState(seed.delegationID)
      const presented = yield* Effect.promise(() => test.api.delegation.get(input))
      const resumed = yield* Effect.promise(() => test.api.delegation.reconcile({ ...input, decision: "resume" }))
      expect(resumed).toEqual(presented)
      expect(resumed.delegation.status).toBe("recovery_required")
      expect(yield* seed.service.foldState(seed.delegationID)).toEqual(folded)
      expect(yield* storedLifecycle(database, seed.delegationID)).toEqual(before)
      for (const body of [
        { decision: "retry" },
        { decision: "retry", participantID: seed.implementer.id },
        { decision: "retry", turnID: seed.turn.id },
        { decision: "retry", turnID: seed.turn.id, participantID: seed.implementer.id },
      ])
        expect((yield* test.request(`${root}/reconcile`, { body })).status).toBe(400)
      expect(yield* storedLifecycle(database, seed.delegationID)).toEqual(before)
      const forked = yield* Effect.promise(() =>
        test.api.delegation.fork({ ...input, title: "Fresh fork", reason: "Keep audit source" }),
      )
      expect(forked.delegation.id).not.toBe(seed.delegationID)
      expect(forked.delegation).toMatchObject({
        parentSessionID: seed.parentSessionID,
        title: "Fresh fork",
        status: "draft",
      })
      expect(forked.turns).toEqual([])
      expect(
        forked.participants.map((participant) => ({
          provider: participant.provider,
          target: participant.target,
          role: participant.role,
          context: participant.context,
        })),
      ).toEqual([
        { provider: seed.implementer.provider, target: seed.implementer.target, role: "implementer", context: "fork" },
        { provider: seed.reviewer.provider, target: seed.reviewer.target, role: "reviewer", context: "fork" },
      ])
      expect(
        forked.participants.every(
          (participant) =>
            participant.id !== seed.implementer.id &&
            participant.id !== seed.reviewer.id &&
            participant.childSessionID === undefined,
        ),
      ).toBe(true)
      const source = yield* seed.service.foldState(seed.delegationID)
      expect(source?.turns).toEqual(folded?.turns)
      expect(source?.deliveries).toEqual(folded?.deliveries)
      expect(source?.delegation.status).toBe("recovery_required")
      const reconciledFork = yield* Effect.promise(() => test.api.delegation.reconcile({ ...input, decision: "fork" }))
      expect(reconciledFork.delegation.id).not.toBe(seed.delegationID)
      expect(reconciledFork.delegation.id).not.toBe(forked.delegation.id)
      expect(reconciledFork.participants).toHaveLength(2)
      expect(reconciledFork.turns).toEqual([])
      const closed = yield* Effect.promise(() => test.api.delegation.reconcile({ ...input, decision: "close" }))
      expect(closed.delegation.status).toBe("closing")
      expect(closed.turns).toMatchObject([{ status: "cancelled" }])
      expect(yield* database.db.select().from(SessionInboxTable).all()).toEqual([])
      expect(yield* database.db.select().from(SessionMessageTable).all()).toEqual([])
    }),
  ),
)

it.live("rejects draft purge and restores cancelled archives without reopening execution", () =>
  withEnv({ OMNIXA_EXPERIMENTAL_PERSISTENT_DELEGATIONS: "true" }, () =>
    Effect.gen(function* () {
      const directory = (yield* tmpdirScoped()).path
      const test = yield* boot(directory)
      const parentSessionID = yield* test.session
      const draft = Schema.decodeUnknownSync(LegacyDelegationState)(
        yield* Effect.promise(() => test.api.delegation.create({ parentSessionID, title: "Draft", directory })),
      )
      const root = `/delegation/${draft.delegation.id}`
      const database = Context.get(test.context, Database.Service)
      const before = yield* storedLifecycle(database, draft.delegation.id)
      for (const operation of [
        { route: `${root}/close`, body: {} },
        { route: `${root}/reconcile`, body: { decision: "close" } },
        { route: `${root}?purge=true`, method: "DELETE" },
      ])
        expect(
          (yield* test.request(operation.route, { ...operation, method: operation.method ?? "POST" })).status,
        ).toBe(400)
      expect(yield* storedLifecycle(database, draft.delegation.id)).toEqual(before)
      const seed = yield* lifecycle(test)
      const bus = Context.get(test.context, Bus.Service)
      yield* Effect.forEach([seed.implementer.id, seed.reviewer.id], (participantID) =>
        seed.service.recordDelivery({
          delegationID: seed.delegationID,
          turnID: seed.turn.id,
          participantID,
          deliveryOrigin: "human",
          senderParticipantID: seed.implementer.id,
          attempt: 1,
          status: "cancelled",
        }),
      )
      yield* bus.publish(DelegationEvent.Cancelled, {
        delegationID: seed.delegationID,
        reason: "Owner cancelled",
        timestamp: (yield* DateTime.nowAsDate).getTime(),
      })
      const archived = yield* Effect.promise(() =>
        test.api.delegation.archive({ delegationID: seed.delegationID, directory }),
      )
      expect(archived.delegation.status).toBe("archived")
      const archivedRows = yield* storedLifecycle(database, seed.delegationID)
      const folded = yield* seed.service.foldState(seed.delegationID)
      const restored = yield* Effect.promise(() =>
        test.api.delegation.unarchive({ delegationID: seed.delegationID, directory }),
      )
      expect(restored.delegation.status).toBe("cancelled")
      expect(restored.turns).toEqual(archived.turns)
      expect(restored.participants).toEqual(archived.participants)
      expect((yield* seed.service.foldState(seed.delegationID))?.deliveries).toEqual(folded?.deliveries)
      const restoredRows = yield* storedLifecycle(database, seed.delegationID)
      expect(restoredRows.events).toHaveLength(archivedRows.events.length + 1)
      expect(restoredRows.turns).toEqual(archivedRows.turns)
      expect(restoredRows.participants).toEqual(archivedRows.participants)
      expect(
        yield* Effect.promise(() => test.api.delegation.get({ delegationID: seed.delegationID, directory })),
      ).toEqual(restored)
      expect((yield* test.request(`/delegation/${seed.delegationID}/unarchive`, { method: "POST" })).status).toBe(400)
      expect(yield* storedLifecycle(database, seed.delegationID)).toEqual(restoredRows)
    }),
  ),
)

it.live("serves durable delegation admission and queries through the production graph", () =>
  withEnv({ OMNIXA_EXPERIMENTAL_PERSISTENT_DELEGATIONS: "true" }, () =>
    Effect.gen(function* () {
      const directory = (yield* tmpdirScoped()).path
      const test = yield* boot(directory)
      expect(Context.get(test.context, Bus.Service).retainsEvents).toBe(true)
      const parentSessionID = yield* test.session
      const created = yield* state(
        yield* test.request("/delegation", { body: { parentSessionID, title: "Build and review" } }),
      )
      const root = `/delegation/${created.delegation.id}`
      const participants = yield* Effect.forEach(["implementer", "reviewer"] as const, (role) =>
        Effect.gen(function* () {
          const response = yield* test.request(`${root}/participant`, {
            body: { provider: "internal", target: role, role, context: "fresh" },
          })
          expect(response.status).toBe(200)
          return Schema.decodeUnknownSync(Delegation.ParticipantInfo)(yield* Effect.promise(() => response.json()))
        }),
      )
      const body = {
        kind: "task",
        participantIDs: participants.map((participant) => participant.id),
        delivery: "queue",
        deliveryOrigin: "meta",
        senderParticipantID: participants[0].id,
        evidenceDigest: "evidence-1",
        promptSummary: "safe summary",
      }
      const response = yield* test.request(`${root}/turn`, { body })
      expect(response.status).toBe(200)
      const turn = Schema.decodeUnknownSync(Delegation.TurnInfo)(yield* Effect.promise(() => response.json()))
      const repeated = yield* test.request(`${root}/turn`, {
        body: { ...body, participantIDs: [...body.participantIDs].reverse() },
      })
      expect(repeated.status).toBe(200)
      expect(Schema.decodeUnknownSync(Delegation.TurnInfo)(yield* Effect.promise(() => repeated.json())).id).toBe(
        turn.id,
      )
      const current = yield* state(yield* test.request(root))
      expect(current.participants).toHaveLength(2)
      expect(current.turns).toHaveLength(1)
      expect(current.turns[0].status).toBe("queued")
      const folded = yield* Context.get(test.context, DelegationService.Service).foldState(created.delegation.id)
      expect(folded?.deliveries.size).toBe(2)
      expect([...(folded?.deliveries.values() ?? [])].map((delivery) => delivery.status)).toEqual(["queued", "queued"])
      const rows = yield* Context.get(test.context, Database.Service).db.select().from(EventTable).all()
      expect(rows.filter((row) => row.aggregate_id === created.delegation.id)).toHaveLength(6)
      for (const participantIDs of [[], [participants[0].id, participants[0].id], [ParticipantID.create()]]) {
        const rejected = yield* test.request(`${root}/turn`, { body: { ...body, participantIDs } })
        expect(rejected.status).toBe(400)
      }
      expect((yield* state(yield* test.request(root))).turns).toEqual([turn])
      const turns = yield* test.request(`${root}/turn`)
      expect(turns.status).toBe(200)
      expect(
        Schema.decodeUnknownSync(Schema.Array(Delegation.TurnInfo))(yield* Effect.promise(() => turns.json())),
      ).toEqual([turn])
      expect((yield* state(yield* test.request(root))).turns).toEqual([turn])
      const listed = yield* test.request(`/delegation?parentSessionID=${parentSessionID}`)
      expect(listed.status).toBe(200)
      expect(
        Schema.decodeUnknownSync(Schema.Array(LegacyDelegationState))(yield* Effect.promise(() => listed.json())),
      ).toEqual([current])
      const pending = yield* test.request(`${root}/steer`, {
        body: { turnID: turn.id, participantID: participants[0].id },
      })
      expect(pending.status).toBe(400)
      expect(yield* Effect.promise(() => pending.json())).toMatchObject({
        message: "Delivery has no internal Session input",
      })
    }),
  ),
)

it.live(
  "executes full prompts and interrupts through the generated client and production Session owners",
  () =>
    withEnv({ OMNIXA_EXPERIMENTAL_PERSISTENT_DELEGATIONS: "true" }, () =>
      Effect.gen(function* () {
        const directory = (yield* tmpdirScoped()).path
        const llm = Context.get(yield* Layer.build(TestLLM.testLayer()), TestLLM.Test)
        const model = Model.Ref.make({ id: Model.ID.make("delegation"), providerID: Provider.ID.make("test") })
        const test = yield* boot(directory, {}, [
          LayerNodePlatform.llmClient.replace(Layer.succeed(LLMClient.Service, llm)),
          SessionRunnerModel.node.replace(
            Layer.succeed(SessionRunnerModel.Service, {
              resolve: () =>
                Effect.succeed(
                  SessionRunnerModel.resolved(
                    LanguageModel.make({ id: "delegation", provider: "test", route: OpenAIChat.route }),
                    {
                      capabilities: { tools: true, input: ["text"], output: ["text"] },
                      cost: [],
                      limit: { context: 200_000, output: 32_000 },
                    },
                  ),
                ),
            }),
          ),
        ])
        const api = test.api
        const parentSessionID = yield* test.session
        const sessions = Context.get(test.context, Session.Service)
        const parent = yield* sessions.get(parentSessionID)
        if (!parent) return yield* Effect.die(new Error("Parent missing"))
        const locations = Context.get(test.context, LocationServiceMap.Service)
        yield* Plugin.awaitActivation.pipe(Effect.provide(locations.get(parent.location)))
        const worker = Agent.ID.make("general")
        yield* Agent.Service.use((agents) =>
          agents.transform((editor) =>
            editor.update(worker, (agent) => {
              agent.mode = "subagent"
              agent.model = model
            }),
          ),
        ).pipe(Effect.provide(locations.get(parent.location)))
        const created = Schema.decodeUnknownSync(LegacyDelegationState)(
          yield* Effect.promise(() => api.delegation.create({ parentSessionID, title: "HTTP execution", directory })),
        )
        const participant = Schema.decodeUnknownSync(Delegation.ParticipantInfo)(
          yield* Effect.promise(() =>
            api.delegation.addParticipant({
              delegationID: created.delegation.id,
              provider: "internal",
              target: worker,
              role: "implementer",
              context: "fresh",
              directory,
            }),
          ),
        )
        const service = Context.get(test.context, DelegationService.Service)
        const bus = Context.get(test.context, Bus.Service)
        const wait = (turnID: string, status: string, delegationID = created.delegation.id) =>
          awaitWithTimeout(
            bus.log({ aggregateID: delegationID, follow: true }).pipe(
              Stream.mapEffect(() => service.foldState(delegationID)),
              Stream.map((state) =>
                [...(state?.deliveries.values() ?? [])].find(
                  (delivery) => delivery.turnID === turnID && delivery.status === status,
                ),
              ),
              Stream.filter((delivery) => delivery !== undefined),
              Stream.runHead,
              Effect.flatMap((result) =>
                Option.isSome(result) ? Effect.succeed(result.value) : Effect.die(new Error("Result missing")),
              ),
            ),
            `HTTP delivery did not become ${status}`,
            "10 seconds",
          )
        const input = {
          delegationID: created.delegation.id,
          directory,
          kind: "task" as const,
          participantIDs: [participant.id],
          delivery: "queue" as const,
          deliveryOrigin: "human",
          senderParticipantID: participant.id,
          promptSummary: "Public summary",
        }
        yield* llm.push(TestLLM.text("HTTP result", "http"))
        const full = "Full task text retained only in the Session"
        const turn = yield* Effect.promise(() =>
          api.delegation.appendTurn({ ...input, prompt: full, evidenceDigest: "http-full-prompt" }),
        )
        const receipt = yield* wait(turn.id, "completed")
        expect(receipt?.summary).toBe("HTTP result")
        expect(yield* llm.requests()).toHaveLength(1)
        const participantState = yield* service.getParticipant({
          delegationID: created.delegation.id,
          participantID: participant.id,
        })
        if (!participantState?.childSessionID) return yield* Effect.die(new Error("Child missing"))
        expect(
          (yield* sessions.context(participantState.childSessionID)).filter((message) => message.type === "user"),
        ).toMatchObject([{ text: full }])
        yield* sessions.wait(participantState.childSessionID)
        const database = Context.get(test.context, Database.Service)
        const readState = () =>
          Effect.all({
            lifecycle: storedLifecycle(database, created.delegation.id),
            events: database.db.select().from(EventTable).all(),
            sessions: database.db.select().from(SessionTable).all(),
            messages: database.db.select().from(SessionMessageTable).all(),
            inbox: database.db.select().from(SessionInboxTable).all(),
            requests: llm.requests(),
          })
        const beforeRead = yield* readState()
        const view = yield* Effect.promise(() => api.delegation.get({ delegationID: created.delegation.id, directory }))
        const delivery = view.deliveries?.find(
          (delivery) => delivery.turnID === turn.id && delivery.participantID === participant.id,
        )
        if (!delivery?.receipt)
          return yield* Effect.die(new Error("Generated client omitted the admitted delivery receipt"))
        expect(delivery).toMatchObject({
          provider: "internal",
          status: "completed",
          current: true,
          attempt: 1,
          receipt: { childSessionID: participantState.childSessionID },
        })
        expect(delivery.source).toBeUndefined()
        const resultInput = {
          delegationID: created.delegation.id,
          turnID: turn.id,
          participantID: participant.id,
          deliveryOrigin: "human",
          senderParticipantID: participant.id,
          attempt: 1,
          directory,
        }
        expect(yield* Effect.promise(() => api.delegation.result(resultInput))).toMatchObject({
          delivery: { receipt: delivery.receipt },
          available: true,
          text: "HTTP result",
        })
        expect(yield* Effect.promise(() => api.delegation.list({ parentSessionID, directory }))).toMatchObject([
          { deliveries: [delivery] },
        ])
        expect(yield* readState()).toEqual(beforeRead)
        const resultRoute = `/delegation/${created.delegation.id}/turn/${turn.id}/participant/${participant.id}/result?deliveryOrigin=human&senderParticipantID=${participant.id}&attempt=1`
        expect((yield* test.request(resultRoute, { authenticated: false })).status).toBe(401)
        expect((yield* test.request(resultRoute, { directory: (yield* tmpdirScoped()).path })).status).toBe(400)
        expect(
          (yield* test.request(`${resultRoute.slice(0, resultRoute.lastIndexOf("attempt="))}attempt=99`)).status,
        ).toBe(400)
        const repeated = yield* Effect.promise(() =>
          api.delegation.appendTurn({ ...input, prompt: "Ignored duplicate text", evidenceDigest: "http-full-prompt" }),
        )
        expect(repeated.id).toBe(turn.id)
        expect(yield* llm.requests()).toHaveLength(1)
        const rows = yield* database.db.select().from(EventTable).all()
        expect(JSON.stringify(rows.filter((row) => row.aggregate_id === created.delegation.id))).not.toContain(full)
        const gate = yield* llm.gate()
        yield* llm.push(TestLLM.hangAfter())
        const active = yield* Effect.promise(() =>
          api.delegation.appendTurn({ ...input, prompt: "Interrupt active work" }),
        )
        yield* awaitWithTimeout(gate.started, "HTTP model did not start")
        const root = `/delegation/${created.delegation.id}`
        const escaped = yield* test.request(`${root}/interrupt`, {
          directory: (yield* tmpdirScoped()).path,
          body: { participantID: participant.id },
        })
        expect(escaped.status).toBe(400)
        yield* Effect.promise(() =>
          api.delegation.interrupt({ delegationID: created.delegation.id, directory, participantID: participant.id }),
        )
        expect((yield* wait(active.id, "cancelled"))?.summary).toBe("Session interrupted")
        yield* gate.release
        yield* llm.push(TestLLM.text("HTTP retried result", "http-retry"))
        yield* Effect.promise(() =>
          api.delegation.retry({
            delegationID: created.delegation.id,
            turnID: active.id,
            participantID: participant.id,
            directory,
          }),
        )
        expect(yield* wait(active.id, "completed")).toMatchObject({ attempt: 2, summary: "HTTP retried result" })
        yield* sessions.wait(participantState.childSessionID)
        const retried = yield* Effect.promise(() =>
          api.delegation.get({ delegationID: created.delegation.id, directory }),
        )
        const attempts = retried.deliveries?.filter(
          (delivery) => delivery.turnID === active.id && delivery.participantID === participant.id,
        )
        expect(
          attempts?.map((delivery) => ({
            attempt: delivery.attempt,
            status: delivery.status,
            current: delivery.current,
          })),
        ).toEqual([
          { attempt: 1, status: "cancelled", current: false },
          { attempt: 2, status: "completed", current: true },
        ])
        expect(new Set(attempts?.map((delivery) => delivery.receipt?.inputID)).size).toBe(2)
        const afterRetry = yield* readState()
        expect(
          yield* Effect.promise(() => api.delegation.result({ ...resultInput, turnID: active.id, attempt: 2 })),
        ).toMatchObject({ available: true, text: "HTTP retried result", delivery: { attempt: 2, current: true } })
        expect(yield* readState()).toEqual(afterRetry)
        const closeGate = yield* llm.gate()
        yield* llm.push(TestLLM.hangAfter())
        const closingActive = yield* Effect.promise(() =>
          api.delegation.appendTurn({ ...input, prompt: "Close current work" }),
        )
        yield* awaitWithTimeout(closeGate.started, "Close model did not start")
        const closingQueued = yield* Effect.promise(() =>
          api.delegation.appendTurn({ ...input, prompt: "Queued before close" }),
        )
        yield* Effect.promise(() =>
          api.delegation.steer({
            delegationID: created.delegation.id,
            turnID: closingQueued.id,
            participantID: participant.id,
            directory,
          }),
        )
        expect(yield* sessions.inbox(participantState.childSessionID)).toMatchObject([{ delivery: "steer" }])
        const closed = yield* Effect.promise(() =>
          api.delegation.close({ delegationID: created.delegation.id, directory, reason: "HTTP owner closed" }),
        )
        expect(closed.delegation.status).toBe("closing")
        expect(yield* wait(closingActive.id, "cancelled")).toBeDefined()
        expect(yield* wait(closingQueued.id, "cancelled")).toBeDefined()
        expect(yield* SessionInbox.list(database.db, participantState.childSessionID)).toHaveLength(0)
        yield* Context.get(test.context, DelegationExecution.Service).interrupt({
          delegationID: created.delegation.id,
          participantID: ParticipantID.create(),
        })
        expect(yield* llm.requests()).toHaveLength(4)
        yield* closeGate.release
        const lifecycleCreated = Schema.decodeUnknownSync(LegacyDelegationState)(
          yield* Effect.promise(() =>
            api.delegation.create({
              parentSessionID,
              title: "Verified retry and purge",
              directory,
            }),
          ),
        )
        const lifecycleParticipant = Schema.decodeUnknownSync(Delegation.ParticipantInfo)(
          yield* Effect.promise(() =>
            api.delegation.addParticipant({
              delegationID: lifecycleCreated.delegation.id,
              provider: "internal",
              target: worker,
              role: "implementer",
              context: "fresh",
              directory,
            }),
          ),
        )
        const lifecycleInput = {
          ...input,
          delegationID: lifecycleCreated.delegation.id,
          participantIDs: [lifecycleParticipant.id],
          senderParticipantID: lifecycleParticipant.id,
        }
        const reconcileGate = yield* llm.gate()
        yield* llm.push(TestLLM.hangAfter())
        const retryTurn = yield* Effect.promise(() =>
          api.delegation.appendTurn({ ...lifecycleInput, prompt: "Verified original input" }),
        )
        yield* awaitWithTimeout(reconcileGate.started, "Reconcile attempt did not start")
        yield* Effect.promise(() =>
          api.delegation.interrupt({
            delegationID: lifecycleCreated.delegation.id,
            participantID: lifecycleParticipant.id,
            directory,
          }),
        )
        expect(yield* wait(retryTurn.id, "cancelled", lifecycleCreated.delegation.id)).toMatchObject({ attempt: 1 })
        yield* reconcileGate.release
        yield* llm.push(TestLLM.text("Reconciled result", "http-reconcile-retry"))
        yield* Effect.promise(() =>
          api.delegation.reconcile({
            delegationID: lifecycleCreated.delegation.id,
            turnID: retryTurn.id,
            participantID: lifecycleParticipant.id,
            decision: "retry",
            directory,
          }),
        )
        expect(yield* wait(retryTurn.id, "completed", lifecycleCreated.delegation.id)).toMatchObject({
          attempt: 2,
          summary: "Reconciled result",
        })
        const retryAdmissions = (yield* storedLifecycle(database, lifecycleCreated.delegation.id)).events.filter(
          (event) =>
            event.type ===
            Event.versionedType(
              DelegationEvent.DeliveryAdmitted.type,
              DelegationEvent.DeliveryAdmitted.durable.version,
            ),
        )
        expect(retryAdmissions.map((event) => event.data.attempt)).toEqual([1, 2])
        expect(yield* llm.requests()).toHaveLength(6)
        const child = yield* service.getParticipant({
          delegationID: lifecycleCreated.delegation.id,
          participantID: lifecycleParticipant.id,
        })
        if (!child.childSessionID) return yield* Effect.die(new Error("Lifecycle child missing"))
        const purgeGate = yield* llm.gate()
        yield* llm.push(TestLLM.hangAfter())
        const purgeActive = yield* Effect.promise(() =>
          api.delegation.appendTurn({ ...lifecycleInput, prompt: "Active until purge" }),
        )
        yield* awaitWithTimeout(purgeGate.started, "Purge model did not start")
        const purgeQueued = yield* Effect.promise(() =>
          api.delegation.appendTurn({ ...lifecycleInput, prompt: "Queued until purge" }),
        )
        expect((yield* sessions.active).has(child.childSessionID)).toBe(true)
        const pending = yield* sessions.inbox(child.childSessionID)
        expect(pending).toHaveLength(1)
        expect(yield* wait(purgeQueued.id, "queued", lifecycleCreated.delegation.id)).toMatchObject({ attempt: 1 })
        const beforePurge = yield* storedLifecycle(database, lifecycleCreated.delegation.id)
        const lifecycleRoot = `/delegation/${lifecycleCreated.delegation.id}`
        const rejectedPurge = yield* test.request(`${lifecycleRoot}?purge=false`, { method: "DELETE" })
        expect(rejectedPurge.status).toBe(400)
        expect(yield* Effect.promise(() => rejectedPurge.json())).toMatchObject({
          message: "Explicit purge is required to delete delegation",
        })
        expect(yield* storedLifecycle(database, lifecycleCreated.delegation.id)).toEqual(beforePurge)
        expect(yield* sessions.inbox(child.childSessionID)).toEqual(pending)
        expect((yield* sessions.active).has(child.childSessionID)).toBe(true)
        const jobs = Context.get(test.context, Job.Service)
        expect((yield* jobs.get(`delegation:${lifecycleParticipant.id}`))?.status).toBe("running")
        const historyBefore = yield* sessions.context(child.childSessionID)
        const purged = yield* Effect.promise(() =>
          api.delegation.delete({ delegationID: lifecycleCreated.delegation.id, purge: true, directory }),
        )
        expect(purged).toBeUndefined()
        expect(yield* service.foldState(lifecycleCreated.delegation.id)).toBeUndefined()
        expect(yield* storedLifecycle(database, lifecycleCreated.delegation.id)).toEqual({
          events: [],
          sequences: [],
          delegations: [],
          participants: [],
          turns: [],
        })
        expect(yield* sessions.inbox(child.childSessionID)).toEqual([])
        expect((yield* sessions.active).has(child.childSessionID)).toBe(false)
        expect(yield* jobs.get(`delegation:${lifecycleParticipant.id}`)).toBeUndefined()
        expect(
          (yield* jobs.pendingBackground).filter(
            (job) => job.recovery.kind === "delegation" && job.recovery.delegationID === lifecycleCreated.delegation.id,
          ),
        ).toEqual([])
        expect((yield* sessions.get(child.childSessionID)).id).toBe(child.childSessionID)
        expect(
          (yield* database.db.select().from(SessionTable).all()).find((row) => row.id === child.childSessionID)
            ?.time_suspended,
        ).toBeNull()
        const historyAfter = yield* sessions.context(child.childSessionID)
        expect(historyAfter.filter((message) => historyBefore.some((prior) => prior.id === message.id))).toMatchObject(
          historyBefore,
        )
        const interrupted = historyBefore
          .filter((message) => message.type === "assistant")
          .filter((message) => !message.time.completed)
        expect(interrupted).toHaveLength(1)
        const cancelled = historyAfter
          .filter((message) => message.type === "assistant")
          .find((message) => message.id === interrupted[0].id)
        expect(cancelled).toMatchObject({
          type: "assistant",
          finish: "error",
          error: { type: "aborted", message: "Step interrupted" },
          attempts: [{ terminal: { status: "cancelled" } }],
        })
        expect(cancelled?.time.completed).toBeDefined()
        expect(historyAfter.filter((message) => message.type === "user").map((message) => message.text)).toEqual([
          "Verified original input",
          "Verified original input",
          "Active until purge",
        ])
        expect(purgeActive.id).not.toBe(purgeQueued.id)
        yield* purgeGate.release
        expect(yield* llm.requests()).toHaveLength(7)
        return undefined
      }),
    ),
  30_000,
)

it.live("defaults to retained Bus and enforces explicit disabling and authentication before delegation writes", () =>
  Effect.gen(function* () {
    const directory = (yield* tmpdirScoped()).path
    for (const value of [undefined, "false"] as const) {
      const defaultBoot = yield* withEnv({ OMNIXA_EXPERIMENTAL_PERSISTENT_DELEGATIONS: value }, () => boot(directory))
      expect(Context.get(defaultBoot.context, Bus.Service).retainsEvents).toBe(value === undefined)
    }
    const test = yield* withEnv({ OMNIXA_EXPERIMENTAL_PERSISTENT_DELEGATIONS: "true" }, () =>
      boot(directory, { events: { persist: false } }),
    )
    expect(Context.get(test.context, Bus.Service).retainsEvents).toBe(false)
    const unauthorized = yield* test.request("/delegation", { authenticated: false })
    expect(unauthorized.status).toBe(401)
    const disabled = yield* withEnv({ OMNIXA_EXPERIMENTAL_PERSISTENT_DELEGATIONS: "false" }, () =>
      test.request("/delegation"),
    )
    expect(disabled.status).toBe(400)
    expect(yield* Effect.promise(() => disabled.json())).toMatchObject({ kind: "disabled" })
    const parentSessionID = yield* test.session
    const noRetention = yield* withEnv({ OMNIXA_EXPERIMENTAL_PERSISTENT_DELEGATIONS: "true" }, () =>
      test.request("/delegation", { body: { parentSessionID, title: "Must retain events" } }),
    )
    expect(noRetention.status).toBe(400)
    expect(yield* Effect.promise(() => noRetention.json())).toMatchObject({ kind: "persistence_required" })
    yield* Effect.forEach(
      lifecycleOperations(DelegationID.ID.create(), ParticipantID.create(), TurnID.create()),
      (operation) =>
        Effect.gen(function* () {
          expect((yield* test.request(operation.route, { ...operation, authenticated: false })).status).toBe(401)
          const disabled = yield* withEnv({ OMNIXA_EXPERIMENTAL_PERSISTENT_DELEGATIONS: "false" }, () =>
            test.request(operation.route, operation),
          )
          expect(disabled.status).toBe(400)
          expect(yield* Effect.promise(() => disabled.json())).toMatchObject({ kind: "disabled" })
          const noRetention = yield* withEnv({ OMNIXA_EXPERIMENTAL_PERSISTENT_DELEGATIONS: "true" }, () =>
            test.request(operation.route, operation),
          )
          expect(noRetention.status).toBe(400)
          expect(yield* Effect.promise(() => noRetention.json())).toMatchObject({ kind: "persistence_required" })
        }),
    )
    expect(yield* Context.get(test.context, Database.Service).db.select().from(EventTable).all()).toEqual([])
  }),
)

it.live("isolates delegation lists and mutations by canonical Session Location without double decoding", () =>
  withEnv({ OMNIXA_EXPERIMENTAL_PERSISTENT_DELEGATIONS: "true" }, () =>
    Effect.gen(function* () {
      const directory = (yield* tmpdirScoped("omnixa-%2F-delegation-")).path
      const other = (yield* tmpdirScoped()).path
      const test = yield* boot(directory)
      const parentSessionID = yield* test.session
      const created = yield* state(yield* test.request("/delegation", { body: { parentSessionID, title: "Owner" } }))
      const root = `/delegation/${created.delegation.id}`
      expect((yield* state(yield* test.request(root))).delegation.id).toBe(created.delegation.id)
      const list = yield* test.request("/delegation", { directory: other })
      expect(list.status).toBe(200)
      expect(yield* Effect.promise(() => list.json())).toEqual([])
      for (const route of [root, `/delegation?parentSessionID=${parentSessionID}`]) {
        expect((yield* test.request(route, { directory: other })).status).toBe(400)
      }
      const escaped = yield* test.request(`${root}/participant`, {
        directory: other,
        body: { provider: "internal", target: "build", role: "implementer", context: "fresh" },
      })
      expect(escaped.status).toBe(400)
      expect((yield* state(yield* test.request(root))).participants).toEqual([])
      const foreignParent = yield* test.request("/delegation", {
        directory: other,
        body: { parentSessionID, title: "Foreign" },
      })
      expect(foreignParent.status).toBe(400)
      const invalidTitle = yield* test.request("/delegation", { body: { parentSessionID, title: "" } })
      expect(invalidTitle.status).toBe(400)
    }),
  ),
)

it.live("serves delegation lifecycle for a stored directory alias and fences every mutation by Location", () =>
  withEnv({ OMNIXA_EXPERIMENTAL_PERSISTENT_DELEGATIONS: "true" }, () =>
    Effect.gen(function* () {
      const directory = (yield* tmpdirScoped("omnixa-%2F-lifecycle-")).path
      const alias = `${directory}${path.sep}.`
      const other = (yield* tmpdirScoped()).path
      const test = yield* boot(directory)
      const parentSessionID = (yield* createLegacySession({
        location: Location.Ref.make({ directory: AbsolutePath.make(alias) }),
      }).pipe(Effect.provide(test.context))).id
      expect(String((yield* Context.get(test.context, Session.Service).get(parentSessionID)).location.directory)).toBe(
        alias,
      )
      const seed = yield* lifecycle(test, parentSessionID)
      yield* recordReviewedWork(seed, "approved")
      const input = { delegationID: seed.delegationID, directory }
      const before = yield* Effect.promise(() => test.api.delegation.get(input))
      expect(yield* Effect.promise(() => test.api.delegation.get({ ...input, directory: alias }))).toEqual(before)
      expect(yield* Effect.promise(() => test.api.delegation.list({ parentSessionID, directory: alias }))).toEqual([
        before,
      ])
      const database = Context.get(test.context, Database.Service)
      const beforeRows = yield* storedLifecycle(database, seed.delegationID)
      const missing = DelegationID.ID.create()
      const operations = lifecycleOperations(seed.delegationID, seed.implementer.id, seed.turn.id)
      const missingOperations = lifecycleOperations(missing, seed.implementer.id, seed.turn.id)
      yield* Effect.forEach(operations, (operation, index) =>
        Effect.gen(function* () {
          expect((yield* test.request(operation.route, { ...operation, authenticated: false })).status).toBe(401)
          expect((yield* test.request(operation.route, { ...operation, directory: other })).status).toBe(400)
          expect((yield* test.request(missingOperations[index].route, missingOperations[index])).status).toBe(400)
        }),
      )
      expect(yield* storedLifecycle(database, seed.delegationID)).toEqual(beforeRows)
      expect(
        yield* Effect.promise(() => test.api.delegation.reconcile({ ...input, directory: alias, decision: "resume" })),
      ).toEqual(before)
      expect(yield* Effect.promise(() => test.api.delegation.close({ ...input, directory: alias }))).toMatchObject({
        delegation: { status: "closing" },
      })
      expect(yield* Effect.promise(() => test.api.delegation.complete(input))).toMatchObject({
        delegation: { status: "archived" },
      })
      expect(yield* Effect.promise(() => test.api.delegation.unarchive({ ...input, directory: alias }))).toMatchObject({
        delegation: { status: "completed" },
      })
      expect(yield* Effect.promise(() => test.api.delegation.archive(input))).toMatchObject({
        delegation: { status: "archived" },
      })
      const forked = yield* Effect.promise(() =>
        test.api.delegation.fork({ ...input, directory: alias, title: "Alias fork" }),
      )
      expect(forked.delegation.parentSessionID).toBe(parentSessionID)
      expect(forked.participants).toHaveLength(2)
      expect(
        yield* Effect.promise(() => test.api.delegation.delete({ ...input, directory: alias, purge: true })),
      ).toBeUndefined()
      expect(yield* storedLifecycle(database, seed.delegationID)).toEqual({
        events: [],
        sequences: [],
        delegations: [],
        participants: [],
        turns: [],
      })
      expect(
        (yield* Effect.promise(() => test.api.delegation.get({ delegationID: forked.delegation.id, directory })))
          .delegation.id,
      ).toBe(forked.delegation.id)
    }),
  ),
)

it.live("reopens admitted delegation history from the same isolated database without execution", () =>
  withEnv({ OMNIXA_EXPERIMENTAL_PERSISTENT_DELEGATIONS: "true" }, () =>
    Effect.gen(function* () {
      const directory = (yield* tmpdirScoped()).path
      const options = { database: { path: path.join(directory, "delegation.db") } }
      const recorded = yield* Effect.gen(function* () {
        const test = yield* boot(directory, options)
        const parentSessionID = yield* test.session
        const created = yield* state(
          yield* test.request("/delegation", { body: { parentSessionID, title: "Survives restart" } }),
        )
        const root = `/delegation/${created.delegation.id}`
        const participantResponse = yield* test.request(`${root}/participant`, {
          body: { provider: "internal", target: "build", role: "implementer", context: "fresh" },
        })
        expect(participantResponse.status).toBe(200)
        const participant = Schema.decodeUnknownSync(Delegation.ParticipantInfo)(
          yield* Effect.promise(() => participantResponse.json()),
        )
        const turn = yield* test.request(`${root}/turn`, {
          body: {
            kind: "task",
            participantIDs: [participant.id],
            senderParticipantID: participant.id,
            deliveryOrigin: "meta",
            delivery: "queue",
          },
        })
        expect(turn.status).toBe(200)
        return yield* state(yield* test.request(root))
      }).pipe(Effect.scoped)
      const test = yield* boot(directory, options)
      expect(yield* state(yield* test.request(`/delegation/${recorded.delegation.id}`))).toEqual(recorded)
      const response = yield* test.request("/delegation")
      expect(response.status).toBe(200)
      expect(
        Schema.decodeUnknownSync(Schema.Array(LegacyDelegationState))(yield* Effect.promise(() => response.json())),
      ).toEqual([recorded])
    }),
  ),
)
