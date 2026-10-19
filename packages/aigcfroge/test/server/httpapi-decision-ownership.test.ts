import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { AgentV2 } from "@aigcfroge/core/agent"
import { EventV2 } from "@aigcfroge/core/event"
import { GrantEvent } from "@aigcfroge/core/grant/event"
import { ScopedGrantStore } from "@aigcfroge/core/grant/store"
import { Location } from "@aigcfroge/core/location"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { QuestionV2 } from "@aigcfroge/core/question"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { ToolRegistry } from "@aigcfroge/core/tool/registry"
import { PermissionV1 } from "@aigcfroge/core/v1/permission"
import { describe, expect } from "bun:test"
import { Config, Deferred, Effect, Exit, Fiber, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { AppLayer } from "../../src/effect/app-runtime"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Permission } from "../../src/permission"
import { Session } from "../../src/session/session"
import { MessageID } from "../../src/session/schema"
import { QuestionTool } from "../../src/tool/question"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { provideInstanceEffect, tmpdirScoped } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"

const state = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* Effect.promise(() => resetDatabase())
    yield* Effect.addFinalizer(() => Effect.promise(() => resetDatabase()))
  }),
)
const servedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.routes,
  { disableListenLog: true, disableLogger: true },
)
const http = servedRoutes.pipe(
  Layer.provide(layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
)
const it = testEffect(Layer.mergeAll(http, AppLayer).pipe(Layer.provideMerge(NodeServices.layer), Layer.provide(state)))

const post = (directory: string, path: string, body: unknown) =>
  HttpClientRequest.post(path).pipe(
    HttpClientRequest.setHeader("x-aigcfroge-directory", directory),
    HttpClientRequest.bodyJson(body),
    Effect.flatMap(HttpClient.execute),
  )

describe("decision ownership through production HttpApi (AI-TDD-S03)", () => {
  it.live("R02: a Session permission route cannot settle a different Session's request", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      yield* Effect.gen(function* () {
        const sessions = yield* Session.Service
        const owner = yield* sessions.create({ title: "request owner" })
        const other = yield* sessions.create({ title: "wrong owner" })
        const permission = yield* Permission.Service
        const events = yield* EventV2Bridge.Service
        const ready = yield* Deferred.make<void>()
        const id = PermissionV1.ID.ascending()
        const off = yield* events.listen((event) =>
          event.type === Permission.Event.Asked.type ? Deferred.succeed(ready, undefined) : Effect.void,
        )
        yield* Effect.addFinalizer(() => off)
        const scope = yield* Effect.scope
        const waiting = yield* permission
          .ask({
            id,
            sessionID: owner.id,
            permission: "read",
            patterns: ["src/index.ts"],
            metadata: {},
            always: [],
            ruleset: [],
          })
          .pipe(Effect.forkIn(scope))
        yield* awaitWithTimeout(Deferred.await(ready), "permission was not admitted")

        const elsewhere = yield* tmpdirScoped({ git: true })
        const foreign = yield* post(elsewhere, `/permission/${id}/reply`, { reply: "once" })
        expect(foreign.status).toBe(404)
        expect(yield* permission.list()).toMatchObject([{ id, sessionID: owner.id }])
        const denied = yield* post(dir, `/session/${other.id}/permissions/${id}`, { response: "once" })
        expect(denied.status).toBe(404)
        expect(yield* permission.list()).toMatchObject([{ id, sessionID: owner.id }])
        const accepted = yield* post(dir, `/session/${owner.id}/permissions/${id}`, { response: "once" })
        expect(accepted.status).toBe(200)
        expect(Exit.isSuccess(yield* Fiber.await(waiting))).toBe(true)
        expect(yield* permission.list()).toEqual([])
      }).pipe(provideInstanceEffect(dir))
    }),
  )
})

