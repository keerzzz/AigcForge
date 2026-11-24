import { expect } from "bun:test"
import { Session } from "@omnixa/schema/session"
import { SessionConsultation } from "@omnixa/schema/session-consultation"
import { SessionEvent } from "@omnixa/schema/session-event"
import { SessionMessage } from "@omnixa/schema/session-message"
import { Agent } from "@omnixa/schema/agent"
import { SessionsCursor } from "@omnixa/protocol/groups/session"
import { Omnixa } from "@omnixa/client/promise"
import { Context, Effect, Layer, Schema } from "effect"
import { it } from "../../core/test/lib/effect"
import path from "node:path"
import { Database } from "@omnixa/core/database/database"
import { Bus } from "@omnixa/core/bus"
import { Location } from "@omnixa/core/location"
import { LocationServiceMap } from "@omnixa/core/location-service-map"
import { Model } from "@omnixa/core/model"
import { Provider } from "@omnixa/core/provider"
import { Project } from "@omnixa/core/project"
import { SessionInbox } from "@omnixa/core/session/inbox"
import {
  SessionConsultationTable,
  SessionInboxTable,
  SessionMessageTable,
  SessionTable,
} from "@omnixa/core/session/sql"
import { MetaAgentTable, MetaAgentSessionTable } from "@omnixa/core/meta-agent/sql"
import { EventTable } from "@omnixa/core/event/sql"
import { AbsolutePath } from "@omnixa/schema/schema"
import { Global } from "@omnixa/util/global"
import { Hash } from "@omnixa/util/hash"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tempGlobalLayer } from "../../core/test/fixture/global"
import { createLegacySession, useOfflineCatalog } from "../../core/test/fixture/models"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { createRoutes } from "../src/routes"

const SessionResponse = Schema.Struct({ data: Schema.toEncoded(Session.Info) })
const ConsultationResponse = Schema.Struct({ data: Schema.toEncoded(SessionConsultation.Data) })
const ConsultationReadResponse = Schema.Struct({ data: Schema.toEncoded(SessionConsultation.Read) })

const SessionsResponse = Schema.Struct({
  data: Schema.Array(Schema.toEncoded(Session.Info)),
  cursor: Schema.Struct({
    previous: Schema.NullOr(Schema.toEncoded(SessionsCursor)),
    next: Schema.NullOr(Schema.toEncoded(SessionsCursor)),
  }),
})

const setup = (config = "{}") =>
  Effect.gen(function* () {
    const directory = (yield* tmpdirScoped("omnixa-server-create-")).path
    const location = Location.Ref.make({ directory: AbsolutePath.make(directory) })
    const context = yield* Layer.build(
      createRoutes(
        {
          app: { version: "test" },
          database: { path: ":memory:" },
          config: { directory: path.join(directory, "config"), project: false, content: config },
          models: { fetch: false },
          fs: { filewatcher: false },
          events: { persist: true },
        },
        () => [],
        [Global.node.replace(tempGlobalLayer)],
      ).pipe(Layer.provide(HttpServer.layerServices)),
    )
    const model = Model.Ref.parse("server-keeper/meta#default")
    const configureModels = (target: Location.Ref) =>
      useOfflineCatalog([
        {
          info: Provider.Info.make({
            ...Provider.Info.empty(model.providerID),
            activation: "enabled",
            package: "@omnixa/ai/providers/openai/responses",
          }),
          models: [
            Model.Info.make({
              ...Model.Info.default(model.providerID, model.id),
              variants: [{ id: Model.VariantID.make("default") }, { id: Model.VariantID.make("high") }],
            }),
          ],
        },
      ]).pipe(Effect.provide(Context.get(context, LocationServiceMap.Service).get(target)))
    yield* configureModels(location)
    const handler = Context.get(context, HttpRouter.HttpRouter)
      .asHttpEffect()
      .pipe(HttpEffect.toWebHandlerWith(context))
    const consult = (sourceSessionID: string, payload: unknown) =>
      Effect.promise(() =>
        handler(
          new Request(`http://omnixa.local/api/session/${sourceSessionID}/consultation`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          }),
        ),
      )
    const client = Omnixa.make({
      baseUrl: "http://omnixa.local",
      fetch: Object.assign(
        (...args: Parameters<typeof fetch>) => handler(args[0] instanceof Request ? args[0] : new Request(...args)),
        { preconnect: fetch.preconnect },
      ),
    })
    const seed = (
      input: Omit<
        Parameters<typeof createLegacySession>[0],
        "location" | "parentID" | "executor" | "source" | "frozenSnapshot"
      >,
    ) =>
      createLegacySession({ ...input, location }).pipe(
        Effect.provide(context),
        Effect.map(Schema.encodeSync(Session.Info)),
      )
    const db = Context.get(context, Database.Service).db
    const snapshot = Effect.all({
      sessions: db.select().from(SessionTable),
      metas: db.select().from(MetaAgentTable),
      owners: db.select().from(MetaAgentSessionTable),
      events: db.select().from(EventTable),
    }).pipe(Effect.orDie)
    return {
      handler,
      client,
      location,
      model,
      seed,
      snapshot,
      configureModels,
      consult,
      db,
      bus: Context.get(context, Bus.Service),
      projects: Context.get(context, Project.Service),
    }
  })

