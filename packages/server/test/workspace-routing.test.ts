import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Environment } from "@aigcfroge/core/environment/index"
import { Location } from "@aigcfroge/core/location"
import { LocationServiceMap } from "@aigcfroge/core/location-services"
import { Workspace } from "@aigcfroge/core/workspace"
import { WorkspaceDriver } from "@aigcfroge/core/workspace/driver"
import { ApiNotFoundError } from "@aigcfroge/protocol/errors"
import {
  InstanceContext,
  WorkspaceRouteContext,
  WorkspaceRouting,
  WorkspaceRoutingQueryFields,
} from "@aigcfroge/protocol/middleware/workspace-routing"
import { Context, Deferred, Effect, Equal, Layer, RcMap, Schema } from "effect"
import { HttpEffect, HttpRouter, HttpServer, HttpServerRequest } from "effect/http"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { awaitWithTimeout, it } from "../../core/test/lib/effect"
import { instanceContextLayer, locationRefForRoute, workspaceRoutingLayer } from "../src/middleware/workspace-routing"
import { createRoutes } from "../src/routes"

const Routed = Schema.Struct({
  route: Schema.Struct({ directory: Schema.String, workspaceID: Schema.optional(Schema.String) }),
  location: Location.Ref,
  marker: Schema.String,
  content: Schema.optionalKey(Schema.String),
})

const ProbeApi = HttpApi.make("workspace-routing-test").add(
  HttpApiGroup.make("routing")
    .add(
      HttpApiEndpoint.get("probe", "/routing-probe", {
        query: { ...WorkspaceRoutingQueryFields, file: Schema.optional(Schema.String) },
        success: Routed,
      }),
    )
    .add(
      HttpApiEndpoint.get("wait", "/routing-wait", {
        query: WorkspaceRoutingQueryFields,
        success: Schema.Boolean,
      }),
    )
    .middleware(InstanceContext)
    .middleware(WorkspaceRouting),
)

const setup = Effect.fnUntraced(function* (
  drivers: Readonly<Record<string, WorkspaceDriver.Interface>> = {},
  password?: string,
) {
  const tmp = yield* tmpdirScoped("aigcfroge-routing-")
  const started = yield* Deferred.make<void>()
  const stopped = yield* Deferred.make<void>()
  const context = yield* Layer.build(
    createRoutes(
      {
        password,
        database: { path: ":memory:" },
        config: { directory: path.join(tmp.path, "config"), project: false, content: "{}" },
        models: { fetch: false },
        fs: { filewatcher: false },
      },
      () => [],
      [WorkspaceDriver.node.replace(WorkspaceDriver.registryNode(drivers))],
    ).pipe(Layer.provide(HttpServer.layerServices)),
  )
  const locations = Context.get(context, LocationServiceMap.Service)
  const atLocation = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const route = yield* WorkspaceRouteContext
      const services = yield* locations
        .contextEffect(locationRefForRoute(route))
        .pipe(
          Effect.mapError((error) => new ApiNotFoundError({ name: "NotFoundError", data: { message: error.message } })),
        )
      return yield* effect.pipe(Effect.provideContext(services))
    })
  const handlers = HttpApiBuilder.group(ProbeApi, "routing", (handlers) =>
    handlers
      .handle("probe", ({ query }) =>
        atLocation(
          Effect.gen(function* () {
            const route = yield* WorkspaceRouteContext
            const location = yield* Location.Service
            const environment = yield* Environment.Service
            const request = yield* HttpServerRequest.HttpServerRequest
            const file = query.file
              ? yield* environment.files.read(path.join(location.directory, query.file)).pipe(Effect.orDie)
              : undefined
            return {
              route,
              location: Location.Ref.make(location),
              marker: request.headers["x-test-request"] ?? "",
              ...(file ? { content: new TextDecoder().decode(file.bytes) } : {}),
            }
          }),
        ),
      )
      .handle("wait", () =>
        atLocation(
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(Deferred.succeed(stopped, undefined)),
          ),
        ),
      ),
  )
  // Register a real HttpApi consumer on the already-built production router.
  // The production legacy endpoints below separately verify createRoutes' middleware assembly.
  yield* Layer.build(
    HttpApiBuilder.layer(ProbeApi).pipe(
      Layer.provide(handlers),
      Layer.provide(workspaceRoutingLayer),
      Layer.provide(instanceContextLayer),
      Layer.provide(Layer.succeedContext(context)),
      Layer.provide(HttpServer.layerServices),
    ),
  )
  const handler = Context.get(context, HttpRouter.HttpRouter).asHttpEffect().pipe(HttpEffect.toWebHandlerWith(context))
  const request = (
    directory?: string,
    options: { route?: string; workspace?: string; file?: string; headers?: HeadersInit; signal?: AbortSignal } = {},
  ) =>
    Effect.promise(() => {
      const url = new URL(options.route ?? "/routing-probe", "http://aigcfroge.local")
      if (directory !== undefined) url.searchParams.set("directory", directory)
      if (options.workspace !== undefined) url.searchParams.set("workspace", options.workspace)
      if (options.file !== undefined) url.searchParams.set("file", options.file)
      return handler(new Request(url, { headers: options.headers, signal: options.signal }))
    })
  return {
    tmp,
    handler,
    request,
    locations,
    workspace: Context.get(context, Workspace.Service),
    started,
    stopped,
  }
})

