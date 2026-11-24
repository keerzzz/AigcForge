import path from "node:path"
import { eq } from "drizzle-orm"
import { expect } from "bun:test"
import { Omnixa } from "@omnixa/client"
import { Bus } from "@omnixa/core/bus"
import { InvalidRequestError } from "@omnixa/protocol/errors"
import { Database } from "@omnixa/core/database/database"
import { EventTable } from "@omnixa/core/event/sql"
import { Location } from "@omnixa/core/location"
import { LocationServiceMap } from "@omnixa/core/location-services"
import { Session } from "@omnixa/core/session"
import { RootController } from "@omnixa/schema/session"
import { MetaAgentMemory } from "@omnixa/core/agent/meta/memory"
import { WorkArtifact } from "@omnixa/core/session/artifact"
import { SessionGoal } from "@omnixa/core/session/goal"
import { ArtifactCondition } from "@omnixa/schema/session-goal"
import { SessionInbox } from "@omnixa/core/session/inbox"
import { SessionInputResult } from "@omnixa/core/session/input-result"
import { ScheduleTask } from "@omnixa/core/session/schedule-task"
import { ScheduleTable } from "@omnixa/core/session/schedule.sql"
import { SessionInboxTable, SessionMessageTable, SessionTable, TaskOperationTable } from "@omnixa/core/session/sql"
import { SessionTask } from "@omnixa/core/session/task"
import { SessionIdentityProjection } from "@omnixa/core/session/session-identity"
import { Event } from "@omnixa/schema/event"
import { AbsolutePath } from "@omnixa/schema/schema"
import { Agent } from "@omnixa/schema/agent"
import { Model } from "@omnixa/core/model"
import { Project } from "@omnixa/schema/project"
import { Provider } from "@omnixa/core/provider"
import { SessionEvent } from "@omnixa/schema/session-event"
import { SessionTaskEvent } from "@omnixa/schema/session-task-event"
import { SessionIdentity } from "@omnixa/schema/session-identity"
import {
  OperationExistingRootTarget,
  OperationID,
  OperationInfo,
  OperationNewRootTarget,
  OperationRequest,
} from "@omnixa/schema/session-task"
import { SessionMessage } from "@omnixa/schema/session-message"
import { Workspace } from "@omnixa/schema/workspace"
import { WorkflowAsset } from "@omnixa/schema/workflow-asset"
import { Hash } from "@omnixa/util/hash"
import { Context, DateTime, Deferred, Effect, Fiber, Layer, Queue, Schema, Scope, Stream } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { createLegacySession, useOfflineCatalog } from "../../core/test/fixture/models"
import { awaitWithTimeout, it, pollWithTimeout } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"
import type { ServerOptions } from "../src/options"

const taskFromJson = Schema.decodeUnknownSync(Schema.toCodecJson(SessionTask.Info))
const tasksFromJson = Schema.decodeUnknownSync(Schema.toCodecJson(Schema.Array(SessionTask.Info)))
const identityJson = Schema.encodeSync(SessionIdentity.Identity)

const boot = (directory: string, options: ServerOptions = {}) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      createRoutes({
        password: "secret",
        database: { path: ":memory:" },
        config: { directory: path.join(directory, "config"), project: false, content: "{}" },
        models: { fetch: false },
        fs: { filewatcher: false },
        ...options,
      }).pipe(Layer.provide(HttpServer.layerServices)),
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
    const session = Effect.gen(function* () {
      const response = yield* request("/api/session", { body: { location: { directory } } })
      expect(response.status).toBe(200)
      return Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Struct({ id: Session.ID }) }))(
        yield* Effect.promise(() => response.json()),
      ).data.id
    })
    const api = Omnixa.make({
      baseUrl: "http://omnixa.local",
      headers: { authorization: `Basic ${btoa("omnixa:secret")}` },
      fetch: Object.assign((input: string | URL | Request, init?: RequestInit) => handler(new Request(input, init)), {
        preconnect: fetch.preconnect,
      }),
    })
    return {
      context,
      client: api,
      request,
      session,
      tasks: api["session-instance"].session.instance.session.task,
      todos: api["session-instance"].session.instance.session.todo,
      events: api.event,
    }
  })

const info = (response: Response) =>
  Effect.gen(function* () {
    expect(response.status).toBe(200)
    return Schema.decodeUnknownSync(SessionTask.Info)(yield* Effect.promise(() => response.json()))
  })

const list = (response: Response) =>
  Effect.gen(function* () {
    expect(response.status).toBe(200)
    return Schema.decodeUnknownSync(Schema.Array(SessionTask.Info))(yield* Effect.promise(() => response.json()))
  })

const listenUpdates = (bus: Bus.Interface) =>
  Effect.gen(function* () {
    const published = new Array<Event.Payload>()
    const unsubscribe = yield* bus.listen((event) =>
      Effect.sync(() => {
        if (event.type === SessionTask.Event.Updated.type || event.type === SessionTask.Event.TodoUpdated.type)
          published.push(event)
      }),
    )
    yield* Effect.addFinalizer(() => unsubscribe)
    return published
  })

it.live("MP01 identity uses the stored Location graph and the selected Agent through the generated client", () =>
  Effect.gen(function* () {
    const directory = (yield* tmpdirScoped()).path
    const alias = `${directory}${path.sep}.`
    const other = (yield* tmpdirScoped()).path
    const test = yield* boot(directory)
    const locations = Context.get(test.context, LocationServiceMap.Service)
    const context = yield* locations.contextEffect(Location.Ref.make({ directory: AbsolutePath.make(alias) }))
    yield* useOfflineCatalog([
      {
        info: Provider.Info.make({
          ...Provider.Info.empty(Provider.ID.make("fixture")),
          activation: "enabled",
          package: "@omnixa/ai/providers/openai/responses",
        }),
        models: [Model.Info.default(Provider.ID.make("fixture"), Model.ID.make("fixture"))],
      },
    ]).pipe(Effect.provideContext(context))
    const model = Model.Ref.make({ id: Model.ID.make("fixture"), providerID: Provider.ID.make("fixture") })
    const root = yield* Effect.promise(() =>
      test.client.session.create({ agent: "meta", control: "meta", location: { directory: alias }, model }),
    )
    const sessionID = Session.ID.make(root.id)
    const api = test.client["session-instance"].session.instance.session
    const database = Context.get(test.context, Database.Service)
    const events = yield* database.db.select().from(EventTable).all().pipe(Effect.orDie)
    const expected = yield* Context.get(context, SessionIdentityProjection.Service).project(sessionID)
    yield* Effect.forEach([directory, alias], (routeDirectory) =>
      Effect.gen(function* () {
        const identity = Schema.decodeUnknownSync(SessionIdentity.Identity)(
          yield* Effect.promise(() => api.identity({ sessionID, directory: routeDirectory })),
        )
        expect(identityJson(identity)).toEqual(identityJson(expected))
        expect(identity).toMatchObject({
          agent: "meta",
          location: { directory: alias },
          coordination: { available: true, reasons: [], selection: { agent: "meta" } },
          capability: { health: "ready" },
          detail: { status: "ready", detail: { source: "coding" } },
        })
      }),
    )
    expect(yield* database.db.select().from(EventTable).all().pipe(Effect.orDie)).toEqual(events)
    expect((yield* test.request(`/session/${sessionID}/identity`, { authenticated: false })).status).toBe(401)
    expect((yield* test.request(`/session/${sessionID}/identity`, { directory: other })).status).toBe(404)
    yield* Effect.forEach(["build", "plan", "meta"] as const, (agent) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => test.client.session.switchAgent({ sessionID, agent }))
        const reminders = agent === "plan" ? 1 : agent === "meta" ? 2 : 0
        yield* pollWithTimeout(
          SessionInbox.list(database.db, sessionID).pipe(
            Effect.map((pending) => (pending.length === reminders ? true : undefined)),
          ),
          "The selected Agent's Plan reminder did not reach the durable Inbox",
        )
        const afterSwitch = yield* database.db.select().from(EventTable).all().pipe(Effect.orDie)
        const pending = yield* SessionInbox.list(database.db, sessionID)
        const identity = Schema.decodeUnknownSync(SessionIdentity.Identity)(
          yield* Effect.promise(() => api.identity({ sessionID, directory })),
        )
        expect(identityJson(identity)).toEqual(
          identityJson(yield* Context.get(context, SessionIdentityProjection.Service).project(sessionID)),
        )
        expect(identity.agent).toBe(Agent.ID.make(agent))
        expect(identity.coordination?.selection.agent).toBe(Agent.ID.make(agent))
        expect(identity.coordination?.selection.event).toBeDefined()
        expect(identity.coordination?.available).toBe(agent === "meta")
        if (agent !== "meta") expect(identity.coordination?.reasons).toMatchObject([{ code: "meta-not-selected" }])
        expect((yield* Context.get(test.context, Session.Service).get(sessionID)).controller).toEqual(
          Schema.decodeUnknownSync(RootController)(root.controller),
        )
        expect(yield* database.db.select().from(EventTable).all().pipe(Effect.orDie)).toEqual(afterSwitch)
        expect(yield* SessionInbox.list(database.db, sessionID)).toEqual(pending)
      }),
    )
    const pending = yield* SessionInbox.list(database.db, sessionID)
    const reminders = pending.flatMap((item) => (item.type === "synthetic" ? [item] : []))
    expect(pending).toHaveLength(2)
    expect(reminders).toHaveLength(2)
    expect(reminders[0].payload.text).toContain("You are in Plan mode.")
    expect(reminders[1].payload.text).toContain("You are NO LONGER in Plan mode.")
    const finalEvents = yield* database.db.select().from(EventTable).all().pipe(Effect.orDie)
    const enqueued = finalEvents
      .filter(
        (event) =>
          event.type ===
          Event.versionedType(SessionEvent.InboxEnqueued.type, SessionEvent.InboxEnqueued.durable.version),
      )
      .toSorted((left, right) => left.seq - right.seq)
      .map((event) => ({ event, data: Schema.decodeUnknownSync(SessionEvent.InboxEnqueued.data)(event.data) }))
    expect(
      pending.map((item) => ({
        sessionID: item.sessionID,
        inboxID: item.id,
        item: Schema.encodeSync(SessionInbox.Item)(item),
      })),
    ).toEqual(
      enqueued.map((item) => ({
        sessionID: item.data.sessionID,
        inboxID: item.data.inboxID,
        item: Schema.encodeSync(SessionInbox.Item)(item.data.item),
      })),
    )
    expect(
      (yield* database.db.select().from(SessionInboxTable).all().pipe(Effect.orDie))
        .toSorted((left, right) => left.enqueued_seq - right.enqueued_seq)
        .map((item) => ({ id: item.id, sessionID: item.session_id, seq: item.enqueued_seq })),
    ).toEqual(enqueued.map((item) => ({ id: item.data.inboxID, sessionID: item.data.sessionID, seq: item.event.seq })))
    expect(
      (yield* database.db.select().from(SessionMessageTable).all().pipe(Effect.orDie)).map((message) => message.type),
    ).toEqual(["agent-switched", "agent-switched", "agent-switched"])
    expect(finalEvents.some((event) => event.type.startsWith("session.execution."))).toBe(false)
    yield* database.db
      .update(SessionTable)
      .set({ workspace_id: Workspace.ID.make("wrk_identity_foreign") })
      .where(eq(SessionTable.id, sessionID))
      .run()
      .pipe(Effect.orDie)
    expect((yield* test.request(`/session/${sessionID}/identity`)).status).toBe(404)
  }),
)