it.live("forks through a selected HTTP boundary and rejects combined boundaries without admitting work", () =>
  Effect.gen(function* () {
    const test = yield* setup()
    const source = yield* test.seed({
      mode: "work",
      agent: Agent.ID.make("build"),
      model: test.model,
      title: "HTTP fork source",
    })
    const first = yield* Effect.promise(() =>
      test.client.session.prompt({ sessionID: source.id, text: "U1", resume: false }),
    )
    yield* SessionInbox.promote(test.db, test.bus, Session.ID.make(source.id), "steer")
    const second = yield* Effect.promise(() =>
      test.client.session.prompt({ sessionID: source.id, text: "U2", resume: false }),
    )
    yield* SessionInbox.promote(test.db, test.bus, Session.ID.make(source.id), "steer")
    const fork = (payload: unknown) =>
      Effect.promise(() =>
        test.handler(
          new Request(`http://omnixa.local/api/session/${source.id}/fork`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          }),
        ),
      )
    yield* Effect.forEach(
      [
        { payload: { through: first.id }, boundary: { type: "through" as const, messageID: first.id }, text: ["U1"] },
        { payload: { before: second.id }, boundary: { type: "before" as const, messageID: second.id }, text: ["U1"] },
        { payload: {}, boundary: { type: "through" as const, messageID: second.id }, text: ["U1", "U2"] },
      ],
      (selected) =>
        Effect.gen(function* () {
          const response = yield* fork(selected.payload)
          expect(response.status).toBe(200)
          const created = Schema.decodeUnknownSync(SessionResponse)(yield* Effect.promise(() => response.json())).data
          expect(created.fork).toEqual({ sessionID: source.id, boundary: selected.boundary })
          expect(created.mode).toBe(source.mode)
          expect(created.agent).toBe(source.agent)
          expect(created.controller).toBeUndefined()
          expect(created.parentID).toBeUndefined()
          const messages = yield* Effect.promise(() =>
            test.client.message.list({ sessionID: created.id, order: "asc" }),
          )
          expect(messages.data).toHaveLength(selected.text.length)
          expect(messages.data).toMatchObject(selected.text.map((text) => ({ type: "user", text })))
          expect(messages.data.map((message) => message.id)).not.toContain(first.id)
          expect(yield* Effect.promise(() => test.client.session.inbox.list({ sessionID: created.id }))).toEqual([])
          const events = (yield* test.snapshot).events.filter((event) => event.aggregate_id === created.id)
          expect(events).toHaveLength(1)
          expect(events[0]?.type.startsWith("session.forked")).toBe(true)
        }),
    )
    const saved = yield* test.snapshot
    const combined = yield* fork({ before: second.id, through: first.id })
    expect(combined.status).toBe(400)
    expect(yield* Effect.promise(() => combined.json())).toMatchObject({
      _tag: "InvalidRequestError",
      kind: "fork_conflict",
    })
    expect(yield* test.snapshot).toEqual(saved)
    const missing = yield* fork({ through: SessionMessage.ID.create() })
    expect(missing.status).toBe(404)
    expect(yield* test.snapshot).toEqual(saved)
  }).pipe(Effect.scoped),
)

it.live("creates an admit-only ordinary consultation and preserves its first admission on retry", () =>
  Effect.gen(function* () {
    const test = yield* setup()
    const source = yield* Effect.promise(() =>
      test.client.session.create({ location: test.location, model: test.model, agent: "meta", title: "Source root" }),
    )
    const sourceInput = yield* Effect.promise(() =>
      test.client.session.prompt({ sessionID: source.id, text: "Frozen source question", resume: false }),
    )
    yield* SessionInbox.promote(test.db, test.bus, Session.ID.make(source.id), "steer")
    const sourceBefore = yield* Effect.promise(() => test.client.session.get({ sessionID: source.id }))
    const sourceEvents = (yield* test.snapshot).events.filter((event) => event.aggregate_id === source.id)
    const input = SessionConsultation.Input.make({
      id: Session.ID.create(),
      boundary: { type: "through", messageID: SessionMessage.ID.make(sourceInput.id) },
      agent: Agent.ID.make("build"),
      model: test.model,
      title: "Consulted question",
      prompt: {
        id: SessionMessage.ID.create(),
        text: "Check the source question",
        metadata: { keeper: "first" },
        delivery: "queue",
      },
      resume: false,
    })
    const response = yield* test.consult(source.id, input)
    expect(response.status).toBe(200)
    const created = Schema.decodeUnknownSync(ConsultationResponse)(yield* Effect.promise(() => response.json())).data
    expect(created.session).toMatchObject({
      id: input.id,
      mode: "chat",
      agent: "build",
      model: test.model,
      title: input.title,
      location: sourceBefore.location,
    })
    expect(created.session.parentID).toBeUndefined()
    expect(created.session.fork).toBeUndefined()
    expect(created.session.controller).toBeUndefined()
    expect(created.session.executorPreference).toBeUndefined()
    expect(created.reference).toMatchObject({ sourceSessionID: source.id, boundary: input.boundary })
    expect(created.reference.sourceMessageIDs).toContain(sourceInput.id)
    expect(created.reference.file).toMatchObject({ mime: "text/plain", source: { type: "inline" } })
    expect(Buffer.from(created.reference.file.data, "base64").toString("utf8")).toContain("Frozen source question")
    expect(created.reference.digest).toBe(Hash.sha256(Buffer.from(created.reference.file.data, "base64")))
    expect(created.admission).toMatchObject({
      state: "pending",
      input: {
        id: input.prompt.id,
        sessionID: input.id,
        delivery: "queue",
        payload: { text: input.prompt.text, metadata: { keeper: "first" }, files: [created.reference.file] },
      },
    })
    const pending = yield* Effect.promise(() => test.client.session.inbox.list({ sessionID: input.id }))
    expect(Schema.decodeUnknownSync(Schema.Array(Schema.toEncoded(SessionInbox.Info)))(pending)).toEqual(
      created.admission.state === "pending" ? [created.admission.input] : [],
    )
    const beforeRetry = yield* test.snapshot
    const retried = yield* test.consult(source.id, {
      ...input,
      agent: "plan",
      title: "Changed retry title",
      prompt: { ...input.prompt, text: "Changed retry question", metadata: { keeper: "retry" } },
    })
    expect(retried.status).toBe(200)
    expect(Schema.decodeUnknownSync(ConsultationResponse)(yield* Effect.promise(() => retried.json())).data).toEqual(
      created,
    )
    expect(yield* test.snapshot).toEqual(beforeRetry)
    expect((yield* test.snapshot).events.filter((event) => event.aggregate_id === source.id)).toEqual(sourceEvents)
    expect(yield* Effect.promise(() => test.client.session.get({ sessionID: source.id }))).toEqual(sourceBefore)
  }).pipe(Effect.scoped),
)

