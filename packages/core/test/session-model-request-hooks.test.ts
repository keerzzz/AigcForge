import { describe, expect } from "bun:test"
import { AIError, LLMClient, LanguageModel, Message, TransportError } from "@aigcfroge/ai"
import { OpenAIChat, OpenAIResponses } from "@aigcfroge/ai/protocols"
import { RequestExecutor } from "@aigcfroge/ai/route"
import type { ChannelObservation, WebSocketChannelExchange, WebSocketConnector } from "@aigcfroge/ai/route"
import { Agent } from "@aigcfroge/schema/agent"
import { Money } from "@aigcfroge/schema/money"
import { Session } from "@aigcfroge/schema/session"
import type { SessionRequestKind } from "@aigcfroge/plugin/effect/session"
import { Location } from "@aigcfroge/core/location"
import { Config } from "@aigcfroge/core/config"
import { ConfigMeta } from "@aigcfroge/core/config/meta"
import { Document, Info } from "@aigcfroge/schema/config"
import { PluginHooks } from "@aigcfroge/core/plugin/hooks"
import { Project } from "@aigcfroge/core/project"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionModelRequest } from "@aigcfroge/core/session/model-request"
import { Bus } from "@aigcfroge/core/bus"
import { Database } from "@aigcfroge/core/database/database"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { SessionEvent } from "@aigcfroge/core/session/event"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { CorrectionStore } from "@aigcfroge/core/session/correction-store"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionModelTransport } from "@aigcfroge/core/session/model-transport"
import { SessionRunnerModel } from "@aigcfroge/core/session/runner/model"
import { SessionRunnerRetry } from "@aigcfroge/core/session/runner/retry"
import { SessionProviderContext } from "@aigcfroge/core/session/provider-context"
import { SessionAttempt } from "@aigcfroge/schema/session-attempt"
import { Hash } from "@aigcfroge/util/hash"
import { Context, DateTime, Deferred, Effect, Fiber, Layer, Option, Queue, Schema, Stream } from "effect"
import { Headers, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { awaitWithTimeout, testEffect } from "./lib/effect"
import { makePluginTestLayerWith } from "./plugin/fixture"

const it = testEffect(makePluginTestLayerWith(LayerNode.group([SessionStore.node])))

const KINDS: ReadonlyArray<SessionRequestKind> = ["primary", "compaction", "title", "generate"]

const session = Session.Info.make({
  id: Session.ID.make("ses_hook_kind"),
  projectID: Project.ID.global,
  cost: Money.USD.zero,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
  location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
})
const model = SessionRunnerModel.resolved(OpenAIChat.route.model({ id: "gpt-5.5", provider: "test" }), {
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  cost: [],
  limit: { context: 200_000, output: 32_000 },
})
const transport = SessionModelTransport.Service.of({
  bind: () => ({ execute: () => Effect.die(new Error("unused WebSocket execution")) }),
  close: () => Effect.void,
  closeAll: Effect.void,
})

describe("SessionModelRequest HTTP hooks", () => {
  for (const kind of ["primary", "compaction"] as const) {
    for (const allowed of [true, false]) {
      it.effect(`preserves ${kind} retry hook ${allowed ? "delay replacement" : "decline"} with its producing connection`, () => Effect.gen(function* () {
        const hooks = yield* PluginHooks.Service
        const observed: PluginHooks.Domains["session"]["retry"][] = []
        yield* hooks.register("session", "retry", (event) => Effect.sync(() => {
          observed.push({ ...event })
          event.decision = allowed ? { retry: true, delay: 0 } : { retry: false }
        }))
        const selected = { ...model, connection: { type: "env" as const, name: "RETRY_HOOK_KEEPER" } }
        const requests = yield* SessionModelRequest.Service.pipe(Effect.provide(SessionModelRequest.layer.pipe(Layer.fresh)))
        const prepared = yield* requests[kind]({ session, agent: Agent.ID.make("build"), model: selected, system: [], messages: [] })
        const decide = yield* SessionRunnerRetry.policy(session.id)
        expect(yield* decide({
          cause: new AIError({ reason: new TransportError({ message: "Retry keeper", transport: "http", operation: "request", delivery: "not-sent" }) }),
          error: { type: "provider.transport", message: "Retry keeper" },
          agent: Agent.ID.make("build"), model: selected.ref, hook: prepared.retry, retry: true,
        })).toEqual(allowed ? { retry: true, attempt: 2, delay: 0 } : { retry: false, reason: "declined" })
        expect(observed).toMatchObject([{ connection: selected.connection, attempt: 2 }])
      }).pipe(Effect.provideService(SessionModelTransport.Service, transport)))
    }
  }

  for (const boundary of ["accepted", "rejected", "fallback"] as const) {
    it.effect(`P3 records actual lazy WebSocket ${boundary} delivery with the original transport`, () => Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      const url = "wss://selected-ws.test/responses?token=private-ws-query"
      yield* hooks.register("session", "experimental.ws.handshake", (event) => Effect.sync(() => {
        event.url = url
        event.headers.authorization = "Bearer private-ws-header"
      }))
      const frames = yield* Queue.unbounded<string | Uint8Array, AIError>()
      const connector: WebSocketConnector = {
        open: () => boundary === "fallback"
          ? Effect.fail(new AIError({ reason: new TransportError({ message: "Upgrade refused", transport: "websocket", operation: "request", delivery: "not-sent" }) }))
          : Effect.succeed({
              sendText: () => Queue.offer(frames, "provider-frame").pipe(Effect.asVoid),
              messages: Stream.fromQueue(frames),
              close: Queue.shutdown(frames).pipe(Effect.asVoid),
            }),
      }
      const transport = Context.get(yield* Layer.build(SessionModelTransport.makeLayer(connector)), SessionModelTransport.Service)
      const requests = yield* SessionModelRequest.Service.pipe(
        Effect.provide(SessionModelRequest.layer.pipe(Layer.fresh)),
        Effect.provideService(SessionModelTransport.Service, transport),
      )
      const prepared = yield* requests.primary({
        session, agent: Agent.ID.make("build"),
        model: SessionRunnerModel.resolved(OpenAIResponses.route.model({ id: "ws-model", provider: "test" }), {
          capabilities: { tools: true, input: ["text"], output: ["text"] }, cost: [],
          limit: { context: 200_000, output: 32_000 }, transport: "websocket",
        }),
        system: [], messages: [], webSocket: "session",
      })
      const observations: SessionAttempt.Observation[] = []
      const options = prepared.optionsForAttempt?.((observation) => Effect.sync(() => { observations.push(observation) }))
      if (options?.webSocket === undefined || options.http === undefined)
        return yield* Effect.die(new Error("Attempt observation omitted a transport boundary"))
      const http = options.http
      const exchange: WebSocketChannelExchange = {
        id: "ws-observation", connect: { url: "wss://base-ws.test/responses", headers: Headers.empty },
        fallback: () => Stream.fromEffect(http(HttpClientRequest.post("https://fallback.test/responses"),
          (sent) => Effect.succeed(HttpClientResponse.fromWeb(sent, new Response("{}", { status: 200 }))),
        ).pipe(Effect.orDie, Effect.as("http-frame"))),
        driver: {
          create: () => Effect.succeed({ message: '{"private-ws-body":true}', mode: "full" }),
          observe: (_create, frame): Effect.Effect<ChannelObservation, AIError> => boundary === "rejected"
            ? Effect.succeed({ type: "rejected", recovery: "retry-full", error: new AIError({ reason: new TransportError({
                message: "Provider rejected the response", transport: "websocket", operation: "read", phase: "receive", delivery: "rejected", recovery: "retry-full",
              }) }) })
            : Effect.succeed({ type: "completed", frame }),
        },
      }
      const execution = yield* options.webSocket.execute(exchange)
      expect(observations).toEqual([])
      const result = yield* Stream.runCollect(execution.frames).pipe(Effect.result)
      if (boundary === "rejected") expect(result).toMatchObject({ _tag: "Failure", failure: { reason: { delivery: "rejected" } } })
      if (boundary !== "rejected") expect(result._tag).toBe("Success")
      expect(observations.map((observation) => [observation.transport, observation.delivery])).toEqual(boundary === "fallback"
        ? [["http", "unknown"], ["http", "accepted"]]
        : [["websocket", "ambiguous"], ["websocket", boundary]])
      if (boundary !== "fallback") expect(observations[0].deployment?.endpoint).toBe(Hash.sha256("https://selected-ws.test/responses?token=private-ws-query"))
      const encoded = JSON.stringify(observations)
      expect(encoded).not.toContain("private-ws-query")
      expect(encoded).not.toContain("private-ws-header")
      expect(encoded).not.toContain("private-ws-body")
    }))
  }

  it.effect("P3 observes the final HTTP dispatch without hooks and preserves auxiliary options", () => Effect.gen(function* () {
    const requests = yield* SessionModelRequest.Service.pipe(Effect.provide(SessionModelRequest.layer.pipe(Layer.fresh)))
    const prepared = yield* requests.primary({ session, agent: Agent.ID.make("build"), model, system: [], messages: [] })
    expect(prepared.options.http).toBeUndefined()
    const observations: SessionAttempt.Observation[] = []
    const http = prepared.optionsForAttempt?.((observation) => Effect.sync(() => { observations.push(observation) })).http
    if (http === undefined) return yield* Effect.die(new Error("Attempt observer omitted HTTP dispatch"))
    const url = "https://dispatch.test/v1/chat/completions?route=actual"
    yield* http(HttpClientRequest.post(url), (sent) => Effect.succeed(HttpClientResponse.fromWeb(sent, new Response("{}", { status: 200 }))))
    expect(observations.map((observation) => observation.delivery)).toEqual(["unknown", "accepted"])
    expect(observations).toMatchObject([{ transport: "http", deployment: { endpoint: Hash.sha256(url), modelID: "gpt-5.5" } }, { transport: "http", deployment: { endpoint: Hash.sha256(url) } }])
    expect(prepared.options.http).toBeUndefined()
    expect(JSON.stringify(observations)).not.toContain(url)
  }).pipe(Effect.provideService(SessionModelTransport.Service, transport)))

  it.effect("P3 observes the hook-selected HTTP URL and rejection without storing request secrets", () => Effect.gen(function* () {
    const hooks = yield* PluginHooks.Service
    const url = "https://final-dispatch.test/v1/chat/completions?token=private-query"
    yield* hooks.register("session", "model.request", (event) => Effect.sync(() => { event.baseURL = "https://prepared.test/v1" }))
    yield* hooks.register("session", "http.request", (event) => Effect.sync(() => {
      event.request = new Request(url, { method: "POST", headers: { authorization: "Bearer private-header", "content-type": "application/json" }, body: '{"private-body":true}' })
    }))
    const requests = yield* SessionModelRequest.Service.pipe(Effect.provide(SessionModelRequest.layer.pipe(Layer.fresh)))
    const prepared = yield* requests.primary({ session, agent: Agent.ID.make("build"), model, system: [], messages: [] })
    const observations: SessionAttempt.Observation[] = []
    const http = prepared.optionsForAttempt?.((observation) => Effect.sync(() => { observations.push(observation) })).http
    if (http === undefined) return yield* Effect.die(new Error("Attempt observer omitted hooked dispatch"))
    yield* http(HttpClientRequest.post("https://base.test/v1/chat/completions"), (sent) => {
      expect(Option.getOrUndefined(HttpClientRequest.toUrl(sent))?.href).toBe(url)
      return Effect.succeed(HttpClientResponse.fromWeb(sent, new Response("{}", { status: 401 })))
    })
    expect(observations.map((observation) => observation.delivery)).toEqual(["unknown", "rejected"])
    expect(observations[0].deployment?.endpoint).toBe(Hash.sha256(url))
    expect(observations[0].deployment?.endpoint).not.toBe(SessionProviderContext.provenance({ model: prepared.request.model, ref: model.ref })?.endpoint)
    const encoded = JSON.stringify(observations)
    expect(encoded).not.toContain(url)
    expect(encoded).not.toContain("private-query")
    expect(encoded).not.toContain("private-header")
    expect(encoded).not.toContain("private-body")
  }).pipe(Effect.provideService(SessionModelTransport.Service, transport)))

  it.effect("P3 keeps a concurrent title rejection out of the primary's durable attempt observations", () => Effect.gen(function* () {
    const hooks = yield* PluginHooks.Service
    const database = yield* Database.Service
    const bus = yield* Bus.Service
    const store = yield* SessionStore.Service
    const primaryURL = "https://primary-dispatch.test/v1/chat/completions"
    const titleURL = "https://title-dispatch.test/v1/chat/completions"
    const seen: Array<{ kind: SessionRequestKind; agent: Agent.ID; url: string }> = []
    yield* hooks.register("session", "http.request", (event) => Effect.sync(() => {
      event.request = new Request(event.kind === "title" ? titleURL : primaryURL, { method: "POST" })
      seen.push({ kind: event.kind, agent: event.agent, url: event.request.url })
    }))
    yield* database.db.insert(ProjectTable).values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] }).onConflictDoNothing().run()
    yield* database.db.insert(SessionTable).values({ id: session.id, project_id: Project.ID.global, slug: "hook-correlation", directory: "/project", version: "test" }).run()
    const requests = yield* SessionModelRequest.Service.pipe(Effect.provide(SessionModelRequest.layer.pipe(Layer.fresh)))
    const primary = yield* requests.primary({ session, agent: Agent.ID.make("build"), model, system: [], messages: [] })
    const title = yield* requests.title({ session, agent: Agent.ID.make("title"), model: SessionRunnerModel.resolved(OpenAIChat.route.model({ id: "title-api-model", provider: "test" }), {
      capabilities: { tools: true, input: ["text"], output: ["text"] }, cost: [], limit: { context: 32_000, output: 256 },
    }), system: [], messages: [] })
    const assistantMessageID = SessionMessage.ID.make("msg_title_primary")
    yield* bus.publish(SessionEvent.Attempt.Started, { sessionID: session.id, assistantMessageID, ordinal: 0,
      attemptID: "gatt_title_primary", agent: Agent.ID.make("build"), selection: model.ref, model: model.ref,
      apiModelID: String(primary.request.model.id), quote: model.quote ?? { status: "unknown" }, goalRefs: [], transition: "initial", started: 0,
    })
    const primaryHTTP = primary.optionsForAttempt?.((observation) => bus.publish(SessionEvent.Attempt.Observed, {
      sessionID: session.id, assistantMessageID, ordinal: 0, observation,
    }).pipe(Effect.asVoid)).http
    const titleHTTP = title.options.http
    if (primaryHTTP === undefined || titleHTTP === undefined) return yield* Effect.die(new Error("Concurrent request fixture omitted HTTP dispatch"))
    const blocked = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const running = yield* primaryHTTP(HttpClientRequest.post("https://initial-primary.test/chat/completions"), (sent) => Effect.gen(function* () {
      expect(Option.getOrUndefined(HttpClientRequest.toUrl(sent))?.href).toBe(primaryURL)
      yield* Deferred.succeed(blocked, undefined)
      yield* Deferred.await(release)
      return HttpClientResponse.fromWeb(sent, new Response("{}", { status: 200 }))
    })).pipe(Effect.forkIn(yield* Effect.scope))
    yield* awaitWithTimeout(Deferred.await(blocked), "Primary HTTP dispatch did not reach its held response")
    yield* titleHTTP(HttpClientRequest.post("https://initial-title.test/chat/completions"), (sent) => {
      expect(Option.getOrUndefined(HttpClientRequest.toUrl(sent))?.href).toBe(titleURL)
      return Effect.succeed(HttpClientResponse.fromWeb(sent, new Response("{}", { status: 401 })))
    })
    expect(String(title.request.model.id)).toBe("title-api-model")
    expect(yield* store.context(session.id)).toMatchObject([{ type: "assistant", id: assistantMessageID, attempts: [{
      attemptID: "gatt_title_primary", apiModelID: String(primary.request.model.id),
      observations: [{ delivery: "unknown", deployment: { endpoint: Hash.sha256(primaryURL), modelID: String(primary.request.model.id) } }],
    }] }])
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(running)
    const context = yield* store.context(session.id)
    expect(context).toHaveLength(1)
    expect(context).toMatchObject([{ type: "assistant", id: assistantMessageID, attempts: [{ attemptID: "gatt_title_primary", observations: [
      { delivery: "unknown", deployment: { endpoint: Hash.sha256(primaryURL), modelID: String(primary.request.model.id) } },
      { delivery: "accepted", deployment: { endpoint: Hash.sha256(primaryURL), modelID: String(primary.request.model.id) } },
    ] }] }])
    expect(seen).toEqual([
      { kind: "primary", agent: Agent.ID.make("build"), url: primaryURL },
      { kind: "title", agent: Agent.ID.make("title"), url: titleURL },
    ])
  }).pipe(Effect.provideService(SessionModelTransport.Service, transport)))

  it.effect("keeps disabled correction processing empty and preserves arbitrary AI message IDs", () =>
    Effect.gen(function* () {
      const disabled = yield* CorrectionStore.Service.pipe(
        Effect.provide(CorrectionStore.layer.pipe(Layer.fresh)),
        Effect.provide(
          Layer.mock(Config.Service, {
            entries: () =>
              Effect.succeed([
                new Document({
                  type: "document",
                  info: Info.make({
                    meta: ConfigMeta.Info.make({
                      correction_store: ConfigMeta.CorrectionStore.make({ enabled: false }),
                    }),
                  }),
                }),
              ]),
          }),
        ),
      )
      expect(disabled.enabled).toBe(false)
      yield* disabled.observe({
        sessionID: session.id,
        source: {
          id: SessionMessage.ID.make("msg_disabled"),
          entries: [{ key: "POST", correct: "POST", source: "user-correction", extractLayer: 2 }],
        },
      })
      yield* disabled.completeStep(session.id)
      expect(
        yield* disabled.syncSnapshot({
          sessionID: session.id,
          visibleIDs: [],
          publish: () => Effect.die(new Error("disabled publication")),
        }),
      ).toBe(false)
      expect(yield* disabled.facts(session.id)).toEqual([])
      const requests = yield* SessionModelRequest.Service.pipe(
        Effect.provide(SessionModelRequest.layer.pipe(Layer.fresh)),
        Effect.provideService(SessionModelTransport.Service, transport),
        Effect.provideService(CorrectionStore.Service, disabled),
      )
      for (const kind of ["primary", "compaction"] as const) {
        const prepared = yield* requests[kind]({
          session,
          agent: Agent.ID.make("build"),
          model,
          system: [],
          messages: [Message.make({ id: "original-user", role: "user", content: "Keep original input" })],
        })
        expect(prepared.request.messages[0]?.id).toBe("original-user")
        expect(prepared.request.messages).toHaveLength(1)
      }
    }),
  )

  it.effect("preserves arbitrary AI message IDs with an empty correction store", () =>
    Effect.gen(function* () {
      const requests = yield* SessionModelRequest.Service.pipe(
        Effect.provide(SessionModelRequest.layer),
        Effect.provideService(SessionModelTransport.Service, transport),
      )
      for (const kind of ["primary", "compaction"] as const) {
        const prepared = yield* requests[kind]({
          session,
          agent: Agent.ID.make("build"),
          model,
          system: [],
          messages: [Message.make({ id: "original-user", role: "user", content: "Keep original input" })],
        })
        expect(prepared.request.messages[0]?.id).toBe("original-user")
      }
    }),
  )

  it.effect("uses the same committed correction snapshot in primary and compaction subsets", () =>
    Effect.gen(function* () {
      const corrections = yield* CorrectionStore.Service
      const bus = yield* Bus.Service
      const database = yield* Database.Service
      yield* database.db
        .insert(ProjectTable)
        .values({ id: session.projectID, worktree: session.location.directory, sandboxes: [] })
        .run()
      yield* bus.publish(SessionEvent.Created, {
        sessionID: session.id,
        projectID: session.projectID,
        location: session.location,
        slug: "hook-correction",
        version: "test",
      })
      const publish = (snapshot: {
        readonly text: string
        readonly metadata: typeof CorrectionStore.SnapshotMetadata.Type
      }) =>
        bus
          .publish(SessionEvent.Synthetic, { sessionID: session.id, ...snapshot })
          .pipe(Effect.map((event) => SessionMessage.ID.fromEvent(event.id)))
      yield* corrections.record({
        sessionID: session.id,
        entry: { key: "path", correct: "./old.ts", source: "user-correction", extractLayer: 2 },
      })
      yield* corrections.syncSnapshot({ sessionID: session.id, visibleIDs: [], publish })
      const oldID = (yield* corrections.snapshot(session.id)).current?.id
      if (!oldID) return yield* Effect.die(new Error("First correction snapshot missing"))
      yield* corrections.record({
        sessionID: session.id,
        entry: { key: "path", correct: "./new.ts", source: "user-correction", extractLayer: 2 },
      })
      yield* corrections.syncSnapshot({
        sessionID: session.id,
        visibleIDs: [oldID],
        publish,
      })
      const currentID = (yield* corrections.snapshot(session.id)).current?.id
      if (!currentID) return yield* Effect.die(new Error("Current correction snapshot missing"))
      const requests = yield* SessionModelRequest.Service.pipe(
        Effect.provide(SessionModelRequest.layer),
        Effect.provideService(SessionModelTransport.Service, transport),
      )
      for (const kind of KINDS) {
        const prepared = yield* requests[kind]({
          session,
          agent: Agent.ID.make("build"),
          model,
          system: [],
          messages: [
            Message.make({ id: oldID, role: "user", content: "Old derived correction" }),
            Message.user("Original user history"),
          ],
        })
        expect(prepared.request.messages.some((message) => message.id === oldID)).toBe(false)
        expect(prepared.request.messages.filter((message) => message.id === currentID)).toHaveLength(
          kind === "primary" || kind === "compaction" ? 1 : 0,
        )
        expect(
          prepared.request.messages
            .flatMap((message) => message.content)
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n"),
        ).toContain(kind === "primary" || kind === "compaction" ? "./new.ts" : "Original user history")
        expect(
          prepared.request.messages
            .flatMap((message) => message.content)
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n"),
        ).toContain("Original user history")
      }
    }),
  )

  it.effect("carries Agent request overlays into every Session flow without changing hook identity", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      const agent = Agent.ID.make("build")
      const request = {
        settings: { temperature: 0.99, reasoningEffort: "high" },
        headers: { "USER-AGENT": "agent-client", "X-Agent": "configured" },
        body: { temperature: 0.75, native: { enabled: true }, values: ["agent"] },
      } satisfies Agent.Info["request"]
      const original = structuredClone(request)
      const seen: Array<{ kind: SessionRequestKind; agent: Agent.ID; sessionID: Session.ID }> = []
      yield* hooks.register("session", "model.request", (event) =>
        Effect.sync(() => {
          seen.push({ kind: event.kind, agent: event.agent, sessionID: event.sessionID })
          expect(event.headers["USER-AGENT"]).toBe("agent-client")
          expect(Object.keys(event.headers).filter((key) => key.toLowerCase() === "user-agent")).toHaveLength(1)
          event.headers["X-Agent"] = "hooked"
        }),
      )
      const requests = yield* SessionModelRequest.Service.pipe(Effect.provide(SessionModelRequest.layer))
      yield* Effect.forEach(KINDS, (kind) =>
        Effect.gen(function* () {
          const prepared = yield* requests[kind]({ session, agent, request, model, system: [], messages: [] })
          expect(prepared.request.http?.body).toEqual(request.body)
          expect(prepared.request.http?.headers).toMatchObject({
            "USER-AGENT": "agent-client",
            "X-Agent": "hooked",
            "x-aigcfroge-session-id": session.id,
          })
          expect(prepared.request.generation?.temperature).toBeUndefined()
          expect(prepared.request.providerOptions).toBeUndefined()
        }),
      )
      expect(seen).toEqual(KINDS.map((kind) => ({ kind, agent, sessionID: session.id })))
      expect(request).toEqual(original)
    }).pipe(Effect.provideService(SessionModelTransport.Service, transport)),
  )

  it.effect("applies Agent native body overlays before HTTP hooks on the native route", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      const seen: Array<Record<string, unknown>> = []
      yield* hooks.register("session", "http.request", (event) =>
        Effect.gen(function* () {
          expect(event.kind).toBe("primary")
          expect(event.agent).toBe(Agent.ID.make("build"))
          expect(event.request.headers.get("x-agent")).toBe("configured")
          seen.push(
            Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(
              yield* Effect.promise(() => event.request.clone().text()),
            ),
          )
          event.request.headers.set("x-agent", "http-hook")
        }),
      )
      const requests = yield* SessionModelRequest.Service.pipe(Effect.provide(SessionModelRequest.layer))
      const prepared = yield* requests.primary({
        session,
        agent: Agent.ID.make("build"),
        request: {
          settings: {},
          headers: { "X-Agent": "configured" },
          body: { temperature: 0.75, custom: { chosen: "agent" }, values: ["agent"], nullable: null },
        },
        model: {
          ...model,
          model: LanguageModel.update(model.model, {
            route: model.model.route.with({
              endpoint: { baseURL: "https://example.test/v1" },
              http: {
                body: {
                  temperature: 0.1,
                  custom: { retained: true, chosen: "model" },
                  values: ["model"],
                  nullable: { value: "model" },
                },
              },
            }),
          }),
        },
        system: [],
        messages: [],
      })
      yield* LLMClient.generate(prepared.request, prepared.options).pipe(
        Effect.provide(
          LLMClient.layer.pipe(
            Layer.provide(
              RequestExecutor.layer.pipe(
                Layer.provide(
                  Layer.succeed(
                    HttpClient.HttpClient,
                    HttpClient.make((sent) =>
                      Effect.gen(function* () {
                        const web = yield* HttpClientRequest.toWeb(sent).pipe(Effect.orDie)
                        expect(web.headers.get("x-agent")).toBe("http-hook")
                        expect(
                          Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(
                            yield* Effect.promise(() => web.text()),
                          ),
                        ).toEqual(seen[0])
                        return HttpClientResponse.fromWeb(
                          sent,
                          new Response(
                            'data: {"id":"fixture","choices":[{"index":0,"delta":{"content":"done"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
                            { headers: { "content-type": "text/event-stream" } },
                          ),
                        )
                      }),
                    ),
                  ),
                ),
              ),
            ),
            Layer.fresh,
          ),
        ),
      )
      expect(seen).toEqual([
        expect.objectContaining({
          model: "gpt-5.5",
          temperature: 0.75,
          custom: { retained: true, chosen: "agent" },
          values: ["agent"],
          nullable: null,
        }),
      ])
    }).pipe(Effect.provideService(SessionModelTransport.Service, transport)),
  )

  it.effect("tags every Session request kind on http.request and http.response", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      const seen: Array<{ hook: string; kind: SessionRequestKind; agent: Agent.ID }> = []
      yield* hooks.register("session", "http.request", (event) =>
        Effect.sync(() => {
          seen.push({ hook: "request", kind: event.kind, agent: event.agent })
        }),
      )
      yield* hooks.register("session", "http.response", (event) =>
        Effect.sync(() => {
          seen.push({ hook: "response", kind: event.kind, agent: event.agent })
        }),
      )
      const requests = yield* SessionModelRequest.Service.pipe(Effect.provide(SessionModelRequest.layer))

      for (const kind of KINDS) {
        const prepared = yield* requests[kind]({
          session,
          agent: Agent.ID.make("build"),
          model,
          system: [],
          messages: [],
        })
        const http = prepared.options.http
        if (!http) throw new Error(`Expected HTTP middleware for ${kind}`)
        yield* http(HttpClientRequest.post("https://example.test/v1/chat/completions"), (request) =>
          Effect.succeed(HttpClientResponse.fromWeb(request, new Response("{}", { status: 200 }))),
        )
      }

      expect(seen).toEqual(
        KINDS.flatMap((kind) => [
          { hook: "request", kind, agent: Agent.ID.make("build") },
          { hook: "response", kind, agent: Agent.ID.make("build") },
        ]),
      )
    }).pipe(Effect.provideService(SessionModelTransport.Service, transport)),
  )

  it.effect("offers the WebSocket executor alongside HTTP hooks and routes the WebSocket hooks", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      const seen: string[] = []
      yield* hooks.register("session", "http.request", () => Effect.sync(() => void seen.push("http.request")))
      yield* hooks.register("session", "experimental.ws.handshake", (event) =>
        Effect.sync(() => {
          seen.push(`handshake:${event.kind}:${event.url}`)
          event.headers.authorization = "Bearer minted"
          delete event.headers["api-key"]
        }),
      )
      yield* hooks.register("session", "experimental.ws.send", (event) =>
        Effect.sync(() => {
          seen.push(`send:${event.kind}:${event.frame}`)
          event.frame = `${event.frame}+plugin`
        }),
      )
      yield* hooks.register("session", "experimental.ws.receive", (event) =>
        Effect.sync(() => {
          seen.push(`receive:${event.kind}:${event.frame}`)
          event.frame = event.frame.toUpperCase()
        }),
      )
      const bound: Array<{ url: string; headers: Record<string, string> }> = []
      const frames: string[] = []
      const websocketTransport = SessionModelTransport.Service.of({
        bind: (_sessionID, interceptor) => ({
          execute: () =>
            Effect.gen(function* () {
              if (!interceptor?.handshake || !interceptor.send || !interceptor.receive)
                throw new Error("Expected a full WebSocket interceptor")
              bound.push(
                yield* interceptor.handshake({ url: "wss://example.test/v1/responses", headers: { "api-key": "k" } }),
              )
              frames.push(yield* interceptor.send("create"))
              frames.push(yield* interceptor.receive("created"))
              return { frames: Stream.empty, complete: Effect.void }
            }),
        }),
        close: () => Effect.void,
        closeAll: Effect.void,
      })
      const requests = yield* SessionModelRequest.Service.pipe(
        Effect.provide(SessionModelRequest.layer),
        Effect.provideService(SessionModelTransport.Service, websocketTransport),
      )
      const prepared = yield* requests.primary({
        session,
        agent: Agent.ID.make("build"),
        model: SessionRunnerModel.resolved(OpenAIChat.route.model({ id: "gpt-5.5", provider: "test" }), {
          capabilities: { tools: true, input: ["text"], output: ["text"] },
          cost: [],
          limit: { context: 200_000, output: 32_000 },
          transport: "websocket",
        }),
        system: [],
        messages: [],
        webSocket: "session",
      })

      expect(prepared.options.http).toBeDefined()
      expect(prepared.options.webSocket).toBeDefined()
      yield* prepared.options.webSocket!.execute({} as never)
      expect(bound).toEqual([{ url: "wss://example.test/v1/responses", headers: { authorization: "Bearer minted" } }])
      expect(frames).toEqual(["create+plugin", "CREATED"])
      expect(seen).toEqual([
        "handshake:primary:wss://example.test/v1/responses",
        "send:primary:create",
        "receive:primary:created",
      ])
    }),
  )
})