it.live("MP01 identity preserves typed HTTP failures for absent Agent and unavailable Custom composition", () =>
  Effect.gen(function* () {
    const directory = (yield* tmpdirScoped()).path
    const test = yield* boot(directory)
    const sessionID = yield* test.session
    const database = Context.get(test.context, Database.Service)
    const api = test.client["session-instance"].session.instance.session
    yield* database.db
      .update(SessionTable)
      .set({ agent: null })
      .where(eq(SessionTable.id, sessionID))
      .run()
      .pipe(Effect.orDie)
    const conflict = yield* test.request(`/session/${sessionID}/identity`)
    expect(conflict.status).toBe(409)
    expect(yield* Effect.promise(() => conflict.json())).toMatchObject({ _tag: "ConflictError", resource: sessionID })
    yield* Effect.promise(async () =>
      expect(api.identity({ sessionID, directory })).rejects.toMatchObject({
        _tag: "ConflictError",
        resource: sessionID,
      }),
    )
    const custom = yield* createLegacySession({
      location: Location.Ref.make({ directory: AbsolutePath.make(directory) }),
      mode: "custom",
      agent: Agent.ID.make("meta"),
    }).pipe(Effect.provideContext(test.context))
    const blocked = yield* test.request(`/session/${custom.id}/identity`)
    expect(blocked.status).toBe(403)
    expect(yield* Effect.promise(() => blocked.json())).toMatchObject({ _tag: "ForbiddenError" })
    yield* Effect.promise(async () =>
      expect(api.identity({ sessionID: custom.id, directory })).rejects.toMatchObject({ _tag: "ForbiddenError" }),
    )
    expect(yield* database.db.select().from(SessionInboxTable).all().pipe(Effect.orDie)).toEqual([])
  }),
)