it.live("SC07 reads a consultation reference and first state without admitting work after source deletion", () =>
  Effect.gen(function* () {
    const test = yield* setup()
    const source = yield* test.seed({ agent: Agent.ID.make("build"), title: "Readonly consultation source" })
    const sourceInput = yield* Effect.promise(() =>
      test.client.session.prompt({ sessionID: source.id, text: "SC07 frozen readonly reference", resume: false }),
    )

    yield* SessionInbox.promote(test.db, test.bus, Session.ID.make(source.id), "steer")

    const input = SessionConsultation.Input.make({
      id: Session.ID.create(),
      boundary: { type: "through", messageID: SessionMessage.ID.make(sourceInput.id) },
      agent: Agent.ID.make("build"),
      model: test.model,
      prompt: { id: SessionMessage.ID.create(), text: "Keep this first question pending" },
      resume: false,
    })
    const response = yield* test.consult(source.id, input)

    expect(response.status).toBe(200)

    const created = Schema.decodeUnknownSync(ConsultationResponse)(yield* Effect.promise(() => response.json())).data
    const read = (sessionID: string) =>
      Effect.promise(() => test.handler(new Request(`http://omnixa.local/api/session/${sessionID}/consultation`)))
    const snapshot = Effect.all({
      state: test.snapshot,
      consultation: test.db.select().from(SessionConsultationTable),
      inbox: test.db.select().from(SessionInboxTable),
      messages: test.db.select().from(SessionMessageTable),
    }).pipe(Effect.orDie)

    const beforeReads = yield* snapshot
    const pending = yield* read(input.id)

    expect(pending.status).toBe(200)
    expect(
      Schema.decodeUnknownSync(ConsultationReadResponse)(yield* Effect.promise(() => pending.json())).data,
    ).toEqual({
      reference: created.reference,
      admission: created.admission,
    })

    for (const sessionID of [source.id, Session.ID.create()]) {
      expect((yield* read(sessionID)).status).toBe(404)
    }

    expect(yield* snapshot).toEqual(beforeReads)

    yield* Effect.promise(() => test.client.session.inbox.cancel({ sessionID: input.id, inboxID: input.prompt.id }))
    yield* Effect.promise(() => test.client.session.remove({ sessionID: source.id }))

    const beforeCancelledRead = yield* snapshot
    const cancelled = Schema.decodeUnknownSync(ConsultationReadResponse.fields.data)(
      yield* Effect.promise(() => test.client.session.getConsultation({ sessionID: input.id })),
    )

    expect(cancelled).toEqual({
      reference: created.reference,
      admission: { state: "cancelled", id: input.prompt.id },
    })
    expect(yield* snapshot).toEqual(beforeCancelledRead)
    expect(beforeCancelledRead.consultation.map((record) => record.session_id)).toEqual([input.id])

    yield* test.db.update(SessionConsultationTable).set({ reference_file: null }).run().pipe(Effect.orDie)

    const beforeConflict = yield* snapshot
    const conflict = yield* read(input.id)

    expect(conflict.status).toBe(409)
    expect(yield* Effect.promise(() => conflict.json())).toMatchObject({ _tag: "ConflictError", resource: input.id })
    expect(yield* snapshot).toEqual(beforeConflict)
  }).pipe(Effect.scoped),
)

