import { expect } from "bun:test"
import path from "node:path"
import { Database } from "@aigcfroge/core/database/database"
import { EventTable, EventSequenceTable } from "@aigcfroge/core/event/sql"
import {
  MetaAgentTable,
  MetaAgentSessionTable,
  MetaAgentStepTable,
  MetaAgentMemoryTable,
} from "@aigcfroge/core/meta-agent/sql"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import {
  SessionTable,
  SessionMessageTable,
  SessionInboxTable,
  SessionPendingTable,
  SessionCompositionSnapshotTable,
} from "@aigcfroge/core/session/sql"
import { Agent } from "@aigcfroge/schema/agent"
import { DelegationID, ParticipantID } from "@aigcfroge/schema/delegation-id"
import { MetaAgent } from "@aigcfroge/schema/meta-agent"
import { Model } from "@aigcfroge/schema/model"
import { Provider } from "@aigcfroge/schema/provider"
import { Session } from "@aigcfroge/schema/session"
import { Global } from "@aigcfroge/util/global"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tempGlobalLayer } from "../../core/test/fixture/global"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"

const SessionResponse = Schema.Struct({ data: Session.Info })
const SessionsResponse = Schema.Struct({ data: Schema.Array(Session.Info) })

const setup = Effect.gen(function* () {
  const directory = (yield* tmpdirScoped()).path
  const context = yield* Layer.build(
    createRoutes(
      {
        app: { version: "test" },
        database: { path: ":memory:" },
        config: { directory: path.join(directory, "config"), project: false, content: "{}" },
        models: { fetch: false },
        fs: { filewatcher: false },
        events: { persist: true },
      },
      () => [],
      [Global.node.replace(tempGlobalLayer)],
    ).pipe(Layer.provide(HttpServer.layerServices)),
  )
  const handler = Context.get(context, HttpRouter.HttpRouter).asHttpEffect().pipe(HttpEffect.toWebHandlerWith(context))
  const request = (route: string, body?: unknown, status = 200) =>
    Effect.promise(async () => {
      const response = await handler(
        new Request(`http://aigcfroge.local${route}`, {
          method: body === undefined ? "GET" : "POST",
          headers: { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      )
      const json: unknown = await response.json()
      expect(response.status).toBe(status)
      return json
    })
  const db = Context.get(context, Database.Service).db
  const snapshot = db
    .transaction(() =>
      Effect.all({
        projects: db.select().from(ProjectTable).all(),
        sessions: db.select().from(SessionTable).all(),
        messages: db.select().from(SessionMessageTable).all(),
        inbox: db.select().from(SessionInboxTable).all(),
        pending: db.select().from(SessionPendingTable).all(),
        compositions: db.select().from(SessionCompositionSnapshotTable).all(),
        metas: db.select().from(MetaAgentTable).all(),
        associations: db.select().from(MetaAgentSessionTable).all(),
        steps: db.select().from(MetaAgentStepTable).all(),
        memories: db.select().from(MetaAgentMemoryTable).all(),
        events: db.select().from(EventTable).all(),
        sequences: db.select().from(EventSequenceTable).all(),
      }),
    )
    .pipe(Effect.orDie)
  // An explicit historical wire sample: it never passes through CPU create.
  const legacy = Schema.decodeUnknownSync(Session.Info)({
    id: Session.ID.create(),
    projectID: "global",
    agent: "build",
    title: "Legacy parent",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1700000000000, updated: 1700000000000 },
  })
  const importSession = (info: Session.Info, status = 200) =>
    request(
      "/api/experimental/session/import",
      { info: Schema.encodeSync(Session.Info)(info), messages: [], location: { directory } },
      status,
    )
  return { request, snapshot, legacy, importSession }
})

it.live("preserves imported parentID through HTTP import, read, and parent filter", () =>
  Effect.gen(function* () {
    const test = yield* setup
    expect(test.legacy.controller).toBeUndefined()
    const parent = Schema.decodeUnknownSync(SessionResponse)(yield* test.importSession(test.legacy))
    const id = Session.ID.create()
    const imported = Schema.decodeUnknownSync(SessionResponse)(
      yield* test.importSession({ ...parent.data, id, parentID: parent.data.id, title: "Imported child" }),
    )
    const read = Schema.decodeUnknownSync(SessionResponse)(yield* test.request(`/api/session/${id}`))
    const children = Schema.decodeUnknownSync(SessionsResponse)(
      yield* test.request(`/api/session?parentID=${parent.data.id}`),
    )
    expect({
      imported: imported.data.parentID,
      read: read.data.parentID,
      children: children.data.map((child) => child.id),
    }).toEqual({ imported: parent.data.id, read: parent.data.id, children: [id] })
    expect(imported.data.controller).toBeUndefined()
    expect(read.data.agent).toBe(Agent.ID.make("build"))
  }).pipe(Effect.scoped),
)
;["missing", "self"].forEach((parent) => {
  it.live(`rejects a ${parent} parent without creating the imported session`, () =>
    Effect.gen(function* () {
      const test = yield* setup
      const id = Session.ID.create()
      const parentID = parent === "self" ? id : Session.ID.create()
      const before = yield* test.snapshot
      const error = yield* test.importSession({ ...test.legacy, id, parentID }, 404)
      expect(error).toMatchObject({ _tag: "SessionNotFoundError", sessionID: parentID })
      expect(yield* test.snapshot).toEqual(before)
      expect(yield* test.request(`/api/session/${id}`, undefined, 404)).toMatchObject({
        _tag: "SessionNotFoundError",
        sessionID: id,
      })
    }).pipe(Effect.scoped),
  )
})
;["root", "child"].forEach((kind) => {
  it.live(`rejects a typed Meta ${kind} import before any database mutation`, () =>
    Effect.gen(function* () {
      const test = yield* setup
      const id = Session.ID.create()
      const rootSessionID = kind === "root" ? id : Session.ID.create()
      const metaAgentID = MetaAgent.ID.descending()
      const controller =
        kind === "root"
          ? new Session.RootController({ kind: "root", metaAgentID, rootSessionID })
          : new Session.ChildController({
              kind: "child",
              metaAgentID,
              rootSessionID,
              executor: new Session.ExecutorBinding({
                agent: Agent.ID.make("build"),
                model: Model.Ref.make({
                  providerID: Provider.ID.make("keeper"),
                  id: Model.ID.make("worker"),
                  variant: Model.VariantID.make("default"),
                }),
                source: "preference",
              }),
              source: new Session.TaskControllerSource({
                kind: "task",
                delegationID: DelegationID.ID.create(),
                participantID: ParticipantID.create(),
              }),
            })
      const info = {
        ...test.legacy,
        id,
        controller,
        agent:
          kind === "root" ? Agent.ID.make("meta") : controller.kind === "child" ? controller.executor.agent : undefined,
        model: controller.kind === "child" ? controller.executor.model : Model.Ref.parse("keeper/cpu#high"),
        parentID: kind === "child" ? rootSessionID : undefined,
      }
      const before = yield* test.snapshot
      expect(yield* test.importSession(info, 400)).toMatchObject({
        _tag: "InvalidRequestError",
        field: "info.controller",
        kind: "meta_import_unsupported",
      })
      expect(yield* test.snapshot).toEqual(before)
      expect(yield* test.request(`/api/session/${id}`, undefined, 404)).toMatchObject({
        _tag: "SessionNotFoundError",
        sessionID: id,
      })
    }).pipe(Effect.scoped),
  )
})