it.live(
  "MP01 HTTP task operations retain user provenance, durable retries, cancellation, and history after Task deletion",
  () =>
    Effect.gen(function* () {
      const directory = (yield* tmpdirScoped()).path
      const other = (yield* tmpdirScoped()).path
      const options = { database: { path: path.join(directory, "operations.db") }, events: { persist: true } }
      const recorded = yield* Effect.gen(function* () {
        const test = yield* boot(directory, options)
        const context = yield* Context.get(test.context, LocationServiceMap.Service).contextEffect(
          Location.Ref.make({ directory: AbsolutePath.make(directory) }),
        )
        yield* useOfflineCatalog([
          {
            info: Provider.Info.make({
              ...Provider.Info.empty(Provider.ID.make("fixture")),
              activation: "enabled",
              package: "@omnixa/ai/providers/openai/responses",
            }),
            models: [Model.Info.default(Provider.ID.make("fixture"), Model.ID.make("fixture"))],
          },
        ]).pipe(Effect.provideContext(context))
        const model = Model.Ref.make({ id: Model.ID.make("fixture"), providerID: Provider.ID.make("fixture") })
        const root = yield* Effect.promise(() =>
          test.client.session.create({ agent: "meta", control: "meta", location: { directory }, model }),
        )
        const sourceSessionID = Session.ID.make(root.id)
        const database = Context.get(test.context, Database.Service)
        const identity = yield* test.request(`/session/${sourceSessionID}/identity`)
        expect(identity.status).toBe(200)
        expect(
          Schema.decodeUnknownSync(SessionIdentity.Identity)(yield* Effect.promise(() => identity.json())).coordination,
        ).toMatchObject({ available: true, reasons: [], selection: { agent: "meta" } })
        const beforeInvalid = {
          operations: yield* database.db.select().from(TaskOperationTable).all().pipe(Effect.orDie),
          inputs: yield* database.db.select().from(SessionInboxTable).all().pipe(Effect.orDie),
        }
        const invalid = {
          ...Schema.encodeSync(OperationRequest)(
            new OperationRequest({
              operationID: OperationID.create(),
              inputID: SessionMessage.ID.create(),
              target: new OperationNewRootTarget({
                type: "new_root",
                mode: "coding",
                agent: Agent.ID.make("build"),
                model,
              }),
              prompt: "Reject invalid operation identity",
              delivery: "queue",
              resume: false,
            }),
          ),
          operationID: "invalid",
        }
        const rejected = yield* test.request(`/session/${sourceSessionID}/task/dispatch`, { body: invalid })
        expect(rejected.status).toBe(400)
        const schemaError = yield* Schema.decodeUnknownEffect(OperationRequest)(invalid).pipe(Effect.flip)
        expect(
          Schema.decodeUnknownSync(InvalidRequestError)(yield* Effect.promise(() => rejected.json())),
        ).toMatchObject({ _tag: "InvalidRequestError", kind: "Payload", message: schemaError.message })
        expect(yield* database.db.select().from(TaskOperationTable).all().pipe(Effect.orDie)).toEqual(
          beforeInvalid.operations,
        )
        expect(yield* database.db.select().from(SessionInboxTable).all().pipe(Effect.orDie)).toEqual(
          beforeInvalid.inputs,
        )
        const staleTask = taskFromJson(
          yield* Effect.promise(() =>
            test.tasks.create({
              sessionID: sourceSessionID,
              directory,
              payload: { content: "Stale task", status: "pending", priority: "medium" },
            }),
          ),
        )
        const stale = new OperationRequest({
          operationID: OperationID.create(),
          inputID: SessionMessage.ID.create(),
          taskID: staleTask.id,
          expectedRevision: staleTask.revision + 1,
          target: new OperationNewRootTarget({
            type: "new_root",
            mode: "coding",
            agent: Agent.ID.make("build"),
            model,
          }),
          prompt: "Dispatch with a stale source revision",
          delivery: "queue",
          resume: false,
        })
        const staleResponse = yield* test.request(`/session/${sourceSessionID}/task/dispatch`, {
          body: Schema.encodeSync(OperationRequest)(stale),
        })
        expect(staleResponse.status).toBe(400)
        expect(yield* Effect.promise(() => staleResponse.json())).toMatchObject({
          _tag: "InvalidRequestError",
          kind: "stale_revision",
        })
        expect(yield* database.db.select().from(TaskOperationTable).all().pipe(Effect.orDie)).toEqual([])
        yield* Effect.promise(() => test.tasks.delete({ sessionID: sourceSessionID, taskID: staleTask.id, directory }))
        const operations = yield* Effect.forEach(["new_root", "existing_root"] as const, (kind) =>
          Effect.gen(function* () {
            const target =
              kind === "existing_root"
                ? yield* Effect.promise(() =>
                    test.client.session.create({ agent: "build", mode: "coding", location: { directory }, model }),
                  )
                : undefined
            const request = new OperationRequest({
              operationID: OperationID.create(),
              inputID: SessionMessage.ID.create(),
              target: target
                ? new OperationExistingRootTarget({ type: "existing_root", sessionID: Session.ID.make(target.id) })
                : new OperationNewRootTarget({
                    type: "new_root",
                    mode: "coding",
                    agent: Agent.ID.make("build"),
                    model,
                    title: "HTTP delegated root",
                  }),
              description: `HTTP ${kind} work`,
              prompt: `Complete the ${kind} work`,
              delivery: "queue",
              resume: false,
            })
            const response = yield* test.request(`/session/${sourceSessionID}/task/dispatch`, {
              body: {
                ...Schema.encodeSync(OperationRequest)(request),
                source: {
                  type: "model_tool",
                  sessionID: sourceSessionID,
                  agent: "meta",
                  messageID: "msg_forged_source",
                  id: "forged-call",
                },
              },
            })
            expect(response.status).toBe(200)
            const operation = Schema.decodeUnknownSync(OperationInfo)(yield* Effect.promise(() => response.json()))
            expect(operation).toMatchObject({
              sourceSessionID,
              operationID: request.operationID,
              inputID: request.inputID,
              phase: "admitted",
              source: { type: "user_coordination", sessionID: sourceSessionID, agent: "meta" },
              selection: { agent: "meta" },
            })
            if (!operation.targetSessionID || !operation.taskID)
              return yield* Effect.die(new Error("Task operation has no target or source Task"))
            const targetSession = yield* Context.get(test.context, Session.Service).get(operation.targetSessionID)
            expect(targetSession.parentID).toBeUndefined()
            expect(targetSession.id).not.toBe(sourceSessionID)
            expect(targetSession.agent).toBe(Agent.ID.make("build"))
            if (target) expect(targetSession.id).toBe(Session.ID.make(target.id))
            const inbox = yield* database.db
              .select()
              .from(SessionInboxTable)
              .where(eq(SessionInboxTable.id, request.inputID))
              .all()
              .pipe(Effect.orDie)
            expect(inbox).toMatchObject([
              { id: request.inputID, session_id: targetSession.id, type: "user", payload: { text: request.prompt } },
            ])
            const retried = yield* Effect.promise(() =>
              test.tasks.dispatch({
                sessionID: sourceSessionID,
                directory: `${directory}/.`,
                payload: Schema.encodeSync(OperationRequest)(request),
              }),
            )
            expect(Schema.decodeUnknownSync(OperationInfo)(retried)).toEqual(operation)
            expect(
              yield* database.db
                .select()
                .from(SessionInboxTable)
                .where(eq(SessionInboxTable.id, request.inputID))
                .all()
                .pipe(Effect.orDie),
            ).toEqual(inbox)
            expect(
              Schema.decodeUnknownSync(OperationInfo)(
                yield* Effect.promise(() =>
                  test.tasks.operation({ sessionID: sourceSessionID, operationID: operation.operationID, directory }),
                ),
              ),
            ).toEqual(operation)
            const conflict = yield* test.request(`/session/${sourceSessionID}/task/dispatch`, {
              body: { ...Schema.encodeSync(OperationRequest)(request), prompt: "Changed operation body" },
            })
            expect(conflict.status).toBe(409)
            expect(yield* Effect.promise(() => conflict.json())).toMatchObject({
              _tag: "ConflictError",
              resource: operation.operationID,
            })
            yield* Effect.promise(async () =>
              expect(
                test.tasks.dispatch({
                  sessionID: sourceSessionID,
                  directory,
                  payload: { ...Schema.encodeSync(OperationRequest)(request), prompt: "Changed operation body" },
                }),
              ).rejects.toMatchObject({ _tag: "ConflictError" }),
            )
            return operation
          }),
        )
        expect(yield* database.db.select().from(TaskOperationTable).all().pipe(Effect.orDie)).toHaveLength(2)
        yield* Effect.promise(() => test.client.session.switchAgent({ sessionID: sourceSessionID, agent: "build" }))
        expect(
          Schema.decodeUnknownSync(Schema.Array(OperationInfo))(
            yield* Effect.promise(() => test.tasks.operations({ sessionID: sourceSessionID, directory })),
          ),
        ).toEqual(operations)
        const cancelled = yield* Effect.forEach(operations, (operation) =>
          Effect.gen(function* () {
            const result = Schema.decodeUnknownSync(OperationInfo)(
              yield* Effect.promise(() =>
                test.tasks.cancelOperation({
                  sessionID: sourceSessionID,
                  operationID: operation.operationID,
                  directory,
                }),
              ),
            )
            expect(result).toMatchObject({ operationID: operation.operationID, phase: "cancelled", cancelIntent: true })
            expect(
              yield* database.db
                .select()
                .from(SessionInboxTable)
                .where(eq(SessionInboxTable.id, operation.inputID))
                .all()
                .pipe(Effect.orDie),
            ).toEqual([])
            return result
          }),
        )
        const deletedTaskID = cancelled[0].taskID
        if (!deletedTaskID) return yield* Effect.die(new Error("Cancelled operation has no source Task"))
        yield* Effect.promise(() => test.tasks.delete({ sessionID: sourceSessionID, taskID: deletedTaskID, directory }))
        expect(
          Schema.decodeUnknownSync(Schema.Array(OperationInfo))(
            yield* Effect.promise(() =>
              test.tasks.operations({ sessionID: sourceSessionID, taskID: deletedTaskID, directory }),
            ),
          ),
        ).toEqual([cancelled[0]])
        expect(
          (yield* test.request(`/session/${sourceSessionID}/task/operations`, { authenticated: false })).status,
        ).toBe(401)
        expect((yield* test.request(`/session/${sourceSessionID}/task/operations`, { directory: other })).status).toBe(
          404,
        )
        expect(
          (yield* test.request(`/session/${sourceSessionID}/task/operations/${cancelled[0].operationID}/cancel`, {
            method: "POST",
            directory: other,
          })).status,
        ).toBe(404)
        const foreign = yield* test.session
        expect((yield* test.request(`/session/${foreign}/task/operations/${cancelled[0].operationID}`)).status).toBe(
          404,
        )
        expect(
          (yield* database.db.select().from(EventTable).all().pipe(Effect.orDie)).some((event) =>
            event.type.startsWith("session.execution."),
          ),
        ).toBe(false)
        return { sourceSessionID, cancelled, deletedTaskID }
      }).pipe(Effect.scoped)
      const reopened = yield* boot(directory, options)
      expect(
        Schema.decodeUnknownSync(Schema.Array(OperationInfo))(
          yield* Effect.promise(() => reopened.tasks.operations({ sessionID: recorded.sourceSessionID, directory })),
        ),
      ).toEqual(recorded.cancelled)
      expect(
        Schema.decodeUnknownSync(Schema.Array(OperationInfo))(
          yield* Effect.promise(() =>
            reopened.tasks.operations({
              sessionID: recorded.sourceSessionID,
              taskID: recorded.deletedTaskID,
              directory,
            }),
          ),
        ),
      ).toEqual([recorded.cancelled[0]])
    }),
  { timeout: 30_000 },
)