for (const sourceState of ["deleted", "moved"] as const)
  it.live(`recovers a consultation through HTTP after its source is ${sourceState}`, () =>
    Effect.gen(function* () {
      const test = yield* setup()
      const source = yield* test.seed({ agent: Agent.ID.make("build"), title: "Recoverable source" })
      const sourceInput = yield* Effect.promise(() =>
        test.client.session.prompt({
          sessionID: source.id,
          text: "Saved reference survives the source",
          resume: false,
        }),
      )
      yield* SessionInbox.promote(test.db, test.bus, Session.ID.make(source.id), "steer")
      const input = SessionConsultation.Input.make({
        id: Session.ID.create(),
        boundary: { type: "through", messageID: SessionMessage.ID.make(sourceInput.id) },
        agent: Agent.ID.make("build"),
        model: test.model,
        prompt: { id: SessionMessage.ID.create(), text: "Consult the saved prefix" },
        resume: false,
      })
      const response = yield* test.consult(source.id, input)
      expect(response.status).toBe(200)
      const created = Schema.decodeUnknownSync(ConsultationResponse)(yield* Effect.promise(() => response.json())).data
      if (sourceState === "deleted") yield* Effect.promise(() => test.client.session.remove({ sessionID: source.id }))
      if (sourceState === "moved") {
        const destination = Location.Ref.make({
          directory: AbsolutePath.make((yield* tmpdirScoped("omnixa-consultation-moved-")).path),
        })
        const project = yield* test.projects.resolve(destination.directory)
        yield* test.bus.publish(SessionEvent.Moved, {
          sessionID: Session.ID.make(source.id),
          location: destination,
          projectID: project.id,
        })
        expect(yield* Effect.promise(() => test.client.session.get({ sessionID: source.id }))).toMatchObject({
          location: { directory: destination.directory },
        })
      }
      const beforeRetry = yield* test.snapshot
      const retry = yield* test.consult(source.id, input)
      expect(retry.status).toBe(200)
      expect(Schema.decodeUnknownSync(ConsultationResponse)(yield* Effect.promise(() => retry.json())).data).toEqual(
        created,
      )
      expect(yield* test.snapshot).toEqual(beforeRetry)
      const conflict = yield* test.consult(source.id, {
        ...input,
        prompt: { ...input.prompt, id: SessionMessage.ID.create() },
      })
      expect(conflict.status).toBe(409)
      expect(yield* Effect.promise(() => conflict.json())).toMatchObject({ _tag: "ConflictError", resource: input.id })
      const crossSource = yield* test.consult(Session.ID.create(), input)
      expect(crossSource.status).toBe(409)
      expect(yield* Effect.promise(() => crossSource.json())).toMatchObject({
        _tag: "ConflictError",
        resource: input.id,
      })
    }).pipe(Effect.scoped),
  )

for (const state of ["promoted", "cancelled"] as const)
  it.live(`returns a ${state} consultation admission as a read-only HTTP retry`, () =>
    Effect.gen(function* () {
      const test = yield* setup()
      const source = yield* test.seed({ agent: Agent.ID.make("build"), title: "Terminal retry source" })
      const sourceInput = yield* Effect.promise(() =>
        test.client.session.prompt({ sessionID: source.id, text: "Terminal retry reference", resume: false }),
      )
      yield* SessionInbox.promote(test.db, test.bus, Session.ID.make(source.id), "steer")
      const input = SessionConsultation.Input.make({
        id: Session.ID.create(),
        boundary: { type: "through", messageID: SessionMessage.ID.make(sourceInput.id) },
        agent: Agent.ID.make("build"),
        model: test.model,
        prompt: { id: SessionMessage.ID.create(), text: "Terminal first question" },
        resume: false,
      })
      const response = yield* test.consult(source.id, input)
      expect(response.status).toBe(200)
      const created = Schema.decodeUnknownSync(ConsultationResponse)(yield* Effect.promise(() => response.json())).data
      if (state === "promoted") yield* SessionInbox.promote(test.db, test.bus, input.id, "steer")
      if (state === "cancelled")
        yield* Effect.promise(() => test.client.session.inbox.cancel({ sessionID: input.id, inboxID: input.prompt.id }))
      const beforeRetry = yield* test.snapshot
      const retry = yield* test.consult(source.id, { ...input, resume: true })
      expect(retry.status).toBe(200)
      const recovered = Schema.decodeUnknownSync(ConsultationResponse)(yield* Effect.promise(() => retry.json())).data
      expect(recovered.reference).toEqual(created.reference)
      expect(recovered.admission.state).toBe(state)
      if (recovered.admission.state === "promoted")
        expect(recovered.admission.input).toMatchObject({
          id: input.prompt.id,
          type: "user",
          text: input.prompt.text,
          files: [created.reference.file],
        })
      if (recovered.admission.state === "cancelled")
        expect(recovered.admission).toEqual({ state: "cancelled", id: input.prompt.id })
      expect(yield* test.snapshot).toEqual(beforeRetry)
    }).pipe(Effect.scoped),
  )

