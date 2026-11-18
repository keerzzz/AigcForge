import path from "node:path"
import { expect } from "bun:test"
import { Bus } from "@aigcfroge/core/bus"
import { LocationServiceMap } from "@aigcfroge/core/location-service-map"
import { Permission } from "@aigcfroge/core/permission"
import { Location } from "@aigcfroge/schema/location"
import { OperationSource, ToolSource } from "@aigcfroge/schema/permission"
import { AbsolutePath } from "@aigcfroge/schema/schema"
import { SessionID } from "@aigcfroge/schema/session-id"
import { SessionTask } from "@aigcfroge/schema/session-task"
import { Global } from "@aigcfroge/util/global"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tempGlobalLayer } from "../../core/test/fixture/global"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"

const requestsFromJson = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Array(Permission.Request) }))

const boot = () =>
  Effect.gen(function* () {
    const directory = (yield* tmpdirScoped("aigcfroge-permission-source-")).path
    const location = Location.Ref.make({ directory: AbsolutePath.make(directory) })
    const context = yield* Layer.build(
      createRoutes(
        {
          password: "secret",
          database: { path: ":memory:" },
          config: { directory: path.join(directory, "config"), project: false, content: "{}" },
          models: { fetch: false },
          fs: { filewatcher: false },
        },
        () => [],
        [Global.node.replace(tempGlobalLayer)],
      ).pipe(Layer.provide(HttpServer.layerServices)),
    )
    const handler = Context.get(context, HttpRouter.HttpRouter)
      .asHttpEffect()
      .pipe(HttpEffect.toWebHandlerWith(context))
    const request = (route: string, body?: unknown) =>
      Effect.promise(() => {
        const url = new URL(route, "http://aigcfroge.local")
        url.searchParams.set("directory", directory)
        return handler(
          new Request(url, {
            method: body === undefined ? "GET" : "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Basic ${btoa("aigcfroge:secret")}`,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        )
      })
    const created = yield* request("/api/session", {
      location,
      agent: "build",
      permissions: [{ action: "source-boundary", resource: "*", effect: "ask" }],
    })
    expect(created.status).toBe(200)
    const sessionID = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Struct({ id: SessionID }) }))(
      yield* Effect.promise(() => created.json()),
    ).data.id
    const locationContext = yield* Context.get(context, LocationServiceMap.Service).contextEffect(location)
    return {
      request,
      sessionID,
      locationContext,
      permission: Context.get(locationContext, Permission.Service),
      bus: Context.get(context, Bus.Service),
    }
  })

it.live("Permission HTTP accepts legacy Tool sources and rejects forged operation sources", () =>
  Effect.gen(function* () {
    const test = yield* boot()
    expect(Permission.ToolSource).toBe(ToolSource)
    const source = Schema.decodeUnknownSync(Permission.ToolSource)({
      type: "tool",
      messageID: "legacy-message",
      id: "legacy/call",
    })
    const created = yield* test.request(`/api/session/${test.sessionID}/permission`, {
      id: "per_tool_http",
      action: "source-boundary",
      resources: ["review"],
      source,
    })
    expect(created.status).toBe(200)
    expect(yield* Effect.promise(() => created.json())).toEqual({ data: { id: "per_tool_http", effect: "ask" } })
    const before = yield* test.permission.forSession(test.sessionID)
    expect(before).toHaveLength(1)
    expect(before[0].source).toEqual(source)
    const forged = yield* test.request(`/api/session/${test.sessionID}/permission`, {
      id: "per_forged_http",
      action: "source-boundary",
      resources: ["review"],
      source: {
        type: "operation",
        sessionID: test.sessionID,
        operationID: "top_forged_http",
        messageID: "legacy-message",
        id: "legacy/call",
      },
    })
    expect(forged.status).toBe(400)
    expect(yield* test.permission.forSession(test.sessionID)).toEqual(before)
    const listed = yield* test.request(`/api/session/${test.sessionID}/permission`)
    expect(listed.status).toBe(200)
    expect(requestsFromJson(yield* Effect.promise(() => listed.json())).data).toEqual(before)
  }),
)