it.live("MP01 HTTP dispatch rejects non-Meta before durable reservation", () =>
  Effect.gen(function* () {
    const directory = (yield* tmpdirScoped()).path
    const test = yield* boot(directory)
    const sourceSessionID = yield* test.session
    const request = new OperationRequest({
      operationID: OperationID.create(),
      inputID: SessionMessage.ID.create(),
      target: new OperationNewRootTarget({ type: "new_root", mode: "coding", agent: Agent.ID.make("build") }),
      prompt: "Non-Meta dispatch",
      delivery: "queue",
      resume: false,
    })
    const body = Schema.encodeSync(OperationRequest)(request)
    const response = yield* test.request(`/session/${sourceSessionID}/task/dispatch`, { body })
    expect(response.status).toBe(400)
    expect(yield* Effect.promise(() => response.json())).toMatchObject({
      _tag: "InvalidRequestError",
      kind: "meta-not-selected",
    })
    expect(
      (yield* test.request(`/session/${sourceSessionID}/task/dispatch`, { body, authenticated: false })).status,
    ).toBe(401)
    const database = Context.get(test.context, Database.Service)
    expect(yield* database.db.select().from(TaskOperationTable).all().pipe(Effect.orDie)).toEqual([])
    expect(yield* database.db.select().from(SessionInboxTable).all().pipe(Effect.orDie)).toEqual([])
  }),
)

it.live("MC09 Hub reads only tasks at the canonical Location without changing Task state", () =>
  Effect.gen(function* () {
    const directory = (yield* tmpdirScoped()).path
    const other = (yield* tmpdirScoped()).path
    const test = yield* boot(directory)
    const sessions = Context.get(test.context, Session.Service)
    const workspace = yield* test.session
    const database = Context.get(test.context, Database.Service)
    yield* database.db
      .update(SessionTable)
      .set({ workspace_id: Workspace.ID.make("wrk_mc09_hidden") })
      .run()
      .pipe(Effect.orDie)
    const own = yield* test.session
    const hidden = yield* sessions.create({ location: Location.Ref.make({ directory: AbsolutePath.make(other) }) })
    const taskOwner = Context.get(test.context, SessionTask.Service)
    const ownTasks = yield* taskOwner.append({
      sessionID: own,
      tasks: [{ content: "Visible Hub task", status: "pending", priority: "medium" }],
    })
    yield* taskOwner.append({
      sessionID: hidden.id,
      tasks: [{ content: "Other directory task", status: "pending", priority: "low" }],
    })
    yield* taskOwner.append({
      sessionID: workspace,
      tasks: [{ content: "Explicit workspace task", status: "pending", priority: "low" }],
    })
    const before = yield* taskOwner.listAll()
    expect(yield* list(yield* test.request("/agent-task", { directory: `${directory}/.` }))).toEqual(ownTasks)
    expect((yield* test.request("/agent-task", { authenticated: false })).status).toBe(401)
    expect(yield* taskOwner.listAll()).toEqual(before)
  }),
)

it.live("MC09 cache diagnostics read retained step usage after Session fencing", () =>
  Effect.gen(function* () {
    const directory = (yield* tmpdirScoped()).path
    const other = (yield* tmpdirScoped()).path
    const test = yield* boot(directory, { events: { persist: true } })
    const sessionID = yield* test.session
    const database = Context.get(test.context, Database.Service)
    const events = yield* database.db.select().from(EventTable).all()
    yield* database.db.insert(EventTable).values({
      id: Event.ID.make("evt_mc09_cache"),
      aggregate_id: sessionID,
      seq: Math.max(0, ...events.filter((row) => row.aggregate_id === sessionID).map((row) => row.seq)) + 1,
      type: Event.versionedType(SessionEvent.Step.Ended.type, SessionEvent.Step.Ended.durable.version),
      created: 10,
      data: {
        assistantMessageID: "msg_mc09_cache",
        tokens: { input: 100, output: 20, reasoning: 0, cache: { read: 300, write: 40 } },
      },
    })
    const before = yield* database.db.select().from(EventTable).all()
    const response = yield* test.request(`/session/${sessionID}/cache-diagnostics`)
    expect(response.status).toBe(200)
    expect(yield* Effect.promise(() => response.json())).toMatchObject({
      sessionHitRate: 75,
      sessionCacheRead: 300,
      sessionCacheWrite: 40,
      sessionTotalInput: 100,
      confidence: "high",
      perStep: [{ assistantMessageID: "msg_mc09_cache", hitRate: 75, cacheRead: 300, cacheWrite: 40 }],
    })
    expect((yield* test.request(`/session/${sessionID}/cache-diagnostics`, { directory: other })).status).toBe(404)
    expect(yield* database.db.select().from(EventTable).all()).toEqual(before)
  }),
)

it.live("MC09 artifact apply shares its Location snapshot and reads back the actual file", () =>
  Effect.gen(function* () {
    const directory = (yield* tmpdirScoped()).path
    const other = (yield* tmpdirScoped()).path
    const test = yield* boot(directory)
    const sessionID = yield* test.session
    const body = {
      title: "Release brief 中文",
      relativePath: "reports/brief.md",
      content: "# First saved brief\n",
      overwrite: false,
    }
    const root = `/session/${sessionID}/work-artifact/apply`
    const applied = yield* test.request(root, { body })
    expect(applied.status).toBe(200)
    const record = Schema.decodeUnknownSync(WorkArtifact.ArtifactRecord)(yield* Effect.promise(() => applied.json()))
    expect(record.relativePath).toBe(body.relativePath)
    const location = Location.Ref.make({ directory: AbsolutePath.make(directory) })
    const context = yield* Context.get(test.context, LocationServiceMap.Service).contextEffect(location)
    expect((yield* Context.get(context, WorkArtifact.Service).get(sessionID))?.artifact.id).toBe(record.id)
    expect(
      yield* Effect.promise(() => test.client.file.read({ location: { directory }, path: record.relativePath })),
    ).toEqual(new TextEncoder().encode(body.content))
    expect((yield* test.request(root, { body })).status).toBe(409)
    expect((yield* test.request(root, { directory: other, body: { ...body, overwrite: true } })).status).toBe(409)
    expect((yield* test.request(root, { body: { ...body, relativePath: "../escape.md" } })).status).toBe(400)
    const overwritten = yield* test.request(root, {
      body: { ...body, content: "# Revised saved brief\n", overwrite: true },
    })
    expect(overwritten.status).toBe(200)
    const next = Schema.decodeUnknownSync(WorkArtifact.ArtifactRecord)(yield* Effect.promise(() => overwritten.json()))
    expect((yield* Context.get(context, WorkArtifact.Service).get(sessionID))?.artifact.id).toBe(next.id)
    expect(
      yield* Effect.promise(() => test.client.file.read({ location: { directory }, path: next.relativePath })),
    ).toEqual(new TextEncoder().encode("# Revised saved brief\n"))
  }),
)