it.live("maps consultation source, boundary, Agent, and target identity failures to typed HTTP errors", () =>
  Effect.gen(function* () {
    const test = yield* setup()
    const source = yield* test.seed({ agent: Agent.ID.make("build"), title: "Error mapping source" })
    const other = yield* test.seed({ agent: Agent.ID.make("build"), title: "Other boundary source" })
    const sourceInput = yield* Effect.promise(() =>
      test.client.session.prompt({ sessionID: source.id, text: "Source boundary", resume: false }),
    )
    const otherInput = yield* Effect.promise(() =>
      test.client.session.prompt({ sessionID: other.id, text: "Other source boundary", resume: false }),
    )
    yield* SessionInbox.promote(test.db, test.bus, Session.ID.make(source.id), "steer")
    yield* SessionInbox.promote(test.db, test.bus, Session.ID.make(other.id), "steer")
    const runningID = SessionMessage.ID.create()
    yield* test.bus.publish(SessionEvent.Step.Started, {
      sessionID: Session.ID.make(source.id),
      assistantMessageID: runningID,
      agent: Agent.ID.make("build"),
      model: test.model,
      started: 0,
    })
    const input = SessionConsultation.Input.make({
      id: Session.ID.create(),
      boundary: { type: "through", messageID: SessionMessage.ID.make(sourceInput.id) },
      agent: Agent.ID.make("build"),
      model: test.model,
      prompt: { id: SessionMessage.ID.create(), text: "Invalid consultation" },
      resume: false,
    })
    const missingSource = Session.ID.create()
    const missingBoundary = SessionMessage.ID.create()
    yield* Effect.forEach(
      [
        {
          sourceSessionID: missingSource,
          payload: input,
          status: 404,
          error: { _tag: "SessionNotFoundError", sessionID: missingSource },
        },
        {
          sourceSessionID: source.id,
          payload: { ...input, boundary: { type: "through", messageID: missingBoundary } },
          status: 404,
          error: { _tag: "MessageNotFoundError", messageID: missingBoundary },
        },
        {
          sourceSessionID: source.id,
          payload: { ...input, boundary: { type: "through", messageID: otherInput.id } },
          status: 400,
          error: { _tag: "InvalidRequestError", field: "boundary" },
        },
        {
          sourceSessionID: source.id,
          payload: { ...input, boundary: { type: "through", messageID: runningID } },
          status: 400,
          error: { _tag: "InvalidRequestError", field: "boundary" },
        },
        {
          sourceSessionID: source.id,
          payload: { ...input, agent: "meta" },
          status: 400,
          error: { _tag: "InvalidRequestError", field: "agent" },
        },
        {
          sourceSessionID: source.id,
          payload: { ...input, agent: "keeper-missing-agent" },
          status: 400,
          error: { _tag: "InvalidRequestError", field: "agent" },
        },
        {
          sourceSessionID: source.id,
          payload: { ...input, id: other.id },
          status: 409,
          error: { _tag: "ConflictError", resource: other.id },
        },
      ],
      (item) =>
        Effect.gen(function* () {
          const response = yield* test.consult(item.sourceSessionID, item.payload)
          expect(response.status).toBe(item.status)
          expect(yield* Effect.promise(() => response.json())).toMatchObject(item.error)
        }),
    )
  }).pipe(Effect.scoped),
)

it.live("serializes builtin protocol cards through the Agent HTTP and generated client boundary", () =>
  Effect.gen(function* () {
    const test = yield* setup()
    const listed = yield* Effect.promise(() => test.client.agent.list({ location: test.location }))
    for (const id of ["build", "plan", "general", "explore"]) {
      expect(listed.data.find((agent) => agent.id === id)?.card).toMatchObject({
        capabilities: expect.any(Array),
        constraints: expect.any(Array),
        protocol: expect.any(String),
      })
    }
    expect(listed.data.find((agent) => agent.id === "build")?.mode).toBe("all")
    expect(listed.data.find((agent) => agent.id === "plan")?.mode).toBe("primary")
  }).pipe(Effect.scoped),
)

it.live("creates a child at its parent's location and lists it under the parent", () =>
  Effect.gen(function* () {
    const test = yield* setup()
    const handler = test.handler
    const create = (body: Record<string, unknown>) =>
      Effect.promise(async () => {
        const response = await handler(
          new Request("http://omnixa.local/api/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ location: test.location, model: test.model, ...body }),
          }),
        )
        expect(response.status).toBe(200)
        return Schema.decodeUnknownSync(SessionResponse)(await response.json()).data
      })
    const parent = yield* test.seed({ title: "Parent" })
    expect(parent.mode).toBe("coding")
    const child = yield* create({ parentID: parent.id, title: "Child", location: { directory: "/unused" } })
    const response = yield* Effect.promise(() =>
      handler(new Request(`http://omnixa.local/api/session?parentID=${parent.id}`)),
    )
    expect(response.status).toBe(200)
    const children = Schema.decodeUnknownSync(SessionsResponse)(yield* Effect.promise(() => response.json()))

    expect(child).toMatchObject({ parentID: parent.id, location: parent.location })
    expect(children.data.map((session) => session.id)).toEqual([child.id])
  }).pipe(Effect.scoped),
)

it.live("returns not found when creating a child of a missing session", () =>
  Effect.gen(function* () {
    const test = yield* setup()
    const handler = test.handler
    const parentID = Session.ID.create()
    const response = yield* Effect.promise(() =>
      handler(
        new Request("http://omnixa.local/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ parentID, title: "Child" }),
        }),
      ),
    )
    expect(response.status).toBe(404)
    expect(yield* Effect.promise(() => response.json())).toMatchObject({
      _tag: "SessionNotFoundError",
      sessionID: parentID,
    })
  }).pipe(Effect.scoped),
)

it.live("consumes configured default Plan through HTTP creation and canonical readback", () =>
  Effect.gen(function* () {
    const test = yield* setup(JSON.stringify({ default_agent: "plan" }))
    const agents = yield* Effect.promise(() => test.client.agent.list({ location: test.location }))
    expect(agents.data[0]?.id).toBe("plan")
    expect(agents.data.map((agent) => agent.id)).toEqual(expect.arrayContaining(["build", "plan", "meta"]))
    const created = yield* Effect.promise(() =>
      test.client.session.create({ location: test.location, model: test.model, title: "Configured Plan" }),
    )
    expect(created).toMatchObject({ agent: "plan", mode: "coding", model: test.model })
    expect(created.controller).toBeUndefined()
    expect(created.executorPreference).toBeUndefined()
    expect(yield* Effect.promise(() => test.client.session.get({ sessionID: created.id }))).toEqual(created)
    const snapshot = yield* test.snapshot
    expect(snapshot.metas).toEqual([])
    expect(snapshot.owners).toEqual([])
    expect(snapshot.events.some((event) => event.type.startsWith("session.execution."))).toBe(false)
    const inbox = yield* Effect.promise(() => test.client.session.inbox.list({ sessionID: created.id }))
    expect(inbox.every((item) => item.type === "synthetic")).toBe(true)
  }).pipe(Effect.scoped),
)