const nativeOwners = Effect.fn("DecisionOwnershipTest.nativeOwners")(function* (directory: string) {
  const ref = Location.Ref.make({ directory: AbsolutePath.make(directory) })
  const session = yield* (yield* SessionV2.Service).create({ location: ref, agent: AgentV2.ID.make("build") })
  const locations = yield* LocationServiceMap
  return yield* Effect.gen(function* () {
    const agents = yield* AgentV2.Service
    yield* agents.transform((editor) =>
      editor.update(AgentV2.ID.make("build"), (agent) => {
        agent.permissions = [
          { action: "read", resource: "*", effect: "ask" },
          { action: "question", resource: "*", effect: "allow" },
        ]
      }),
    )
    return {
      session,
      permission: yield* PermissionV2.Service,
      question: yield* QuestionV2.Service,
      grants: yield* ScopedGrantStore.Service,
      registry: yield* ToolRegistry.Service,
    }
  }).pipe(Effect.provide(locations.get(ref)))
})

it.live("AI-TDD-S03-R01: a registered native question reaches only its native HTTP reply owner", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped({ git: true })
    const owner = yield* nativeOwners(dir)
    const events = yield* EventV2.Service
    const ready = yield* Deferred.make<QuestionV2.Request>()
    const off = yield* events.listen((event) =>
      event.type === QuestionV2.Event.Asked.type
        ? Deferred.succeed(ready, Schema.decodeUnknownSync(QuestionV2.Request)(event.data))
        : Effect.void,
    )
    yield* Effect.addFinalizer(() => off)
    const materialized = yield* owner.registry.materialize()
    expect(materialized.definitions.some((tool) => tool.name === "question")).toBe(true)
    const scope = yield* Effect.scope
    const waiting = yield* materialized
      .settle({
        sessionID: owner.session.id,
        agent: AgentV2.ID.make("build"),
        assistantMessageID: SessionMessage.ID.make("msg_native_question"),
        call: {
          type: "tool-call",
          id: "call-native-question",
          name: "question",
          input: {
            questions: [
              {
                question: "Which option?",
                header: "Option",
                options: [{ label: "One", description: "First" }],
              },
            ],
          },
        },
      })
      .pipe(Effect.forkIn(scope))
    const request = yield* awaitWithTimeout(Deferred.await(ready), "native question tool did not ask")
    const sibling = yield* nativeOwners(dir)
    const elsewhere = yield* tmpdirScoped({ git: true })
    const foreign = yield* nativeOwners(elsewhere)
    for (const sessionID of [sibling.session.id, foreign.session.id]) {
      const wrong = yield* post(dir, `/api/session/${sessionID}/question/${request.id}/reply`, { answers: [["One"]] })
      expect(wrong.status).toBe(404)
      expect(yield* owner.question.list()).toMatchObject([{ id: request.id }])
    }
    const wrong = yield* post(dir, `/question/${request.id}/reply`, { answers: [["One"]] })
    expect(wrong.status).toBe(404)
    expect(yield* owner.question.list()).toMatchObject([{ id: request.id, sessionID: owner.session.id }])
    const accepted = yield* post(dir, `/api/session/${owner.session.id}/question/${request.id}/reply`, {
      answers: [["One"]],
    })
    expect(accepted.status).toBe(204)
    const result = yield* awaitWithTimeout(Fiber.join(waiting), "question tool did not settle")
    expect(result.output?.structured).toEqual({ answers: [["One"]] })
    expect(yield* owner.question.list()).toEqual([])
  }),
)

it.live("AI-TDD-S03-R02: native permissions reject foreign Session and Location owners", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped({ git: true })
    const elsewhere = yield* tmpdirScoped({ git: true })
    const owner = yield* nativeOwners(dir)
    const sibling = yield* nativeOwners(dir)
    const foreign = yield* nativeOwners(elsewhere)
    const pending = yield* owner.permission.ask({
      sessionID: owner.session.id,
      action: "read",
      resources: ["src/index.ts"],
    })
    expect(pending.effect).toBe("ask")
    for (const sessionID of [sibling.session.id, foreign.session.id]) {
      const response = yield* post(dir, `/api/session/${sessionID}/permission/${pending.id}/reply`, { reply: "once" })
      expect(response.status).toBe(404)
      expect(yield* owner.permission.get(pending.id)).toBeDefined()
    }
    const response = yield* post(dir, `/api/session/${owner.session.id}/permission/${pending.id}/reply`, {
      reply: "once",
    })
    expect(response.status).toBe(204)
    expect(yield* owner.permission.list()).toEqual([])
  }),
)