it.live("MP04 artifact HTTP apply records the exact producer after the Location owner updates", () =>
  Effect.gen(function* () {
    const directory = (yield* tmpdirScoped()).path
    const test = yield* boot(directory)
    const location = Location.Ref.make({ directory: AbsolutePath.make(directory) })
    const context = yield* Context.get(test.context, LocationServiceMap.Service).contextEffect(location)
    yield* useOfflineCatalog([
      {
        info: Provider.Info.make({
          ...Provider.Info.empty(Provider.ID.make("fixture")),
          name: "Fixture",
          activation: "enabled",
          package: "@omnixa/ai/providers/openai/responses",
        }),
        models: [Model.Info.default(Provider.ID.make("fixture"), Model.ID.make("fixture"))],
      },
    ]).pipe(Effect.provideContext(context))
    const root = yield* Context.get(test.context, Session.Service).create({
      location,
      agent: Agent.ID.make("meta"),
      model: Model.Ref.make({ id: Model.ID.make("fixture"), providerID: Provider.ID.make("fixture") }),
    })
    const goals = Context.get(test.context, SessionGoal.Service)
    const bus = Context.get(test.context, Bus.Service)
    const db = Context.get(test.context, Database.Service).db
    const content = "# Verified generated artifact\n"
    const condition = Schema.decodeUnknownSync(ArtifactCondition)({
      id: "artifact",
      kind: "artifact",
      sessionID: root.id,
      artifactID: "pending-artifact",
      revision: WorkflowAsset.Revision.make(Hash.sha256(content)),
      relativePath: "result.md",
    })
    const acceptance = SessionGoal.Condition.make({
      id: "accept",
      kind: "human_acceptance",
      description: "Confirm the saved artifact",
    })
    const originalGoal = yield* goals.set({
      sessionID: root.id,
      objective: "Accept the exact applied result",
      conditions: [condition, acceptance],
      budget: {},
    })
    const unsubscribe = yield* bus.listen((event) =>
      Effect.gen(function* () {
        if (event.type !== WorkArtifact.Event.ArtifactApplied.type) return undefined
        const applied = Schema.decodeUnknownSync(WorkArtifact.Event.ArtifactApplied.data)(event.data)
        if (applied.sessionID !== root.id) return undefined
        // apply allocates the Artifact ID before updating its snapshot; bind the existing Goal to that actual ID.
        const goal = yield* goals.edit({
          sessionID: root.id,
          goalID: originalGoal.id,
          expectedRevision: originalGoal.revision,
          conditions: [SessionGoal.Condition.make({ ...condition, artifactID: applied.artifactID }), acceptance],
        })
        const round = (yield* goals.advance({ sessionID: root.id, goalID: originalGoal.id })).round
        if (!round) return yield* Effect.die(new Error("missing Goal round"))
        expect(round).toMatchObject({ goalID: originalGoal.id, sessionID: root.id, revision: goal.revision })
        yield* SessionInbox.promote(db, bus, root.id, "input", undefined, { anchorInputID: round.inputID })
        return undefined
      }).pipe(Effect.orDie),
    )
    yield* Effect.addFinalizer(() => unsubscribe)
    const response = yield* test.request(`/session/${root.id}/work-artifact/apply`, {
      body: {
        title: "Applied result",
        relativePath: "result.md",
        content,
        overwrite: false,
      },
    })
    expect({ status: response.status, body: yield* Effect.promise(() => response.clone().text()) }).toMatchObject({
      status: 200,
    })
    const artifact = Schema.decodeUnknownSync(WorkArtifact.ArtifactRecord)(yield* Effect.promise(() => response.json()))
    expect(yield* goals.list(root.id)).toHaveLength(1)
    const goal = yield* goals.get({ sessionID: root.id, goalID: originalGoal.id })
    if (!goal) return yield* Effect.die(new Error("missing applied artifact Goal"))
    expect(goal).toMatchObject({
      id: originalGoal.id,
      revision: originalGoal.revision + 1,
      status: "active",
      conditions: [{ kind: "artifact", sessionID: root.id, artifactID: artifact.id }, acceptance],
    })
    expect(goal.rounds).toHaveLength(1)
    expect(goal.rounds[0]).toMatchObject({ goalID: originalGoal.id, sessionID: root.id, revision: goal.revision })
    expect(yield* SessionInputResult.current(db, root.id)).toMatchObject({
      anchorInputID: goal.rounds[0].inputID,
      inputs: [{ inputID: goal.rounds[0].inputID }],
    })
    expect(goal.evidence).toHaveLength(1)
    expect(goal.currentEvidenceIDs).toEqual([goal.evidence[0].id])
    expect(goal.evidence[0]).toMatchObject({
      kind: "artifact",
      revision: goal.revision,
      producer: {
        sessionID: root.id,
        artifactID: artifact.id,
        revision: Hash.sha256(content),
        relativePath: artifact.relativePath,
      },
    })
    expect(goal.satisfiedConditionIDs).toEqual(["artifact"])
    expect(yield* Context.get(context, WorkArtifact.Service).get(root.id)).toMatchObject({
      artifact: { id: artifact.id, sessionID: root.id, relativePath: artifact.relativePath },
      revision: Hash.sha256(content),
    })
    expect(
      yield* Effect.promise(() => test.client.file.read({ location: { directory }, path: artifact.relativePath })),
    ).toEqual(new TextEncoder().encode(content))
    const other = (yield* tmpdirScoped()).path
    expect(
      (yield* test.request(`/session/${root.id}/work-artifact/apply`, {
        directory: other,
        body: {
          title: "Wrong location",
          relativePath: "result.md",
          content,
          overwrite: false,
        },
      })).status,
    ).toBe(409)
    expect((yield* goals.get({ sessionID: root.id, goalID: originalGoal.id }))?.evidence).toEqual(goal.evidence)
  }),
)

it.live("MC09 Meta reads preserve unknown recorded statistics and project facts at the owning Location", () =>
  Effect.gen(function* () {
    const directory = (yield* tmpdirScoped()).path
    const other = (yield* tmpdirScoped()).path
    const test = yield* boot(directory)
    const sessionID = yield* test.session
    const response = yield* test.request(`/session/${sessionID}/meta`)
    expect(response.status).toBe(200)
    const meta = yield* Effect.promise(() => response.json())
    expect(meta).toMatchObject({ sessions: [] })
    expect((yield* test.request(`/session/${sessionID}/meta`, { directory: other })).status).toBe(404)
    const facts = yield* test.request(`/session/${sessionID}/project-memory`)
    expect(facts.status).toBe(200)
    expect(yield* Effect.promise(() => facts.json())).toEqual([])
    expect((yield* test.request(`/session/${sessionID}/project-memory`, { directory: other })).status).toBe(404)
    yield* useOfflineCatalog([
      {
        info: Provider.Info.make({
          ...Provider.Info.empty(Provider.ID.make("fixture")),
          activation: "enabled",
          package: "@omnixa/ai/providers/openai/responses",
        }),
        models: [Model.Info.default(Provider.ID.make("fixture"), Model.ID.make("fixture"))],
      },
    ]).pipe(
      Effect.provideContext(
        yield* Context.get(test.context, LocationServiceMap.Service).contextEffect(
          Location.Ref.make({ directory: AbsolutePath.make(directory) }),
        ),
      ),
    )
    const root = yield* Context.get(test.context, Session.Service).create({
      location: Location.Ref.make({ directory: AbsolutePath.make(directory) }),
      agent: Agent.ID.make("meta"),
      model: Model.Ref.make({ id: Model.ID.make("fixture"), providerID: Provider.ID.make("fixture") }),
    })
    expect(root.controller?.kind).toBe("root")
    const controlled = yield* test.request(`/session/${root.id}/meta`)
    expect(controlled.status).toBe(200)
    const read = yield* Effect.promise(() => controlled.json())
    expect(read).toMatchObject({
      controller: { kind: "root", metaAgentID: root.controller?.metaAgentID, rootSessionID: root.id },
      sessions: [{ sessionID: root.id, role: "orchestrator" }],
      stats: {
        totalSessions: 1,
        recordedTokens: 0,
        unknownTokenSessionCount: 1,
        recordedOnly: true,
        physicalAttemptCoverage: "unknown",
      },
    })
    expect(Object.hasOwn(read.stats, "totalTokens")).toBe(false)
    const memories = Context.get(test.context, MetaAgentMemory.Service)
    const ownFact = yield* memories.record({
      sessionID: root.id,
      projectID: root.projectID,
      factCategory: "api",
      content: "Exact project API fact",
    })
    const otherProject = Project.ID.make("project_mc09_other")
    const otherFact = yield* memories.record({
      sessionID: root.id,
      projectID: otherProject,
      factCategory: "api",
      content: "Other project fact",
    })
    const loaded = yield* test.request(`/session/${root.id}/project-memory?keyword=Exact&category=api`)
    expect(loaded.status).toBe(200)
    expect(yield* Effect.promise(() => loaded.json())).toMatchObject([
      { id: ownFact, projectID: root.projectID, content: "Exact project API fact" },
    ])
    expect((yield* test.request(`/session/${root.id}/project-memory/${otherFact}`, { method: "DELETE" })).status).toBe(
      200,
    )
    expect((yield* memories.query({ projectID: otherProject })).map((fact) => fact.id)).toEqual([otherFact])
    expect((yield* test.request(`/session/${root.id}/project-memory/${ownFact}`, { method: "DELETE" })).status).toBe(
      200,
    )
    expect(yield* memories.query({ projectID: root.projectID })).toEqual([])
  }),
)

it.live("serves legacy todos from Task state with ownership checks and no read side effects", () =>
  Effect.gen(function* () {
    const directory = (yield* tmpdirScoped()).path
    const other = (yield* tmpdirScoped()).path
    const test = yield* boot(directory)
    const sessionID = yield* test.session
    const emptySessionID = yield* test.session
    const scheduledAt = (yield* DateTime.nowAsDate).getTime() + 3_600_000
    const tasks = tasksFromJson(
      yield* Effect.promise(() =>
        test.tasks.update({
          sessionID,
          directory,
          payload: [
            { content: "pending", status: "pending", priority: "low" },
            { content: "completed", status: "completed", priority: "medium" },
            { content: "failed", status: "failed", priority: "high" },
            { content: "scheduled", status: "scheduled", priority: "low", scheduledAt },
          ],
        }),
      ),
    )
    const published = yield* listenUpdates(Context.get(test.context, Bus.Service))
    const expected = [
      { content: "pending", status: "pending", priority: "low" },
      { content: "completed", status: "completed", priority: "medium" },
      { content: "failed", status: "failed", priority: "high" },
      { content: "scheduled", status: "scheduled", priority: "low" },
    ]
    expect(yield* Effect.promise(() => test.todos({ sessionID, directory }))).toEqual(expected)
    expect(yield* Effect.promise(() => test.todos({ sessionID, directory: `${directory}/.` }))).toEqual(expected)
    expect(yield* Effect.promise(() => test.todos({ sessionID: emptySessionID, directory }))).toEqual([])
    expect((yield* test.request(`/session/${sessionID}/todo`, { authenticated: false })).status).toBe(401)
    expect((yield* test.request("/session/ses_todo_http_missing/todo")).status).toBe(404)
    expect((yield* test.request(`/session/${sessionID}/todo`, { directory: other })).status).toBe(404)
    expect(tasksFromJson(yield* Effect.promise(() => test.tasks.get({ sessionID, directory })))).toEqual(tasks)
    expect(published).toEqual([])
  }),
)