it.live("activates Meta on an ordinary Build root through HTTP without changing its captured model", () =>
  Effect.gen(function* () {
    const test = yield* setup()
    const model = Model.Ref.make({ ...test.model, variant: Model.VariantID.make("high") })
    const created = yield* Effect.promise(() =>
      test.client.session.create({ location: test.location, mode: "coding", agent: "build", model }),
    )
    expect(created.controller).toBeUndefined()
    expect((yield* test.snapshot).metas).toEqual([])
    yield* Effect.promise(() => test.client.session.switchAgent({ sessionID: created.id, agent: "meta" }))
    const selected = yield* Effect.promise(() => test.client.session.get({ sessionID: created.id }))
    expect(selected).toMatchObject({
      id: created.id,
      mode: created.mode,
      agent: "meta",
      model,
      controller: { kind: "root", rootSessionID: created.id },
    })
    expect(selected.executorPreference).toBeUndefined()
    const snapshot = yield* test.snapshot
    expect(snapshot.metas).toMatchObject([{ id: selected.controller?.metaAgentID }])
    expect(snapshot.owners).toMatchObject([
      { meta_agent_id: selected.controller?.metaAgentID, session_id: created.id, role: "orchestrator" },
    ])
    expect(snapshot.events.some((event) => event.type.startsWith("session.execution."))).toBe(false)
    yield* Effect.promise(() => test.client.session.switchAgent({ sessionID: created.id, agent: "meta" }))
    expect(yield* Effect.promise(() => test.client.session.get({ sessionID: created.id }))).toEqual(selected)
    expect(yield* test.snapshot).toEqual(snapshot)
  }).pipe(Effect.scoped),
)

for (const mode of ["chat", "coding", "work", "assistant"] as const)
  it.live(`preserves ordinary Agent creation and switching in ${mode}`, () =>
    Effect.gen(function* () {
      const test = yield* setup()
      const model = Model.Ref.make({ ...test.model, variant: Model.VariantID.make("high") })
      yield* Effect.forEach(["build", "plan", "meta"] as const, (agent) =>
        Effect.gen(function* () {
          const created = yield* Effect.promise(() =>
            test.client.session.create({ location: test.location, mode, agent, model, title: `${mode} ${agent}` }),
          )
          expect(created).toMatchObject({ mode, agent, model })
          expect(created.executorPreference).toBeUndefined()
          expect(yield* Effect.promise(() => test.client.session.get({ sessionID: created.id }))).toEqual(created)
          if (agent !== "meta") {
            expect(created.controller).toBeUndefined()
            const selected = agent === "build" ? "plan" : "build"
            yield* Effect.promise(() => test.client.session.switchAgent({ sessionID: created.id, agent: selected }))
            const read = yield* Effect.promise(() => test.client.session.get({ sessionID: created.id }))
            expect(read).toMatchObject({ id: created.id, mode, agent: selected, model })
            expect(read.controller).toBeUndefined()
            expect(read.executorPreference).toBeUndefined()
            const snapshot = yield* test.snapshot
            expect(snapshot.metas).toEqual([])
            expect(snapshot.owners).toEqual([])
            return
          }
          expect(created.controller).toMatchObject({ kind: "root", rootSessionID: created.id })
          const before = yield* test.snapshot
          expect(before.metas).toHaveLength(1)
          expect(before.owners).toMatchObject([{ session_id: created.id, role: "orchestrator" }])
          yield* Effect.forEach(["build", "plan", "meta"] as const, (selected) =>
            Effect.gen(function* () {
              yield* Effect.promise(() => test.client.session.switchAgent({ sessionID: created.id, agent: selected }))
              const read = yield* Effect.promise(() => test.client.session.get({ sessionID: created.id }))
              expect(read).toMatchObject({
                id: created.id,
                mode,
                agent: selected,
                model,
                controller: created.controller,
              })
              expect(read.executorPreference).toBeUndefined()
            }),
          )
          const after = yield* test.snapshot
          expect(after.metas).toEqual(before.metas)
          expect(after.owners).toEqual(before.owners)
        }),
      )
      const snapshot = yield* test.snapshot
      expect(snapshot.events.some((event) => event.type.startsWith("session.execution."))).toBe(false)
    }).pipe(Effect.scoped),
  )

for (const mode of ["chat", "coding", "work", "assistant"] as const)
  it.live(`persists the requested product mode ${mode} with canonical Meta and executor domains`, () =>
    Effect.gen(function* () {
      const test = yield* setup()
      const client = test.client
      const input = {
        mode,
        agent: "meta",
        control: "meta" as const,
        model: test.model,
        executorPreference: { agent: "build" },
        location: test.location,
        title: `Mode ${mode}`,
      }
      const created = yield* Effect.promise(() => client.session.create(input))
      expect(created).toMatchObject({
        mode,
        agent: "meta",
        model: test.model,
        executorPreference: { agent: "build" },
        controller: { kind: "root", rootSessionID: created.id },
      })
      expect(yield* Effect.promise(() => client.session.get({ sessionID: created.id }))).toMatchObject({
        id: created.id,
        mode,
        agent: "meta",
        model: test.model,
        executorPreference: { agent: "build" },
      })
    }).pipe(Effect.scoped),
  )