const routed = (response: Response) =>
  Effect.promise(() => response.json()).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.toCodecJson(Routed))))

it.live("normalizes flat directory queries, decodes the header once, and preserves request context", () =>
  Effect.gen(function* () {
    const test = yield* setup()
    const directory = path.join(test.tmp.path, "project %2F space")
    yield* Effect.promise(() => fs.mkdir(directory))
    const relative = `${path.relative(process.cwd(), directory)}/unused/..`
    const query = yield* test.request(relative, { headers: { "x-test-request": "query" } })
    expect(query.status).toBe(200)
    expect(yield* routed(query)).toMatchObject({
      route: { directory },
      location: { directory },
      marker: "query",
    })
    const header = yield* test.request(undefined, {
      headers: { "x-aigcfroge-directory": encodeURIComponent(directory), "x-test-request": "header" },
    })
    expect(header.status).toBe(200)
    expect(yield* routed(header)).toMatchObject({ location: { directory }, marker: "header" })
    const precedence = yield* test.request(directory, { headers: { "x-aigcfroge-directory": "/absent" } })
    expect(precedence.status).toBe(200)
    const fallback = yield* test.request()
    expect(fallback.status).toBe(200)
    expect(yield* routed(fallback)).toMatchObject({ location: { directory: process.cwd() } })
    expect(Equal.equals(locationRefForRoute({ directory: relative }), locationRefForRoute({ directory }))).toBe(true)
    expect(Array.from(yield* RcMap.keys(test.locations.rcMap))).toHaveLength(2)
  }),
)

it.live("returns declared 400 errors before boot for invalid routing input", () =>
  Effect.gen(function* () {
    const test = yield* setup()
    const invalidWorkspace = yield* test.request(test.tmp.path, { workspace: "not-a-workspace" })
    expect(invalidWorkspace.status).toBe(400)
    expect(yield* Effect.promise(() => invalidWorkspace.json())).toMatchObject({
      _tag: "InvalidRequestError",
      field: "workspace",
    })
    const nul = yield* test.request(`${test.tmp.path}\0`)
    expect(nul.status).toBe(400)
    expect(yield* Effect.promise(() => nul.json())).toMatchObject({ field: "directory" })
    const duplicate = yield* test.request(undefined, { route: "/routing-probe?directory=/a&directory=/b" })
    expect(duplicate.status).toBe(400)
    expect(yield* Effect.promise(() => duplicate.json())).toMatchObject({ _tag: "InvalidRequestError" })
    const duplicatedWorkspace = yield* test.request(undefined, {
      route: `/routing-probe?workspace=${Workspace.ID.create()}&workspace=${Workspace.ID.create()}`,
    })
    expect(duplicatedWorkspace.status).toBe(400)
    expect(yield* Effect.promise(() => duplicatedWorkspace.json())).toMatchObject({ _tag: "InvalidRequestError" })
    const headerNul = yield* test.request(undefined, { headers: { "x-aigcfroge-directory": "%00" } })
    expect(headerNul.status).toBe(400)
    expect(yield* Effect.promise(() => headerNul.json())).toMatchObject({ field: "directory" })
    expect(Array.from(yield* RcMap.keys(test.locations.rcMap))).toHaveLength(0)
  }),
)