it.live("serves all six task operations through the generated Promise client without losing concurrent appends", () =>
  Effect.gen(function* () {
    const directory = (yield* tmpdirScoped("omnixa-task-%2F-")).path
    const test = yield* boot(directory)
    const sessionID = yield* test.session
    expect(yield* Effect.promise(() => test.tasks.get({ sessionID, directory }))).toEqual([])
    const first = taskFromJson(
      yield* Effect.promise(() =>
        test.tasks.create({
          sessionID,
          directory,
          payload: { content: "first", status: "pending", priority: "medium" },
        }),
      ),
    )
    expect(first.id).toStartWith("tsk_")
    expect(first.sessionID).toBe(sessionID)
    expect(first.revision).toBe(1)
    const appended = yield* Effect.forEach(
      ["second", "third"],
      (content) =>
        Effect.promise(() =>
          test.tasks.create({ sessionID, directory, payload: { content, status: "pending", priority: "low" } }),
        ),
      { concurrency: "unbounded" },
    )
    expect(new Set([first.id, ...appended.map((task) => task.id)]).size).toBe(3)
    const patched = yield* Effect.promise(() =>
      test.tasks.patch({
        sessionID,
        directory: `${directory}/.`,
        taskID: first.id,
        status: "completed",
        content: "first complete",
        priority: "high",
        expectedRevision: first.revision,
      }),
    )
    expect(patched).toMatchObject({
      id: first.id,
      status: "completed",
      content: "first complete",
      priority: "high",
      revision: 2,
    })
    const before = yield* Effect.promise(() => test.tasks.get({ sessionID, directory }))
    expect(before).toHaveLength(3)
    expect(before[0]).toEqual(patched)
    const ids = before.map((task) => task.id).reverse()
    const reordered = yield* Effect.promise(() =>
      test.tasks.reorder({ sessionID, directory, ids, expectedRevision: 2 }),
    )
    expect(reordered.map((task) => task.id)).toEqual(ids)
    expect(reordered.map((task) => task.revision)).toEqual([2, 2, 3])
    const deleted = yield* Effect.promise(() => test.tasks.delete({ sessionID, directory, taskID: reordered[0].id }))
    expect(deleted).toEqual(reordered[0])
    expect((yield* Effect.promise(() => test.tasks.get({ sessionID, directory }))).map((task) => task.id)).toEqual(
      ids.slice(1),
    )
    const reconciled = yield* Effect.promise(() =>
      test.tasks.update({
        sessionID,
        directory,
        payload: [{ id: first.id, content: "retained", status: "completed", priority: "high" }],
      }),
    )
    expect(reconciled).toHaveLength(1)
    expect(reconciled[0]).toMatchObject({ id: first.id, content: "retained", revision: 4 })
    expect(yield* Effect.promise(() => test.tasks.get({ sessionID, directory }))).toEqual(reconciled)
    expect(yield* Effect.promise(() => test.tasks.update({ sessionID, directory, payload: [] }))).toEqual([])
  }),
)

it.live("publishes persisted Task writes and runtime progress through authenticated SSE and the generated client", () =>
  Effect.gen(function* () {
    const directory = (yield* tmpdirScoped("omnixa-task-sse-")).path
    const test = yield* boot(directory)
    const sessionID = yield* test.session
    expect((yield* test.request("/api/event", { authenticated: false })).status).toBe(401)
    const scope = yield* Scope.Scope
    const connected = yield* Deferred.make<void>()
    const updates = yield* Queue.unbounded<Event.Data<typeof SessionTaskEvent.Updated>>()
    const todos = yield* Queue.unbounded<Event.Data<typeof SessionTaskEvent.TodoUpdated>>()
    const progress = yield* Queue.unbounded<Event.Data<typeof SessionTaskEvent.Progress>>()
    const listener = yield* Stream.fromAsyncIterable(
      test.events.subscribe(),
      (cause) => new Error("Task SSE failed", { cause }),
    ).pipe(
      Stream.runForEach((event) => {
        if (event.type === "server.connected") return Deferred.succeed(connected, undefined).pipe(Effect.asVoid)
        if (event.type === "task.updated" && event.data.sessionID === sessionID)
          return Queue.offer(updates, Schema.decodeUnknownSync(SessionTaskEvent.Updated.data)(event.data)).pipe(
            Effect.asVoid,
          )
        if (event.type === "todo.updated" && event.data.sessionID === sessionID)
          return Queue.offer(todos, Schema.decodeUnknownSync(SessionTaskEvent.TodoUpdated.data)(event.data)).pipe(
            Effect.asVoid,
          )
        if (event.type === "task.progress" && event.data.sessionID === sessionID)
          return Queue.offer(progress, Schema.decodeUnknownSync(SessionTaskEvent.Progress.data)(event.data)).pipe(
            Effect.asVoid,
          )
        return Effect.void
      }),
      Effect.forkIn(scope),
    )
    yield* awaitWithTimeout(Deferred.await(connected), "Task SSE did not connect", "10 seconds")
    const created = taskFromJson(
      yield* Effect.promise(() =>
        test.tasks.create({
          sessionID,
          directory,
          payload: { content: "Review implementation", status: "pending", priority: "medium" },
        }),
      ),
    )
    const admitted = yield* awaitWithTimeout(
      Queue.take(updates),
      "Task creation was filtered from public SSE",
      "10 seconds",
    )
    expect(admitted).toMatchObject({ sessionID, tasks: [created] })
    expect(admitted.tasks).toEqual(tasksFromJson(yield* Effect.promise(() => test.tasks.get({ sessionID, directory }))))
    expect(
      (yield* awaitWithTimeout(Queue.take(todos), "Todo creation was filtered from public SSE", "10 seconds")).todos,
    ).toEqual([{ content: created.content, status: created.status, priority: created.priority }])
    const patched = taskFromJson(
      yield* Effect.promise(() =>
        test.tasks.patch({
          sessionID,
          directory,
          taskID: created.id,
          content: "Review complete",
          status: "completed",
          priority: "high",
          expectedRevision: created.revision,
        }),
      ),
    )
    if (!patched) return yield* Effect.die(new Error("Task SSE PATCH returned no Task"))
    const edited = yield* awaitWithTimeout(Queue.take(updates), "Task edit was filtered from public SSE", "10 seconds")
    expect(edited.tasks).toEqual([patched])
    expect(edited.tasks[0]).toMatchObject({
      id: created.id,
      status: "completed",
      priority: "high",
      revision: created.revision + 1,
    })
    expect(edited.tasks).toEqual(tasksFromJson(yield* Effect.promise(() => test.tasks.get({ sessionID, directory }))))
    expect(
      (yield* awaitWithTimeout(Queue.take(todos), "Todo edit was filtered from public SSE", "10 seconds")).todos,
    ).toEqual([{ content: patched.content, status: patched.status, priority: patched.priority }])
    const tasks = Context.get(test.context, SessionTask.Service)
    yield* tasks.recordProgress({ sessionID, taskID: created.id, phase: "tool", progress: 0.5, current: 1, total: 2 })
    expect(
      yield* awaitWithTimeout(Queue.take(progress), "Task progress was filtered from public SSE", "10 seconds"),
    ).toMatchObject({
      sessionID,
      taskID: created.id,
      phase: "tool",
      progress: 0.5,
      current: 1,
      total: 2,
      updatedAt: expect.any(Number),
    })
    expect(tasksFromJson(yield* Effect.promise(() => test.tasks.get({ sessionID, directory })))).toEqual([
      ...edited.tasks,
    ])
    expect(
      taskFromJson(yield* Effect.promise(() => test.tasks.delete({ sessionID, directory, taskID: created.id }))),
    ).toEqual(patched)
    expect(
      (yield* awaitWithTimeout(Queue.take(updates), "Task deletion was filtered from public SSE", "10 seconds")).tasks,
    ).toEqual([])
    expect(
      (yield* awaitWithTimeout(Queue.take(todos), "Todo deletion was filtered from public SSE", "10 seconds")).todos,
    ).toEqual([])
    expect(yield* Effect.promise(() => test.tasks.get({ sessionID, directory }))).toEqual([])
    yield* Fiber.interrupt(listener)
  }),
)