it.live("preserves a stored directory alias when creating and reading a Meta root", () =>
  Effect.gen(function* () {
    const test = yield* setup()
    const location = Location.Ref.make({ directory: AbsolutePath.make(`${test.location.directory}${path.sep}.`) })
    // The alias is a distinct Location graph on Linux; configure its actual catalog.
    yield* test.configureModels(location)
    const response = yield* Effect.promise(() =>
      test.handler(
        new Request("http://omnixa.local/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            location,
            model: test.model,
            agent: "meta",
            control: "meta",
            title: "Alias Meta root",
          }),
        }),
      ),
    )
    expect(response.status).toBe(200)
    const created = Schema.decodeUnknownSync(SessionResponse)(yield* Effect.promise(() => response.json())).data
    expect(created).toMatchObject({
      location: { directory: location.directory },
      agent: "meta",
      model: test.model,
      controller: { kind: "root", rootSessionID: created.id },
    })
    expect((yield* test.snapshot).sessions).toMatchObject([
      {
        id: created.id,
        directory: location.directory,
        agent: "meta",
        model: test.model,
        controller: { kind: "root", rootSessionID: created.id },
      },
    ])
    const read = yield* Effect.promise(() => test.handler(new Request(`http://omnixa.local/api/session/${created.id}`)))
    expect(read.status).toBe(200)
    expect(Schema.decodeUnknownSync(SessionResponse)(yield* Effect.promise(() => read.json())).data).toEqual(created)
  }).pipe(Effect.scoped),
)

for (const mode of ["unknown-mode", "custom"] as const)
  it.live(`rejects ordinary root creation in ${mode} without persisting a fallback session`, () =>
    Effect.gen(function* () {
      const test = yield* setup()
      const handler = test.handler
      const response = yield* Effect.promise(() =>
        handler(
          new Request("http://omnixa.local/api/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mode, title: "Rejected mode" }),
          }),
        ),
      )
      expect(response.status).toBe(400)
      const read = yield* Effect.promise(() => handler(new Request("http://omnixa.local/api/session")))
      expect(read.status).toBe(200)
      expect(Schema.decodeUnknownSync(SessionsResponse)(yield* Effect.promise(() => read.json())).data).toEqual([])
    }).pipe(Effect.scoped),
  )

it.live("inherits the parent's mode and adopts an existing ID without reclassification", () =>
  Effect.gen(function* () {
    const test = yield* setup()
    const handler = test.handler
    const create = (body: Record<string, unknown>) =>
      Effect.promise(async () => {
        const response = await handler(
          new Request("http://omnixa.local/api/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ location: test.location, model: test.model, ...body }),
          }),
        )
        expect(response.status).toBe(200)
        return Schema.decodeUnknownSync(SessionResponse)(await response.json()).data
      })
    const parent = yield* test.seed({ mode: "work", agent: Agent.ID.make("build"), title: "Mode parent" })
    expect(parent).toMatchObject({ mode: "work", agent: "build" })
    const child = yield* create({ parentID: parent.id, mode: "chat", agent: "plan" })
    expect(child).toMatchObject({ parentID: parent.id, mode: "work", agent: "plan", location: parent.location })
    expect(yield* create({ id: parent.id, mode: "assistant", agent: "plan" })).toEqual(parent)
    const read = yield* Effect.promise(() => handler(new Request(`http://omnixa.local/api/session/${parent.id}`)))
    expect(Schema.decodeUnknownSync(SessionResponse)(yield* Effect.promise(() => read.json())).data).toEqual(parent)
  }).pipe(Effect.scoped),
)

