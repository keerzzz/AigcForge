import { describe, expect } from "bun:test"
import { NodeHttpServer } from "@effect/platform-node"
import { createServer } from "node:http"
import { AigcForge } from "@aigcfroge/client/effect"
import { Agent } from "@aigcfroge/core/agent"
import { Database } from "@aigcfroge/core/database/database"
import { LocationServiceMap } from "@aigcfroge/core/location-service-map"
import { Permission } from "@aigcfroge/core/permission"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { ApprovalPresence } from "@aigcfroge/core/permission/approval-presence"
import { ProductModePolicy } from "@aigcfroge/core/product-mode-policy"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { AbsolutePath } from "@aigcfroge/schema/schema"
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Schema, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../../core/test/lib/effect"
import { withCustomModeEnabled } from "../../core/test/lib/product-mode"
import { CompositionFixture } from "../../core/test/lib/composition"
import { createRoutes } from "../src/routes"

withCustomModeEnabled()

const it = testEffect(Layer.merge(FetchHttpClient.layer, NodeHttpServer.layerHttpServices))

const setup = (transport: "web" | "node", custom = false) =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const context = yield* Layer.build(
      createRoutes({
        password: "secret",
        database: { path: ":memory:" },
        config: { directory: tmp.path, project: false, content: "{}" },
        models: { fetch: false },
        fs: { filewatcher: false },
      }).pipe(Layer.provide(transport === "node" ? NodeHttpServer.layerHttpServices : HttpServer.layerServices)),
    )
    const router = Context.get(context, HttpRouter.HttpRouter).asHttpEffect()
    const baseUrl = yield* transport === "node"
      ? Effect.gen(function* () {
          const server = yield* NodeHttpServer.make(() => createServer(), { host: "127.0.0.1", port: 0 })
          yield* server.serve(router).pipe(Effect.provide(NodeHttpServer.layerHttpServices))
          return HttpServer.formatAddress(server.address)
        })
      : Effect.gen(function* () {
          const handler = router.pipe(HttpEffect.toWebHandlerWith(context))
          const server = yield* Effect.acquireRelease(
            Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => handler(request) })),
            (server) => Effect.promise(() => server.stop(true)),
          )
          return server.url
        })
    const http = yield* HttpClient.HttpClient
    const makeClient = (capabilities?: string) =>
      AigcForge.make({ baseUrl }).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          http.pipe(
            HttpClient.mapRequest((request) =>
              HttpClientRequest.setHeaders(request, {
                authorization: `Basic ${btoa("aigcfroge:secret")}`,
                ...(capabilities === undefined ? {} : { [ProductModePolicy.CAPABILITIES_HEADER]: capabilities }),
              }),
            ),
          ),
        ),
      )
    const client = yield* makeClient()
    const ref = { directory: AbsolutePath.make(tmp.path) }
    const session = yield* client.session.create({ location: ref })
    const services = yield* Context.get(context, LocationServiceMap.Service).contextEffect(ref)
    const agents = Context.get(services, Agent.Service)
    yield* agents.transform((editor) =>
      editor.update(Agent.ID.make("approval-test"), (agent) => {
        agent.permissions = [{ action: "shell", resource: "*", effect: "ask" }]
      }),
    )
    const database = Context.get(context, Database.Service)
    if (custom) {
      const agent = Agent.Info.make({
        ...Agent.Info.empty(Agent.ID.make("approval-test")),
        mode: "subagent",
        permissions: [{ action: "shell", resource: "*", effect: "ask" }],
      })
      yield* CompositionFixture.attach(session.id, agent, {
        orchestrator: Agent.Info.make({ ...agent, id: Agent.ID.make("meta"), mode: "primary" }),
      }).pipe(Effect.provide(SessionComposition.layer), Effect.provideService(Database.Service, database))
      yield* database.db.update(SessionTable).set({ mode: "custom", agent: "meta" }).run().pipe(Effect.orDie)
    }
    const permission = Context.get(services, Permission.Service)
    return {
      client,
      makeClient,
      permission,
      session,
      ref,
      presence: () => Context.get(context, ApprovalPresence.Service),
      assert: permission.assert({
        sessionID: session.id,
        agent: Agent.ID.make(custom ? "meta" : "approval-test"),
        action: "shell",
        resources: ["echo test"],
      }),
    }
  })