it.live("enforces authentication, Session Location ownership, named task scope, and revision errors", () =>
  Effect.gen(function* () {
    const directory = (yield* tmpdirScoped()).path
    const other = (yield* tmpdirScoped()).path
    const test = yield* boot(directory)
    const sessionID = yield* test.session
    const otherSessionID = yield* test.session
    const root = `/session/${sessionID}/task`
    const created = yield* info(
      yield* test.request(root, { body: { content: "owner", status: "pending", priority: "medium" } }),
    )
    const operations = [
      { suffix: "", method: "GET", body: undefined },
      { suffix: "", method: "PATCH", body: [] },
      { suffix: "", method: "POST", body: { content: "new", status: "pending", priority: "low" } },
      { suffix: `/${created.id}`, method: "PATCH", body: { content: "changed" } },
      { suffix: `/${created.id}`, method: "DELETE", body: undefined },
      { suffix: "/reorder", method: "POST", body: { ids: [created.id] } },
    ]
    yield* Effect.forEach(operations, (operation) =>
      Effect.gen(function* () {
        expect((yield* test.request(`${root}${operation.suffix}`, { ...operation, authenticated: false })).status).toBe(
          401,
        )
        expect((yield* test.request(`/session/ses_task_http_missing/task${operation.suffix}`, operation)).status).toBe(
          404,
        )
        expect((yield* test.request(`${root}${operation.suffix}`, { ...operation, directory: other })).status).toBe(404)
      }),
    )
    for (const method of ["PATCH", "DELETE"]) {
      expect(
        (yield* test.request(`/session/${otherSessionID}/task/${created.id}`, {
          method,
          body: method === "PATCH" ? { content: "foreign" } : undefined,
        })).status,
      ).toBe(404)
      expect(
        (yield* test.request(`${root}/missing`, {
          method,
          body: method === "PATCH" ? { content: "missing", expectedRevision: 0 } : undefined,
        })).status,
      ).toBe(404)
    }
    for (const body of [{}, { expectedRevision: created.revision }, { content: "stale", expectedRevision: 0 }]) {
      expect((yield* test.request(`${root}/${created.id}`, { method: "PATCH", body })).status).toBe(400)
    }
    for (const body of [
      { ids: [] },
      { ids: [created.id, created.id] },
      { ids: ["missing"] },
      { ids: [created.id], expectedRevision: 0 },
    ]) {
      expect((yield* test.request(`${root}/reorder`, { body })).status).toBe(400)
    }
    expect(
      (yield* test.request(root, {
        body: { id: created.id, content: "duplicate", status: "pending", priority: "low" },
      })).status,
    ).toBe(400)
    expect(
      (yield* test.request(`/session/${otherSessionID}/task`, {
        method: "PATCH",
        body: [{ id: created.id, content: "foreign", status: "pending", priority: "low" }],
      })).status,
    ).toBe(400)
    expect(yield* list(yield* test.request(root))).toEqual([created])
    expect(yield* list(yield* test.request(`/session/${otherSessionID}/task`))).toEqual([])
  }),
)

it.live("serves task CRUD for stored directory aliases while rejecting another Location", () =>
  Effect.gen(function* () {
    const directory = (yield* tmpdirScoped()).path
    const other = (yield* tmpdirScoped()).path
    const alias = `${directory}${path.sep}.`
    const test = yield* boot(directory)
    const response = yield* test.request("/api/session", { body: { location: { directory: alias } } })
    expect(response.status).toBe(200)
    const sessionID = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Struct({ id: Session.ID }) }))(
      yield* Effect.promise(() => response.json()),
    ).data.id
    expect(String((yield* Context.get(test.context, Session.Service).get(sessionID)).location.directory)).toBe(alias)
    const root = `/session/${sessionID}/task`
    yield* Effect.forEach([directory, alias], (routeDirectory) =>
      Effect.gen(function* () {
        expect(yield* list(yield* test.request(root, { directory: routeDirectory }))).toEqual([])
        const created = yield* Effect.forEach(["first", "second"], (content) =>
          Effect.gen(function* () {
            return yield* info(
              yield* test.request(root, {
                directory: routeDirectory,
                body: { content, status: "pending", priority: "medium" },
              }),
            )
          }),
        )
        const patched = yield* info(
          yield* test.request(`${root}/${created[0].id}`, {
            directory: routeDirectory,
            method: "PATCH",
            body: { status: "completed", content: "done", priority: "high", expectedRevision: created[0].revision },
          }),
        )
        expect(patched).toMatchObject({
          id: created[0].id,
          content: "done",
          status: "completed",
          priority: "high",
          revision: 2,
        })
        const reordered = yield* list(
          yield* test.request(`${root}/reorder`, {
            directory: routeDirectory,
            body: { ids: created.map((task) => task.id).reverse(), expectedRevision: patched.revision },
          }),
        )
        expect(reordered.map((task) => task.id)).toEqual([created[1].id, created[0].id])
        const reconciled = yield* list(
          yield* test.request(root, {
            directory: routeDirectory,
            method: "PATCH",
            body: [{ id: created[0].id, content: "retained", status: "completed", priority: "high" }],
          }),
        )
        expect(reconciled).toHaveLength(1)
        expect(reconciled[0]).toMatchObject({ id: created[0].id, content: "retained", revision: 4 })
        yield* Effect.forEach(
          [
            { suffix: "", method: "GET", body: undefined },
            { suffix: "", method: "PATCH", body: [] },
            { suffix: "", method: "POST", body: { content: "foreign", status: "pending", priority: "low" } },
            { suffix: `/${created[0].id}`, method: "PATCH", body: { content: "foreign" } },
            { suffix: `/${created[0].id}`, method: "DELETE", body: undefined },
            { suffix: "/reorder", method: "POST", body: { ids: [created[0].id] } },
          ],
          (operation) =>
            Effect.gen(function* () {
              expect(
                (yield* test.request(`${root}${operation.suffix}`, { ...operation, directory: other })).status,
              ).toBe(404)
            }),
        )
        expect(yield* list(yield* test.request(root, { directory: routeDirectory }))).toEqual(reconciled)
        expect(
          yield* info(
            yield* test.request(`${root}/${created[0].id}`, {
              directory: routeDirectory,
              method: "DELETE",
            }),
          ),
        ).toEqual(reconciled[0])
        expect(yield* list(yield* test.request(root, { directory: routeDirectory }))).toEqual([])
      }),
    )
  }),
)

it.live("rejects invalid combined PATCH atomically and preserves internal digests through public writes", () =>
  Effect.gen(function* () {
    const directory = (yield* tmpdirScoped()).path
    const test = yield* boot(directory)
    const sessionID = yield* test.session
    const root = `/session/${sessionID}/task`
    const tasks = Context.get(test.context, SessionTask.Service)
    const published = yield* listenUpdates(Context.get(test.context, Bus.Service))
    const created = yield* info(
      yield* test.request(root, {
        body: { content: "original", status: "pending", priority: "medium", outputDigest: "forged-create" },
      }),
    )
    expect(created.outputDigest).toBeUndefined()
    const seeded = yield* tasks.patch({
      sessionID,
      id: created.id,
      status: "pending",
      outputDigest: "internal-evidence",
    })
    if (!seeded) return yield* Effect.die(new Error("Task missing after internal patch"))
    const before = yield* tasks.get(sessionID)
    const eventsBefore = published.length
    const rejected = yield* test.request(`${root}/${created.id}`, {
      method: "PATCH",
      body: { status: "scheduled", content: "must not land", priority: "high", expectedRevision: seeded.revision },
    })
    expect(rejected.status).toBe(400)
    expect(yield* Effect.promise(() => rejected.json())).toMatchObject({ kind: "invalid_schedule" })
    expect(yield* tasks.get(sessionID)).toEqual(before)
    expect(published).toHaveLength(eventsBefore)
    const changed = yield* info(
      yield* test.request(`${root}/${created.id}`, {
        method: "PATCH",
        body: {
          status: "completed",
          content: "done",
          priority: "high",
          expectedRevision: seeded.revision,
          outputDigest: "forged-patch",
          revision: 999,
        },
      }),
    )
    expect(changed).toMatchObject({
      outputDigest: "internal-evidence",
      revision: seeded.revision + 1,
      content: "done",
      priority: "high",
      status: "completed",
    })
    expect(published.slice(eventsBefore).map((event) => event.type)).toEqual([
      SessionTask.Event.Updated.type,
      SessionTask.Event.TodoUpdated.type,
    ])
    expect(Schema.decodeUnknownSync(SessionTask.Event.Updated.data)(published[eventsBefore].data).tasks).toEqual([
      changed,
    ])
    const reconciled = yield* list(
      yield* test.request(root, {
        method: "PATCH",
        body: [
          {
            id: changed.id,
            content: "reconciled",
            status: "completed",
            priority: "low",
            outputDigest: "forged-reconcile",
          },
        ],
      }),
    )
    expect(reconciled[0]).toMatchObject({
      id: changed.id,
      outputDigest: "internal-evidence",
      revision: changed.revision + 1,
    })
    const reordered = yield* list(
      yield* test.request(`${root}/reorder`, {
        body: { ids: [changed.id], expectedRevision: reconciled[0].revision },
      }),
    )
    expect(reordered[0]).toMatchObject({
      id: changed.id,
      outputDigest: "internal-evidence",
      revision: reconciled[0].revision + 1,
    })
  }),
)