it.live("routes Session.list mode through cursors without narrowing omitted or exact reads", () =>
  Effect.gen(function* () {
    const test = yield* setup()
    const handler = test.handler

    const create = (body: Record<string, unknown>) =>
      Effect.promise(async () => {
        const response = await handler(
          new Request("http://omnixa.local/api/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ location: test.location, model: test.model, ...body }),
          }),
        )

        expect(response.status).toBe(200)

        return Schema.decodeUnknownSync(SessionResponse)(await response.json()).data
      })

    const list = (query: URLSearchParams) =>
      Effect.promise(async () => {
        const response = await handler(new Request("http://omnixa.local/api/session?" + query.toString()))

        expect(response.status).toBe(200)

        return Schema.decodeUnknownSync(SessionsResponse)(await response.json())
      })

    const parent = yield* test.seed({ id: Session.ID.make("ses_list_work_a"), mode: "work", title: "Work A" })
    yield* create({ id: "ses_list_work_b", mode: "work", title: "Work B" })
    yield* create({ id: "ses_list_coding", mode: "coding", title: "Coding" })
    yield* create({ id: "ses_list_chat", mode: "chat", title: "Chat" })
    yield* create({ id: "ses_list_assistant", mode: "assistant", title: "Assistant" })
    yield* create({ id: "ses_list_work_child", parentID: parent.id, title: "Work child" })

    const inventory = yield* list(new URLSearchParams({ limit: "50" }))

    expect(inventory.data.map((session) => session.id).toSorted()).toEqual([
      "ses_list_assistant",
      "ses_list_chat",
      "ses_list_coding",
      "ses_list_work_a",
      "ses_list_work_b",
      "ses_list_work_child",
    ])

    const first = yield* list(new URLSearchParams({ mode: "work", parentID: "null", limit: "1" }))

    expect(first.data).toHaveLength(1)
    expect(first.data.map((session) => session.mode)).toEqual(["work"])
    expect(first.cursor.next).toBeDefined()

    if (!first.cursor.next) throw new Error("Expected a filtered next cursor")
    const next = yield* list(new URLSearchParams({ cursor: first.cursor.next, limit: "1" }))

    expect(next.data).toHaveLength(1)
    expect(next.data.map((session) => session.mode)).toEqual(["work"])
    expect([...first.data, ...next.data].map((session) => session.id).toSorted()).toEqual([
      "ses_list_work_a",
      "ses_list_work_b",
    ])

    const conflicting = yield* list(new URLSearchParams({ cursor: first.cursor.next, mode: "coding", limit: "1" }))

    expect(conflicting.data).toHaveLength(1)
    expect(conflicting.data.map((session) => session.mode)).toEqual(["work"])
    expect(next.cursor.next).toBeDefined()

    if (!next.cursor.next) throw new Error("Expected the final filtered cursor")
    const end = yield* list(new URLSearchParams({ cursor: next.cursor.next, limit: "1" }))

    expect(end.data).toEqual([])
    expect(end.cursor.previous).toBeNull()
    expect(end.cursor.next).toBeNull()

    const directory = yield* list(
      new URLSearchParams({
        mode: "work",
        directory: parent.location.directory,
        search: "Work A",
        parentID: "null",
      }),
    )
    const project = yield* list(
      new URLSearchParams({
        mode: "work",
        project: parent.projectID,
        search: "Work A",
        parentID: "null",
      }),
    )

    expect(directory.data.map((session) => session.id)).toEqual(["ses_list_work_a"])
    expect(project.data.map((session) => session.id)).toEqual(["ses_list_work_a"])
    expect((yield* list(new URLSearchParams({ mode: "coding", parentID: parent.id }))).data).toEqual([])
    expect((yield* list(new URLSearchParams({ parentID: parent.id }))).data.map((session) => session.id)).toEqual([
      "ses_list_work_child",
    ])
    expect((yield* list(new URLSearchParams({ mode: "custom" }))).data).toEqual([])

    const exact = yield* Effect.promise(() => handler(new Request("http://omnixa.local/api/session/ses_list_coding")))

    expect(exact.status).toBe(200)
    expect(Schema.decodeUnknownSync(SessionResponse)(yield* Effect.promise(() => exact.json())).data).toMatchObject({
      id: "ses_list_coding",
      mode: "coding",
    })

    const invalid = yield* Effect.promise(() =>
      handler(new Request("http://omnixa.local/api/session?mode=unknown-mode")),
    )

    expect(invalid.status).toBe(400)

    const client = Omnixa.make({
      baseUrl: "http://omnixa.local",
      fetch: Object.assign(
        (...args: Parameters<typeof fetch>) => handler(args[0] instanceof Request ? args[0] : new Request(...args)),
        { preconnect: fetch.preconnect },
      ),
    })
    const generated = yield* Effect.promise(() => client.session.list({ mode: "work", parentID: null, limit: 1 }))

    expect(generated.data).toHaveLength(1)
    expect(generated.data.map((session) => session.mode)).toEqual(["work"])

    const generatedCursor = generated.cursor.next

    if (!generatedCursor) throw new Error("Expected the generated Client filtered cursor")

    const generatedNext = yield* Effect.promise(() =>
      client.session.list({ cursor: generatedCursor, mode: "coding", limit: 1 }),
    )

    expect(generatedNext.data.map((session) => session.mode)).toEqual(["work"])
    expect((yield* Effect.promise(() => client.session.list())).data.map((session) => session.id).toSorted()).toEqual(
      inventory.data.map((session) => session.id).toSorted(),
    )
  }).pipe(Effect.scoped),
)

it.live("rejects a raw Meta child and preserves ordinary Build creation with an obsolete control hint", () =>
  Effect.gen(function* () {
    const test = yield* setup()
    const parentResponse = yield* Effect.promise(() =>
      test.handler(
        new Request("http://omnixa.local/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ location: test.location, model: test.model, agent: "meta" }),
        }),
      ),
    )
    expect(parentResponse.status).toBe(200)
    const parent = Schema.decodeUnknownSync(SessionResponse)(yield* Effect.promise(() => parentResponse.json())).data
    const before = yield* test.snapshot
    const response = yield* Effect.promise(() =>
      test.handler(
        new Request("http://omnixa.local/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ parentID: parent.id }),
        }),
      ),
    )
    expect(response.status).toBe(400)
    expect(yield* Effect.promise(() => response.json())).toMatchObject({
      _tag: "InvalidRequestError",
      kind: "meta_child_source_required",
      field: "parentID",
    })
    expect(yield* test.snapshot).toEqual(before)
    const ordinaryResponse = yield* Effect.promise(() =>
      test.handler(
        new Request("http://omnixa.local/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            location: test.location,
            model: test.model,
            agent: "build",
            control: "meta",
            executorPreference: { agent: "build" },
          }),
        }),
      ),
    )
    expect(ordinaryResponse.status).toBe(200)
    const ordinary = Schema.decodeUnknownSync(SessionResponse)(
      yield* Effect.promise(() => ordinaryResponse.json()),
    ).data
    expect(ordinary.agent).toBe("build")
    expect(ordinary.controller).toBeUndefined()
    expect(ordinary.executorPreference).toBeUndefined()
    const after = yield* test.snapshot
    expect(after.metas).toEqual(before.metas)
    expect(after.owners).toEqual(before.owners)
  }).pipe(Effect.scoped),
)