it.live("authenticates production workspace routes before validating or resolving their targets", () =>
  Effect.gen(function* () {
    const test = yield* setup({}, "routing-fixture")
    const unknown = Workspace.ID.create()
    const route = "/custom-profile"
    const denied = yield* test.request(test.tmp.path, { route, workspace: unknown })
    expect(denied.status).toBe(401)
    expect(yield* Effect.promise(() => denied.json())).toMatchObject({ _tag: "UnauthorizedError" })
    expect((yield* test.request(test.tmp.path, { route, workspace: "invalid" })).status).toBe(401)
    expect(Array.from(yield* RcMap.keys(test.locations.rcMap))).toHaveLength(0)

    const headers = { authorization: `Basic ${btoa("aigcfroge:routing-fixture")}` }
    const missing = yield* test.request(test.tmp.path, { route, workspace: unknown, headers })
    expect(missing.status).toBe(404)
    expect(yield* Effect.promise(() => missing.json())).toMatchObject({
      name: "NotFoundError",
      data: { message: `Workspace not found: ${unknown}` },
    })
    expect((yield* test.request(test.tmp.path, { route, workspace: "invalid", headers })).status).toBe(400)
    expect(Array.from(yield* RcMap.keys(test.locations.rcMap))).toHaveLength(0)
    const local = yield* test.request(test.tmp.path, { route, headers })
    expect(local.status).toBe(200)
    expect(yield* Effect.promise(() => local.json())).toEqual({ assets: [], invalid: [] })
  }),
)

it.live("returns declared 404 errors for missing targets and retries a newly created directory", () =>
  Effect.gen(function* () {
    const test = yield* setup()
    const unknown = Workspace.ID.create()
    const workspace = yield* test.request(test.tmp.path, { workspace: unknown })
    expect(workspace.status).toBe(404)
    expect(yield* Effect.promise(() => workspace.json())).toMatchObject({
      name: "NotFoundError",
      data: { message: `Workspace not found: ${unknown}` },
    })
    expect(Array.from(yield* RcMap.keys(test.locations.rcMap))).toHaveLength(0)
    const directory = path.join(test.tmp.path, "new-project")
    const missing = yield* test.request(directory)
    expect(missing.status).toBe(404)
    expect(yield* Effect.promise(() => missing.json())).toMatchObject({ name: "NotFoundError" })
    yield* Effect.promise(() => fs.mkdir(directory))
    expect((yield* test.request(directory)).status).toBe(200)
    const file = path.join(test.tmp.path, "file.txt")
    yield* Effect.promise(() => fs.writeFile(file, "file"))
    expect((yield* test.request(file)).status).toBe(404)
    const link = path.join(test.tmp.path, "link")
    yield* Effect.promise(() => fs.symlink(directory, link, "dir"))
    expect((yield* test.request(link)).status).toBe(200)
    yield* Effect.promise(() => fs.rm(directory, { recursive: true }))
    expect((yield* test.request(link)).status).toBe(404)
    expect((yield* test.request(directory)).status).toBe(404)
    // The health owner runs only after both production middleware validate the Location.
    const legacy = yield* test.request(test.tmp.path, { route: "/custom-composition/health?path=test" })
    expect(legacy.status).toBe(400)
    expect(yield* Effect.promise(() => legacy.json())).toMatchObject({
      _tag: "InvalidRequestError",
      field: "path",
      message: "Profile not found: test",
    })
  }),
)

it.live("uses persisted workspaces and separate Environment graphs for directories absent on the host", () =>
  Effect.gen(function* () {
    const calls: string[] = []
    const memories = new Map<Workspace.ID, Environment.MemoryDriver>()
    const driver = WorkspaceDriver.make({
      create: ({ workspaceID }) => {
        calls.push(`create:${workspaceID}`)
        return Effect.succeed({ binding: { workspaceID } })
      },
      connect: ({ workspaceID }) => {
        calls.push(`connect:${workspaceID}`)
        const memory = memories.get(workspaceID)
        return memory ? Effect.succeed(memory) : Effect.die(new Error("Missing workspace test fixture"))
      },
      suspendForIdle: () => Effect.void,
      destroy: () => Effect.void,
    })
    const test = yield* setup({ memory: driver })
    const directory = path.join(test.tmp.path, "workspace-only")
    const ids = yield* Effect.forEach(["first", "second"], (content) =>
      Effect.gen(function* () {
        const id = yield* test.workspace.create({ provider: "memory" })
        const memory = Environment.makeMemoryDriver()
        memories.set(id, memory)
        const files = Environment.makeFiles(memory)
        yield* files.mkdir(directory)
        yield* files.write(path.join(directory, "identity.txt"), new TextEncoder().encode(content))
        return id
      }),
    )
    expect(calls).toEqual([])
    expect(
      yield* Effect.promise(() =>
        fs.stat(directory).then(
          () => true,
          () => false,
        ),
      ),
    ).toBe(false)
    const first = yield* test.request(directory, { workspace: ids[0], file: "identity.txt" })
    expect(first.status).toBe(200)
    expect(yield* routed(first)).toMatchObject({
      route: { directory, workspaceID: ids[0] },
      location: { directory, workspaceID: ids[0] },
      content: "first",
    })
    const second = yield* test.request(directory, { workspace: ids[1], file: "identity.txt" })
    expect(second.status).toBe(200)
    expect(yield* routed(second)).toMatchObject({ location: { workspaceID: ids[1] }, content: "second" })
    expect(Array.from(yield* RcMap.keys(test.locations.rcMap))).toHaveLength(2)
    expect((yield* test.request(directory, { workspace: ids[0], file: "identity.txt" })).status).toBe(200)
    expect(calls).toEqual([`create:${ids[0]}`, `connect:${ids[0]}`, `create:${ids[1]}`, `connect:${ids[1]}`])
    expect((yield* test.request(directory)).status).toBe(404)
    yield* test.workspace.destroy(ids[0])
    const destroyed = yield* test.request(directory, { workspace: ids[0] })
    expect(destroyed.status).toBe(404)
    expect(yield* Effect.promise(() => destroyed.json())).toMatchObject({
      data: { message: `Workspace not found: ${ids[0]}` },
    })
  }),
)