it.live("retains Custom scheduled Tasks and their canonical Schedule rules without admitting execution", () =>
  Effect.gen(function* () {
    const directory = (yield* tmpdirScoped()).path
    const test = yield* boot(directory)
    const sessionID = yield* test.session
    const root = `/session/${sessionID}/task`
    const database = Context.get(test.context, Database.Service)
    yield* database.db.update(SessionTable).set({ mode: "custom" }).run().pipe(Effect.orDie)
    expect((yield* Context.get(test.context, Session.Service).get(sessionID)).mode).toBe("custom")
    const sessionBefore = yield* database.db.select().from(SessionTable).all()
    const scheduledAt = (yield* DateTime.nowAsDate).getTime() + 3_600_000
    const recurrence = { cron: "0 9 * * *", timezone: "UTC", enabled: true }
    for (const body of [
      { content: "no trigger", status: "scheduled", priority: "low" },
      { content: "bad cron", status: "scheduled", priority: "low", recurrence: { cron: "invalid", enabled: true } },
    ])
      expect((yield* test.request(root, { body })).status).toBe(400)
    const created = yield* info(
      yield* test.request(root, {
        body: {
          content: "scheduled",
          status: "scheduled",
          priority: "medium",
          agentID: "worker",
          scheduledAt,
          recurrence,
        },
      }),
    )
    expect(created).toMatchObject({ status: "scheduled", agentID: "worker", scheduledAt, recurrence })
    const scheduleID = ScheduleTask.idFor(created.id)
    const registered = yield* database.db
      .select()
      .from(ScheduleTable)
      .where(eq(ScheduleTable.id, scheduleID))
      .get()
      .pipe(Effect.orDie)
    if (!registered)
      return yield* Effect.die(new Error("The scheduled Task did not register its canonical Schedule rule"))
    expect(registered).toMatchObject({
      id: scheduleID,
      session_id: sessionID,
      task_id: created.id,
      kind: "task",
      status: "pending",
      content: created.content,
      due_at: scheduledAt,
      recurrence,
      timezone: "UTC",
      revision: 1,
      target: { policy: "legacy_child", agentID: "worker" },
      execution_policy: { delivery: "queue", missed: "catch_up" },
      delivery_key: `task:${sessionID}:${created.id}`,
      attempts: 0,
      active_occurrence_id: null,
    })
    expect(created.nextRun).toBe(registered.next_due_at ?? undefined)
    const reconciled = yield* list(
      yield* test.request(root, {
        method: "PATCH",
        body: [{ id: created.id, content: "updated schedule", status: "scheduled", priority: "high" }],
      }),
    )
    expect(reconciled[0]).toMatchObject({ id: created.id, agentID: "worker", scheduledAt, recurrence })
    expect(
      yield* database.db.select().from(ScheduleTable).where(eq(ScheduleTable.id, scheduleID)).get().pipe(Effect.orDie),
    ).toMatchObject({
      id: scheduleID,
      session_id: sessionID,
      task_id: created.id,
      content: "updated schedule",
      revision: registered.revision + 1,
      target: registered.target,
      status: "pending",
      next_due_at: registered.next_due_at,
    })
    const paused = yield* info(
      yield* test.request(`${root}/${created.id}`, {
        method: "PATCH",
        body: { status: "cancelled", content: "paused", expectedRevision: reconciled[0].revision },
      }),
    )
    expect(paused).toMatchObject({ status: "cancelled", content: "paused", scheduledAt, recurrence })
    expect(paused.nextRun).toBeUndefined()
    const pausedRule = yield* database.db
      .select()
      .from(ScheduleTable)
      .where(eq(ScheduleTable.id, scheduleID))
      .get()
      .pipe(Effect.orDie)
    if (!pausedRule) return yield* Effect.die(new Error("The cancelled Task lost its Schedule rule"))
    expect(pausedRule).toMatchObject({
      id: scheduleID,
      session_id: sessionID,
      task_id: created.id,
      status: "paused",
      content: paused.content,
      revision: registered.revision + 2,
      recurrence,
      target: registered.target,
      next_due_at: null,
      attempts: 0,
      active_occurrence_id: null,
    })
    const reordered = yield* list(yield* test.request(`${root}/reorder`, { body: { ids: [created.id] } }))
    expect(
      yield* database.db.select().from(ScheduleTable).where(eq(ScheduleTable.id, scheduleID)).get().pipe(Effect.orDie),
    ).toEqual(pausedRule)
    expect(yield* info(yield* test.request(`${root}/${created.id}`, { method: "DELETE" }))).toEqual(reordered[0])
    expect(yield* list(yield* test.request(root))).toEqual([])
    const retained = yield* database.db.select().from(ScheduleTable).all().pipe(Effect.orDie)
    expect(retained).toHaveLength(1)
    expect(retained[0]).toMatchObject({
      id: scheduleID,
      session_id: sessionID,
      task_id: created.id,
      kind: "task",
      status: "cancelled",
      content: paused.content,
      due_at: scheduledAt,
      recurrence,
      target: registered.target,
      execution_policy: registered.execution_policy,
      delivery_key: registered.delivery_key,
      revision: pausedRule.revision + 1,
      next_due_at: null,
      attempts: 0,
      active_occurrence_id: null,
    })
    expect(yield* database.db.select().from(SessionInboxTable).all()).toEqual([])
    expect(yield* database.db.select().from(SessionMessageTable).all()).toEqual([])
    expect(yield* database.db.select().from(SessionTable).all()).toEqual(sessionBefore)
  }),
)

it.live(
  "reopens exact task ids, order, digests, and revisions from a disk database without execution",
  () =>
    Effect.gen(function* () {
      const directory = (yield* tmpdirScoped()).path
      const options = { database: { path: path.join(directory, "tasks.db") } }
      const recorded = yield* Effect.gen(function* () {
        const test = yield* boot(directory, options)
        const sessionID = yield* test.session
        const root = `/session/${sessionID}/task`
        const created = yield* list(
          yield* test.request(root, {
            method: "PATCH",
            body: [
              { content: "first", status: "pending", priority: "medium" },
              { content: "second", status: "pending", priority: "low" },
            ],
          }),
        )
        yield* Context.get(test.context, SessionTask.Service).patch({
          sessionID,
          id: created[0].id,
          status: "completed",
          outputDigest: "durable-child-evidence",
        })
        const tasks = yield* list(
          yield* test.request(`${root}/reorder`, {
            body: { ids: created.map((task) => task.id).reverse(), expectedRevision: 2 },
          }),
        )
        return { sessionID, tasks }
      }).pipe(Effect.scoped)
      const test = yield* boot(directory, options)
      const recovered = yield* list(yield* test.request(`/session/${recorded.sessionID}/task`))
      expect(recovered).toEqual(recorded.tasks)
      expect(recovered.map((task) => task.revision)).toEqual([2, 3])
      expect(recovered[1].outputDigest).toBe("durable-child-evidence")
      const database = Context.get(test.context, Database.Service)
      expect(yield* database.db.select().from(SessionInboxTable).all()).toEqual([])
      expect(yield* database.db.select().from(SessionMessageTable).all()).toEqual([])
      expect(yield* database.db.select().from(ScheduleTable).all()).toEqual([])
    }),
  { timeout: 30_000 },
)