const subscribe = (client: Effect.Success<ReturnType<typeof AigcForge.make>>) =>
  Effect.gen(function* () {
    const connected = yield* Deferred.make<void>()
    const asked = yield* Deferred.make<Permission.Request>()
    const fiber = yield* client.event.subscribe().pipe(
      Stream.runForEach((event) => {
        if (event.type === "server.connected") return Deferred.succeed(connected, undefined).pipe(Effect.asVoid)
        if (event.type === Permission.Event.Asked.type)
          return Deferred.succeed(asked, Schema.decodeUnknownSync(Permission.Request)(event.data)).pipe(Effect.asVoid)
        return Effect.void
      }),
      Effect.forkScoped,
    )
    yield* awaitWithTimeout(Deferred.await(connected), "SSE did not connect")
    return { fiber, asked }
  })

describe.each(["web", "node"] as const)("%s HTTP approval stream", (transport) => {
  it.live("a real HTTP event connection can answer a leaf ask and unregisters on disconnect", () =>
    Effect.gen(function* () {
      const test = yield* setup(transport)
      const connection = yield* subscribe(test.client)
      const execution = yield* test.assert.pipe(Effect.forkScoped)
      const request = yield* awaitWithTimeout(
        Deferred.await(connection.asked),
        "Connected client did not receive the approval",
      )
      expect(request.sessionID).toBe(test.session.id)
      yield* test.client.permission.reply({ sessionID: test.session.id, requestID: request.id, decision: "once" })
      yield* Fiber.join(execution)
      expect(yield* test.permission.forSession(test.session.id)).toHaveLength(0)
      yield* Fiber.interrupt(connection.fiber)
      yield* test
        .presence()
        .hasResponder({ location: test.ref, mode: "coding" })
        .pipe(
          Effect.map((present) => (present ? undefined : true)),
          (effect) => pollWithTimeout(effect, "Disconnected HTTP stream retained an approval responder"),
        )
      const exit = yield* test.assert.pipe(Effect.exit)
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({
        _tag: "Permission.RejectedError",
        reason: "no_responder",
      })
    }),
  )

  it.live("only a capable HTTP stream keeps custom asks answerable", () =>
    Effect.gen(function* () {
      const test = yield* setup(transport, true)
      const legacy = yield* subscribe(test.client)
      const exit = yield* test.assert.pipe(Effect.exit)
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({
        _tag: "Permission.RejectedError",
        reason: "no_responder",
      })
      const capable = yield* subscribe(
        yield* test.makeClient(`other, ${ProductModePolicy.CAPABILITY_CUSTOM_V1.toUpperCase()} `),
      )
      const execution = yield* test.assert.pipe(Effect.forkScoped)
      const request = yield* awaitWithTimeout(
        Deferred.await(capable.asked),
        "Capable client did not receive custom approval",
      )
      yield* test.client.permission.reply({ sessionID: test.session.id, requestID: request.id, decision: "once" })
      yield* Fiber.join(execution)
      yield* Fiber.interrupt(capable.fiber)
      yield* test
        .presence()
        .hasResponder({ location: test.ref, mode: "custom" })
        .pipe(
          Effect.map((present) => (present ? undefined : true)),
          (effect) => pollWithTimeout(effect, "Custom capability survived its connection"),
        )
      expect(yield* test.presence().hasResponder({ location: test.ref, mode: "coding" })).toBe(true)
      yield* Fiber.interrupt(legacy.fiber)
    }),
  )
})