it.live("retains driver failures as 500 responses and retries the persisted workspace", () =>
  Effect.gen(function* () {
    const calls: string[] = []
    const failures = new Set(["create", "connect", "stat"])
    const memory = Environment.makeMemoryDriver()
    const files = Environment.makeFiles(memory)
    const driver = WorkspaceDriver.make({
      create: (input) =>
        Effect.gen(function* () {
          calls.push("create")
          if (failures.has("create")) return yield* new WorkspaceDriver.Error({ message: "Fixture create failure" })
          return { binding: { workspaceID: input.workspaceID } }
        }),
      connect: () =>
        Effect.gen(function* () {
          calls.push("connect")
          if (failures.has("connect")) return yield* new WorkspaceDriver.Error({ message: "Fixture connect failure" })
          return {
            ...memory,
            overrides: {
              ...memory.overrides,
              stat: (path: string) =>
                Effect.suspend(() =>
                  failures.has("stat")
                    ? new Environment.Failed({ path, cause: new Error("Fixture stat failure") })
                    : files.stat(path),
                ),
            },
          }
        }),
      suspendForIdle: () => Effect.void,
      destroy: () => Effect.void,
    })
    const drivers: Record<string, WorkspaceDriver.Interface> = { memory: driver }
    const test = yield* setup(drivers)
    const id = yield* test.workspace.create({ provider: "memory" })
    const directory = path.join(test.tmp.path, "provider-only")
    yield* files.mkdir(directory)
    yield* files.write(path.join(directory, "identity.txt"), new TextEncoder().encode("recovered"))

    delete drivers.memory
    expect((yield* test.request(directory, { workspace: id })).status).toBe(500)
    expect(yield* test.workspace.exists(id)).toBe(true)
    expect(calls).toEqual([])
    drivers.memory = driver
    expect((yield* test.request(directory, { workspace: id })).status).toBe(500)
    expect(yield* test.workspace.exists(id)).toBe(true)
    expect(calls).toEqual(["create"])
    failures.delete("create")
    expect((yield* test.request(directory, { workspace: id })).status).toBe(500)
    expect(calls).toEqual(["create", "create", "connect"])
    failures.delete("connect")
    expect((yield* test.request(directory, { workspace: id })).status).toBe(500)
    expect(calls).toEqual(["create", "create", "connect", "connect"])
    failures.delete("stat")
    const recovered = yield* test.request(directory, { workspace: id, file: "identity.txt" })
    expect(recovered.status).toBe(200)
    expect(yield* routed(recovered)).toMatchObject({ location: { directory, workspaceID: id }, content: "recovered" })
    expect(calls).toEqual(["create", "create", "connect", "connect"])
    expect(Array.from(yield* RcMap.keys(test.locations.rcMap))).toHaveLength(1)
  }),
)

it.live("interrupts an active routed handler on abort and keeps the cached Location serviceable", () =>
  Effect.gen(function* () {
    const test = yield* setup()
    const controller = new AbortController()
    const pending = test.handler(
      new Request(`http://aigcfroge.local/routing-wait?directory=${encodeURIComponent(test.tmp.path)}`, {
        signal: controller.signal,
      }),
    )
    yield* awaitWithTimeout(Deferred.await(test.started), "Routed handler did not start")
    controller.abort()
    yield* awaitWithTimeout(Deferred.await(test.stopped), "Aborted routed handler did not finalize")
    const response = yield* awaitWithTimeout(
      Effect.promise(() => pending),
      "Aborted request did not finish",
    )
    expect(response.status).toBe(499)
    expect((yield* test.request(test.tmp.path)).status).toBe(200)
  }),
)