it.live("Permission HTTP and asked events retain trusted operation provenance through reply", () =>
  Effect.gen(function* () {
    const test = yield* boot()
    expect(Permission.OperationSource).toBe(OperationSource)
    const source = new Permission.OperationSource({
      type: "operation",
      sessionID: test.sessionID,
      operationID: SessionTask.OperationID.make("top_trusted_http"),
    })
    const asked = new Array<Permission.Request>()
    const unsubscribe = yield* test.bus.listen((event) =>
      Effect.sync(() => {
        if (event.type === Permission.Event.Asked.type)
          asked.push(Schema.decodeUnknownSync(Permission.Request)(event.data))
      }),
    )
    yield* Effect.addFinalizer(() => unsubscribe)
    const pending = yield* test.permission
      .ask({
        id: Permission.ID.make("per_trusted_http"),
        sessionID: test.sessionID,
        action: "source-boundary",
        resources: ["review"],
        source,
      })
      .pipe(Effect.provideContext(test.locationContext))
    expect(pending.effect).toBe("ask")
    expect(asked).toHaveLength(1)
    expect(asked[0].source).toEqual(source)
    const listed = yield* test.request(`/api/session/${test.sessionID}/permission`)
    expect(listed.status).toBe(200)
    const requests = requestsFromJson(yield* Effect.promise(() => listed.json())).data
    expect(requests).toHaveLength(1)
    expect(requests[0].source).toEqual(source)
    const found = yield* test.request(`/api/session/${test.sessionID}/permission/${pending.id}`)
    expect(found.status).toBe(200)
    expect(
      Schema.decodeUnknownSync(Schema.Struct({ data: Permission.Request }))(yield* Effect.promise(() => found.json()))
        .data.source,
    ).toEqual(source)
    const replied = yield* test.request(`/api/session/${test.sessionID}/permission/${pending.id}/reply`, {
      decision: "once",
    })
    expect(replied.status).toBe(204)
    expect(yield* test.permission.forSession(test.sessionID)).toEqual([])
  }),
)

it.live("Permission HTTP rejects an operation independently of sibling operation and Tool asks", () =>
  Effect.gen(function* () {
    const test = yield* boot()
    const replied = new Array<Permission.ID>()
    const unsubscribe = yield* test.bus.listen((event) =>
      Effect.sync(() => {
        if (event.type === Permission.Event.Replied.type)
          replied.push(Schema.decodeUnknownSync(Permission.Event.Replied.data)(event.data).requestID)
      }),
    )
    yield* Effect.addFinalizer(() => unsubscribe)
    const pending = yield* Effect.forEach(["a", "b"], (key) =>
      test.permission
        .ask({
          id: Permission.ID.make("per_operation_reject_http_" + key),
          sessionID: test.sessionID,
          action: "source-boundary",
          resources: ["review"],
          source: new Permission.OperationSource({
            type: "operation",
            sessionID: test.sessionID,
            operationID: SessionTask.OperationID.make("top_reject_http_" + key),
          }),
        })
        .pipe(Effect.provideContext(test.locationContext)),
    )
    pending.forEach((request) => expect(request.effect).toBe("ask"))
    const first = pending.at(0)
    const second = pending.at(1)
    if (!first || !second) return yield* Effect.die(new Error("The operation approval pair is missing"))
    const toolID = Permission.ID.make("per_tool_reject_http")
    const created = yield* test.request(`/api/session/${test.sessionID}/permission`, {
      id: toolID,
      action: "source-boundary",
      resources: ["review"],
      source: Permission.ToolSource.make({ type: "tool", messageID: "legacy-message", id: "legacy/call" }),
    })
    expect(created.status).toBe(200)
    const rejected = yield* test.request(`/api/session/${test.sessionID}/permission/${first.id}/reply`, {
      decision: "reject",
    })
    expect(rejected.status).toBe(204)
    expect(replied).toEqual([first.id])
    const listed = yield* test.request(`/api/session/${test.sessionID}/permission`)
    expect(listed.status).toBe(200)
    expect(
      requestsFromJson(yield* Effect.promise(() => listed.json()))
        .data.map((request) => request.id)
        .toSorted(),
    ).toEqual([second.id, toolID].toSorted())
    const found = yield* test.request(`/api/session/${test.sessionID}/permission/${second.id}`)
    expect(found.status).toBe(200)
    expect(
      Schema.decodeUnknownSync(Schema.Struct({ data: Permission.Request }))(yield* Effect.promise(() => found.json()))
        .data.source,
    ).toEqual(
      new Permission.OperationSource({
        type: "operation",
        sessionID: test.sessionID,
        operationID: SessionTask.OperationID.make("top_reject_http_b"),
      }),
    )
    const toolRejected = yield* test.request(`/api/session/${test.sessionID}/permission/${toolID}/reply`, {
      decision: "reject",
    })
    expect(toolRejected.status).toBe(204)
    expect((yield* test.permission.forSession(test.sessionID)).map((request) => request.id)).toEqual([second.id])
    const granted = yield* test.request(`/api/session/${test.sessionID}/permission/${second.id}/reply`, {
      decision: "once",
    })
    expect(granted.status).toBe(204)
    expect(replied).toEqual([first.id, toolID, second.id])
    expect(yield* test.permission.forSession(test.sessionID)).toEqual([])
  }),
)