it.live("AI-TDD-S03-R03: two native permission clients cannot publish two terminal replies", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped({ git: true })
    const owner = yield* nativeOwners(dir)
    const pending = yield* owner.permission.ask({
      sessionID: owner.session.id,
      action: "read",
      resources: ["src/index.ts"],
    })
    const events = yield* EventV2.Service
    const terminal: EventV2.Payload[] = []
    const off = yield* events.listen((event) => {
      if (event.type !== PermissionV2.Event.Replied.type) return Effect.void
      terminal.push(event)
      return Effect.yieldNow
    })
    yield* Effect.addFinalizer(() => off)
    const responses = yield* Effect.all(
      ["once", "reject"].map((reply) =>
        post(dir, `/api/session/${owner.session.id}/permission/${pending.id}/reply`, { reply }),
      ),
      { concurrency: "unbounded" },
    )
    expect(responses.map((response) => response.status).sort()).toEqual([204, 404])
    expect(terminal).toHaveLength(1)
    expect(yield* owner.permission.list()).toEqual([])
  }),
)

it.live("AI-TDD-S03-R03/R04: grant issuance owns settlement before a competing rejection", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped({ git: true })
    const owner = yield* nativeOwners(dir)
    const pending = yield* owner.permission.ask({
      sessionID: owner.session.id,
      action: "read",
      resources: ["src/index.ts"],
    })
    const issued = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const events = yield* EventV2.Service
    const off = yield* events.listen((event) =>
      event.type === GrantEvent.Updated.type &&
      Schema.decodeUnknownSync(GrantEvent.Updated.data)(event.data).status === "active"
        ? Deferred.succeed(issued, undefined).pipe(Effect.andThen(Deferred.await(release)))
        : Effect.void,
    )
    yield* Effect.addFinalizer(() => off)
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
    const scope = yield* Effect.scope
    const granting = yield* post(dir, `/api/session/${owner.session.id}/permission/${pending.id}/grant`, {
      level: "session",
    }).pipe(Effect.forkIn(scope))
    yield* awaitWithTimeout(Deferred.await(issued), "scoped grant was not issued")
    const attempted = yield* Deferred.make<void>()
    const rejecting = yield* Deferred.succeed(attempted, undefined).pipe(
      Effect.andThen(owner.permission.reply({ requestID: pending.id, reply: "reject" })),
      Effect.exit,
      Effect.forkIn(scope),
    )
    yield* Deferred.await(attempted)
    yield* Deferred.succeed(release, undefined)
    const response = yield* awaitWithTimeout(Fiber.join(granting), "grant response did not finish")
    expect(response.status).toBe(200)
    expect(Exit.isFailure(yield* Fiber.join(rejecting))).toBe(true)
    expect(yield* owner.grants.list({ status: "active" })).toHaveLength(1)
    expect(yield* owner.permission.list()).toEqual([])
  }),
)

it.live("AI-TDD-S03-R03: concurrent HTTP grants have one durable result, including after a retry", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped({ git: true })
    const owner = yield* nativeOwners(dir)
    const pending = yield* owner.permission.ask({
      sessionID: owner.session.id,
      action: "read",
      resources: ["src/index.ts"],
    })
    const route = `/api/session/${owner.session.id}/permission/${pending.id}/grant`
    const responses = yield* Effect.all(
      ["session", "location"].map((level) => post(dir, route, { level })),
      { concurrency: "unbounded" },
    )
    expect(responses.map((response) => response.status).sort()).toEqual([200, 404])
    expect(yield* owner.grants.list()).toHaveLength(1)
    expect(yield* owner.permission.list()).toEqual([])
    expect((yield* post(dir, route, { level: "session" })).status).toBe(404)
    expect(yield* owner.grants.list()).toHaveLength(1)
  }),
)

it.live("AI-TDD-S03-R06: a failed HTTP notification exposes no success and retry cannot issue another grant", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped({ git: true })
    const owner = yield* nativeOwners(dir)
    const pending = yield* owner.permission.ask({
      sessionID: owner.session.id,
      action: "read",
      resources: ["src/index.ts"],
    })
    const events = yield* EventV2.Service
    const off = yield* events.listen((event) =>
      event.type === PermissionV2.Event.Replied.type ? Effect.die("permission notification failed") : Effect.void,
    )
    yield* Effect.addFinalizer(() => off)
    const route = `/api/session/${owner.session.id}/permission/${pending.id}/grant`
    const response = yield* post(dir, route, { level: "session" })
    expect(response.status).toBe(500)
    expect(yield* owner.permission.list()).toEqual([])
    expect(yield* owner.grants.list({ status: "active" })).toHaveLength(1)
    expect((yield* post(dir, route, { level: "session" })).status).toBe(404)
    expect(yield* owner.grants.list()).toHaveLength(1)
  }),
)

it.live("AI-TDD-S03-R01: the default question tool uses the canonical Location owner and Session HTTP contract", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped({ git: true })
    yield* Effect.gen(function* () {
      const sessions = yield* Session.Service
      const owner = yield* sessions.create({ title: "default question owner" })
      const sibling = yield* sessions.create({ title: "another session" })
      const locations = yield* LocationServiceMap
      const question = yield* QuestionV2.Service.pipe(
        Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(dir) }))),
      )
      const events = yield* EventV2.Service
      const ready = yield* Deferred.make<QuestionV2.Request>()
      const off = yield* events.listen((event) => {
        if (event.type !== QuestionV2.Event.Asked.type) return Effect.void
        const request = Schema.decodeUnknownSync(QuestionV2.Request)(event.data)
        if (request.sessionID !== owner.id) return Effect.void
        return Deferred.succeed(ready, request)
      })
      yield* Effect.addFinalizer(() => off)
      const tool = yield* (yield* QuestionTool).init()
      const scope = yield* Effect.scope
      const waiting = yield* tool
        .execute(
          {
            questions: [
              { question: "Choose a branch", header: "Branch", options: [{ label: "One", description: "First" }] },
            ],
          },
          {
            sessionID: owner.id,
            messageID: MessageID.ascending(),
            callID: "default-question-call",
            agent: "build",
            abort: AbortSignal.any([]),
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.forkIn(scope))
      const request = yield* awaitWithTimeout(
        Deferred.await(ready),
        "default tool did not publish the canonical Question event",
      )
      expect(yield* question.list()).toMatchObject([{ id: request.id, sessionID: owner.id }])
      const list = yield* HttpClient.execute(
        HttpClientRequest.get("/api/question/request").pipe(HttpClientRequest.setHeader("x-aigcfroge-directory", dir)),
      )
      expect(list.status).toBe(200)
      expect(yield* list.json).toMatchObject({
        location: { directory: dir },
        data: [{ id: request.id, sessionID: owner.id }],
      })
      const foreign = yield* post(dir, `/api/session/${sibling.id}/question/${request.id}/reply`, {
        answers: [["One"]],
      })
      expect(foreign.status).toBe(404)
      expect(yield* question.list()).toHaveLength(1)
      const reply = yield* post(dir, `/api/session/${owner.id}/question/${request.id}/reply`, { answers: [["One"]] })
      expect(reply.status).toBe(204)
      const result = yield* awaitWithTimeout(Fiber.join(waiting), "default question tool did not settle")
      expect(result.metadata.answers).toEqual([["One"]])
      expect(result.output).toContain('"Choose a branch"="One"')
      expect(yield* question.list()).toEqual([])
      const stale = yield* post(dir, `/api/session/${owner.id}/question/${request.id}/reject`, {})
      expect(stale.status).toBe(404)
    }).pipe(provideInstanceEffect(dir))
  }),
)
