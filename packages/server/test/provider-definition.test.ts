import path from "node:path"
import { mkdir } from "node:fs/promises"
import { createServer } from "node:http"
import { expect } from "bun:test"
import { NodeFileSystem, NodeHttpServer } from "@effect/platform-node"
import { AigcForge } from "@aigcfroge/client/effect"
import { Session } from "@aigcfroge/core/session"
import { SessionRunnerModel } from "@aigcfroge/core/session/runner/model"
import { Agent } from "@aigcfroge/schema/agent"
import { Model } from "@aigcfroge/schema/model"
import { ModelGroup } from "@aigcfroge/schema/model-group"
import { Money } from "@aigcfroge/schema/money"
import { Provider } from "@aigcfroge/schema/provider"
import { ProviderDefinition } from "@aigcfroge/schema/provider-definition"
import { PromptInput } from "@aigcfroge/schema/prompt-input"
import { AbsolutePath } from "@aigcfroge/schema/schema"
import { Global } from "@aigcfroge/util/global"
import { Cause, Context, Deferred, Effect, Exit, Fiber, FileSystem, Layer, Schema, Scope, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"

const it = testEffect(Layer.mergeAll(FetchHttpClient.layer, NodeHttpServer.layerHttpServices, NodeFileSystem.layer))

const providers = [
  {
    id: Provider.ID.make("keeper-chat"),
    package: "@aigcfroge/ai/providers/openai-compatible",
    prefix: "/gateway-chat/v1",
    apiModelID: Model.ID.make("upstream-chat"),
    key: "fixture-key-chat",
    result: "Recorded Chat result",
  },
  {
    id: Provider.ID.make("keeper-messages"),
    package: "@aigcfroge/ai/providers/anthropic-compatible",
    prefix: "/gateway-messages/v1",
    apiModelID: Model.ID.make("upstream-messages"),
    key: "fixture-key-messages",
    result: "Recorded Messages result",
  },
] as const

const updatedChat = {
  ...providers[0],
  prefix: "/gateway-chat-updated/v1",
  key: "fixture-key-chat-updated",
}

const modelID = Model.ID.make("manual")
const requestJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json)))
const textMessages = Schema.Array(Schema.Struct({
  role: Schema.String,
  content: Schema.Union([
    Schema.String,
    Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.String.pipe(Schema.optional) })),
  ]),
}))
const decodeMessages = Schema.decodeUnknownSync(textMessages)

const generationServer = Effect.gen(function* () {
  const requests: { path: string; headers: Headers; body: Record<string, Schema.Json> }[] = []
  const unauthorized = new Set<Provider.ID>()
  const server = yield* Effect.acquireRelease(
    Effect.sync(() => Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const pathname = new URL(request.url).pathname
        const spec = [...providers, updatedChat].find((provider) => pathname.startsWith(provider.prefix + "/"))
        if (request.method !== "POST" || !spec) return new Response("Unexpected fixture route", { status: 404 })
        const body = requestJson(await request.text())
        requests.push({ path: pathname, headers: request.headers, body })
        if (unauthorized.has(spec.id)) return Response.json({ error: { message: "Fixture authentication rejected", type: "authentication_error" } }, { status: 401 })
        if (pathname.endsWith("/chat/completions")) {
          const chunks = [
            { id: "fixture-chat", object: "chat.completion.chunk", model: spec.apiModelID, choices: [{ index: 0, delta: { role: "assistant", content: spec.result } }] },
            { id: "fixture-chat", object: "chat.completion.chunk", model: spec.apiModelID, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } },
          ]
          return new Response(chunks.map((chunk) => "data: " + JSON.stringify(chunk) + "\n\n").join("") + "data: [DONE]\n\n", {
            headers: { "content-type": "text/event-stream" },
          })
        }
        if (!pathname.endsWith("/messages")) return new Response("Unexpected fixture protocol", { status: 404 })
        const chunks = [
          { type: "message_start", message: { id: "fixture-messages", type: "message", role: "assistant", model: spec.apiModelID, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 7, output_tokens: 0 } } },
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: spec.result } },
          { type: "content_block_stop", index: 0 },
          { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } },
          { type: "message_stop" },
        ]
        return new Response(chunks.map((chunk) => "event: " + chunk.type + "\ndata: " + JSON.stringify(chunk) + "\n\n").join(""), {
          headers: { "content-type": "text/event-stream" },
        })
      },
    })),
    (server) => Effect.promise(() => server.stop(true)),
  )
  return { server, requests, unauthorized }
})

const boot = Effect.fnUntraced(function* (directory: string) {
  const scope = yield* Scope.make()
  yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
  return yield* Effect.gen(function* () {
    const project = path.join(directory, "project")
    yield* Effect.promise(() => Promise.all([
      mkdir(project, { recursive: true }),
      mkdir(path.join(directory, "data"), { recursive: true }),
    ]))
    const context = yield* Layer.buildWithScope(
      Layer.fresh(createRoutes(
        {
          password: "secret",
          app: { version: "test-provider-definition" },
          database: { path: path.join(directory, "data", "keeper.sqlite") },
          config: { directory: path.join(directory, "config"), project: false },
          models: { fetch: false },
          events: { persist: true },
          fs: { filewatcher: false },
        },
        () => [],
        [Global.node.replace(Global.layerWith({
          home: directory,
          data: path.join(directory, "data"),
          config: path.join(directory, "config"),
          cache: path.join(directory, "cache"),
          state: path.join(directory, "state"),
          tmp: path.join(directory, "tmp"),
          bin: path.join(directory, "bin"),
          log: path.join(directory, "log"),
          repos: path.join(directory, "repos"),
        }))],
      ).pipe(Layer.provide(NodeHttpServer.layerHttpServices))),
      scope,
    )
    const native = createServer()
    const server = yield* NodeHttpServer.make(() => native, { host: "127.0.0.1", port: 0 })
    yield* Effect.addFinalizer(() => Effect.sync(() => native.closeAllConnections()))
    yield* server.serve(Context.get(context, HttpRouter.HttpRouter).asHttpEffect()).pipe(
      Effect.provide(NodeHttpServer.layerHttpServices),
    )
    const http = yield* HttpClient.HttpClient
    const client = yield* AigcForge.make({ baseUrl: HttpServer.formatAddress(server.address) }).pipe(
      Effect.provideService(HttpClient.HttpClient, http.pipe(
        HttpClient.mapRequest((request) => HttpClientRequest.setHeader(request, "authorization", "Basic " + btoa("aigcfroge:secret"))),
      )),
    )
    const location = { directory: AbsolutePath.make(project) }
    const save = Effect.fnUntraced(function* (
      providerID: Provider.ID,
      submissionID: string,
      patch: Schema.Codec.Encoded<typeof ProviderDefinition.Patch>,
      credential: Schema.Codec.Encoded<typeof ProviderDefinition.CredentialAction>,
    ) {
      const authored = yield* client.provider.definition.get({ location })
      const target = authored.data.targets.find((target) => target.scope === "global" && target.preferred && target.writable)
      if (!target) return yield* Effect.die(new Error("Provider get did not return a writable global target"))
      const saved = yield* client.provider.definition.save({
        location,
        ...Schema.decodeUnknownSync(ProviderDefinition.SaveInput)({
          providerID,
          submissionID,
          target: { scope: target.scope, path: target.path },
          expectedDigest: target.digest,
          patch,
          credential,
        }),
      })
      expect(saved.data.definition.status).toBe("saved")
      return saved.data
    })
    const run = Effect.fnUntraced(function* (
      spec: Pick<typeof providers[number], "id" | "result">,
      previousSessionID?: string,
      files?: readonly PromptInput.FileAttachment[],
    ) {
      const session = yield* previousSessionID
        ? client.session.get({ sessionID: Session.ID.make(previousSessionID) })
        : client.session.create({
          location,
          agent: Agent.ID.make("build"),
          title: "P1 keeper " + spec.id,
          model: { providerID: spec.id, id: modelID },
        })
      const prompt = "Use the saved " + spec.id + " connection"
      yield* client.session.prompt({ sessionID: session.id, text: prompt, files, resume: false })
      // Public admission and the original Session execution share this actual Server context.
      yield* awaitWithTimeout(
        Context.get(context, Session.Service).resume(Session.ID.make(session.id)),
        "The saved provider did not complete its fixture request",
        "10 seconds",
      )
      const messages = yield* client.session.context({ sessionID: session.id })
      const assistant = messages.findLast((message) => message.type === "assistant")
      if (!assistant || assistant.type !== "assistant")
        return yield* Effect.die(new Error("The actual Session context omitted the fixture Assistant"))
      expect(assistant.model).toMatchObject({ providerID: spec.id, id: modelID })
      expect(assistant.finish).toBe("stop")
      expect(assistant.content.filter((part) => part.type === "text").map((part) => part.text).join("")).toBe(spec.result)
      expect(assistant.tokens).toMatchObject({ input: 7, output: 3 })
      return session.id
    })
    return { client, location, save, run, close: Scope.close(scope, Exit.void) }
  }).pipe(Effect.provideService(Scope.Scope, scope))
})

const observeUpdates = Effect.fnUntraced(function* (client: Effect.Success<ReturnType<typeof AigcForge.make>>) {
  const connected = yield* Deferred.make<void>()
  const updates: string[] = []
  const attempts: Stream.Success<ReturnType<typeof client.event.subscribe>>[] = []
  const fiber = yield* client.event.subscribe().pipe(
    Stream.runForEach((event) => {
      if (event.type === "server.connected") return Deferred.succeed(connected, undefined).pipe(Effect.asVoid)
      if (event.type === Model.Event.Updated.type || event.type === Provider.Event.Updated.type)
        updates.push(event.type)
      if (event.type.startsWith("session.attempt.")) attempts.push(event)
      return Effect.void
    }),
    Effect.forkScoped,
  )
  yield* awaitWithTimeout(Deferred.await(connected), "The actual Server SSE subscription did not connect")
  return {
    fiber,
    updates,
    attempts,
    changed: (previous: number) => pollWithTimeout(
      Effect.sync(() => updates.slice(previous).includes(Model.Event.Updated.type) ? true : undefined),
      "The saved provider did not notify the existing model directory over SSE",
    ),
  }
})

it.live("P3 persists native groups through HTTP and SSE, falls back to the actual member, and reopens the same logical selection", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped("aigcfroge-model-group-http-")
    const fs = yield* FileSystem.FileSystem
    yield* fs.makeDirectory(path.join(tmp.path, "config"), { recursive: true })
    yield* fs.writeFileString(path.join(tmp.path, "config", "aigcfroge.jsonc"), '{\n// retained group configuration\n"model": "group:fallback"\n}\n')
    const recorder = yield* generationServer
    recorder.unauthorized.add(providers[0].id)
    const host = yield* boot(tmp.path)
    yield* Effect.forEach(providers, (spec) => host.save(spec.id, "group-provider-" + spec.id, {
      set: {
        canonical: Provider.ID.openai, name: spec.id, package: spec.package,
        settings: { baseURL: new URL(spec.prefix, recorder.server.url).href },
        models: { [modelID]: {
          modelID: spec.apiModelID, name: "Group member",
          capabilities: { tools: true, input: spec.id === providers[0].id ? ["text", "image"] : ["text"], output: ["text"] },
          limit: spec.id === providers[0].id ? { context: 1_000_000, output: 4096 } : { context: 500_000, output: 8192 },
          ...(spec.id === providers[1].id ? { cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }] } : {}),
        } },
      },
    }, { type: "create", key: spec.key, label: spec.id }))
    const groupID = Model.GroupID.make("fallback")
    const selection = new Model.GroupRef({ type: "group", groupID })
    const initial = yield* host.client.model.group.definition.get({ location: host.location, groupID })
    expect(initial.data.defaultSelection).toEqual(selection)
    expect(initial.data.effective[0]?.unavailable).toBe("missing")
    const save = Effect.fnUntraced(function* (set: typeof ModelGroup.Patch.Type["set"], digest?: string | null) {
      const read = yield* host.client.model.group.definition.get({ location: host.location, groupID })
      const target = read.data.targets.find((item) => item.scope === "global" && item.preferred && item.writable)
      if (!target) return yield* Effect.die(new Error("Group GET omitted the original writable target"))
      return yield* host.client.model.group.definition.save({
        location: host.location,
        payload: { groupID, target: { scope: target.scope, path: target.path }, expectedDigest: digest === undefined ? target.digest : digest, patch: { set } },
      })
    })
    const updated = yield* observeUpdates(host.client)
    const saved = yield* save({ members: providers.map((spec) => Model.Ref.make({ providerID: spec.id, id: modelID })) })
    expect(saved.data.definition.status).toBe("saved")
    const current = saved.data.readback?.effective[0]
    expect(current?.definition?.members.map((member) => member.providerID)).toEqual(providers.map((spec) => spec.id))
    expect(current?.definition).toMatchObject({ name: groupID, enabled: true, strategy: "order", affinity: "turn" })
    const behavior = Schema.decodeUnknownSync(ModelGroup.BehaviorSnapshot)(current?.behavior)
    expect(behavior).toMatchObject({ groupID, members: current?.definition?.members, strategy: "order", affinity: "turn" })
    expect(behavior.behaviorDigest.length).toBeGreaterThan(0)
    const unchanged = yield* save(undefined)
    expect(unchanged.data.definition.status).toBe("unchanged")
    const renamed = yield* save({ name: "Native fallback" })
    expect(Schema.decodeUnknownSync(ModelGroup.BehaviorSnapshot)(renamed.data.readback?.effective[0]?.behavior).behaviorDigest).toBe(behavior.behaviorDigest)
    const conflict = yield* save({ enabled: false }, saved.data.definition.target?.digest)
    expect(conflict.data.definition.status).toBe("conflict")
    const created = yield* host.client.session.create({ location: host.location, agent: Agent.ID.make("build"), title: "P3 native group keeper", model: { type: "group", groupID } })
    const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    yield* host.run(providers[1], created.id, [{ uri: image, name: "capability.png" }])
    yield* pollWithTimeout(Effect.sync(() => updated.attempts.filter((event) => event.type === "session.attempt.ended").length === 2 ? true : undefined), "Physical attempts were not published over the actual Server SSE")
    expect(recorder.requests.map((request) => request.path)).toEqual([providers[0].prefix + "/chat/completions", providers[1].prefix + "/messages"])
    expect(recorder.requests.map((request) => request.body.model)).toEqual(providers.map((spec) => spec.apiModelID))
    expect(recorder.requests[0]?.body.max_completion_tokens ?? recorder.requests[0]?.body.max_tokens).toBe(4096)
    expect(recorder.requests[1]?.body.max_tokens).toBe(8192)
    expect(JSON.stringify(recorder.requests[0]?.body.messages)).toContain(image)
    expect(JSON.stringify(recorder.requests[1]?.body.messages)).toContain("this model does not support image input")
    expect(JSON.stringify(recorder.requests[1]?.body.messages)).not.toContain(image)
    const persisted = yield* host.client.session.context({ sessionID: created.id })
    const assistant = persisted.findLast((message) => message.type === "assistant")
    if (!assistant || assistant.type !== "assistant") return yield* Effect.die(new Error("Native group context omitted its Assistant"))
    expect(assistant.attempts?.map((attempt) => [attempt.model.providerID, attempt.apiModelID, attempt.terminal?.status])).toEqual([[providers[0].id, providers[0].apiModelID, "failed"], [providers[1].id, providers[1].apiModelID, "completed"]])
    expect(assistant.attempts?.every((attempt) => attempt.connection?.type === "credential" && attempt.goalRefs.length === 0)).toBe(true)
    expect(assistant.attempts?.[0]?.quote.status).toBe("unknown")
    expect(assistant.attempts?.[1]?.quote.status).toBe("free")
    expect(assistant.unknownPriceAttempts).toBe(1)
    expect(assistant.missingUsageAttempts).toBe(1)
    expect(JSON.stringify(updated.attempts)).not.toContain(providers[0].key)
    expect(JSON.stringify(updated.attempts)).not.toContain(providers[1].key)
    const info = yield* host.client.session.get({ sessionID: created.id })
    expect(info.model).toEqual(selection)
    expect(info.cost).toBe(Money.USD.zero)
    expect(info.tokens).toMatchObject({ input: 7, output: 3 })
    const file = yield* fs.readFileString(path.join(tmp.path, "config", "aigcfroge.jsonc"))
    expect(file).toContain("// retained group configuration")
    yield* Fiber.interrupt(updated.fiber)
    yield* host.close
    const reopened = yield* boot(tmp.path)
    const restored = yield* reopened.client.session.get({ sessionID: created.id })
    expect(restored.model).toEqual(selection)
    expect(restored.cost).toBe(info.cost)
    expect(restored.tokens).toEqual(info.tokens)
    yield* reopened.run(providers[1], created.id)
    expect(recorder.requests).toHaveLength(4)
    const definition = yield* reopened.client.model.group.definition.get({ location: reopened.location, groupID })
    expect(definition.data.defaultSelection).toEqual(selection)
    expect(Schema.decodeUnknownSync(ModelGroup.BehaviorSnapshot)(definition.data.effective[0]?.behavior).behaviorDigest).toBe(behavior.behaviorDigest)
    const target = definition.data.targets.find((item) => item.scope === "global" && item.preferred && item.writable)
    if (!target) return yield* Effect.die(new Error("Group read omitted the writable remove target"))
    const removed = yield* reopened.client.model.group.definition.remove({
      location: reopened.location,
      payload: { groupID, target: { scope: target.scope, path: target.path }, expectedDigest: target.digest },
    })
    expect(removed.data.definition.status).toBe("saved")
    expect(removed.data.readback?.effective[0]?.unavailable).toBe("missing")
  }),
  30_000,
)

it.live("P1 saves same-template Chat and Messages instances through HTTP, reopens their original request chain, and rejects disabled execution", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped("aigcfroge-provider-definition-")
    const fixture = yield* generationServer
    const first = yield* boot(tmp.path)
    const updates = yield* observeUpdates(first.client)
    yield* Effect.forEach(providers, (spec) => Effect.gen(function* () {
      const before = updates.updates.length
      const result = yield* first.save(spec.id, "create-" + spec.id, {
        set: {
          canonical: Provider.ID.make("openai"),
          name: "Same template instance",
          package: spec.package,
          settings: { baseURL: new URL(spec.prefix, fixture.server.url).href },
          models: {
            [modelID]: {
              modelID: spec.apiModelID,
              name: "Manual model",
              capabilities: { tools: true, input: ["text"], output: ["text"] },
              limit: { context: 1_000_000, output: 32_000 },
            },
          },
        },
      }, { type: "create", key: spec.key, label: spec.id })
      expect(result.info?.definition.adoption?.phase).toBe("ready")
      expect(result.catalog.status).toBe("ready")
      expect(result.addedModelIDs).toEqual([modelID])
      yield* updates.changed(before)
      return result
    }))
    expect(fixture.requests).toHaveLength(0)
    const directory = yield* first.client.model.list({ location: first.location })
    const selected = directory.data.filter((model) => providers.some((spec) => spec.id === model.providerID))
    expect(selected).toHaveLength(2)
    expect(selected).toEqual(expect.arrayContaining(
      providers.map((spec) => expect.objectContaining({ id: modelID, providerID: spec.id, modelID: spec.apiModelID })),
    ))
    const authored = yield* first.client.provider.definition.get({ location: first.location })
    expect(JSON.stringify(authored)).not.toContain(providers[0].key)
    expect(JSON.stringify(authored)).not.toContain(providers[1].key)
    const sessionIDs = yield* Effect.forEach(providers, (spec) => first.run(spec))
    expect(fixture.requests).toHaveLength(2)
    yield* Effect.forEach(providers, (spec, index) => Effect.sync(() => {
      const request = fixture.requests[index]
      expect(request.path).toBe(spec.prefix + (index === 0 ? "/chat/completions" : "/messages"))
      expect(request.body.model).toBe(spec.apiModelID)
      expect(request.body.stream).toBe(true)
      expect(decodeMessages(request.body.messages)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: index === 0 ? "Use the saved " + spec.id + " connection" : [
            expect.objectContaining({ type: "text", text: "Use the saved " + spec.id + " connection" }),
          ],
        }),
      ]))
      expect(request.headers.get(index === 0 ? "authorization" : "x-api-key")).toBe(
        index === 0 ? "Bearer " + spec.key : spec.key,
      )
    }))
    yield* Fiber.interrupt(updates.fiber)
    yield* first.close

    const reopened = yield* boot(tmp.path)
    const reloaded = yield* reopened.client.provider.definition.get({ location: reopened.location })
    yield* Effect.forEach(providers, (spec) => Effect.sync(() => {
      const previous = authored.data.definitions.find((item) => item.providerID === spec.id)
      const restored = reloaded.data.definitions.find((item) => item.providerID === spec.id)
      if (!previous || !restored) throw new Error("The fixture provider disappeared from authored readback: " + spec.id)
      expect(restored.definition).toEqual(previous.definition)
      expect(restored.activeConnection).toEqual(previous.activeConnection)
    }))
    yield* Effect.forEach(providers, (spec, index) => reopened.run(spec, sessionIDs[index]))
    expect(fixture.requests).toHaveLength(4)
    expect(fixture.requests.slice(2).map((request) => request.body.model)).toEqual(providers.map((spec) => spec.apiModelID))
    expect(fixture.requests[2].headers.get("authorization")).toBe("Bearer " + providers[0].key)
    expect(fixture.requests[3].headers.get("x-api-key")).toBe(providers[1].key)

    const disabled = yield* reopened.save(providers[0].id, "disable-chat", { set: { disabled: true } }, { type: "keep" })
    expect(disabled.info?.definition.adoption?.phase).toBe("ready")
    expect(disabled.catalog.status).toBe("unavailable")
    expect(disabled.info?.definition.disabled).toBe(true)
    const afterDisable = yield* reopened.client.model.list({ location: reopened.location })
    expect(afterDisable.data.some((model) => model.providerID === providers[0].id)).toBe(false)
    expect(afterDisable.data.some((model) => model.providerID === providers[1].id)).toBe(true)
    const rejected = yield* reopened.run(providers[0], sessionIDs[0]).pipe(Effect.exit)
    expect(Exit.isFailure(rejected)).toBe(true)
    if (Exit.isSuccess(rejected)) return yield* Effect.die(new Error("The disabled provider unexpectedly executed"))
    expect(Cause.squash(rejected.cause)).toBeInstanceOf(SessionRunnerModel.ModelUnavailableError)
    expect(fixture.requests).toHaveLength(4)
    yield* reopened.run(providers[1], sessionIDs[1])
    expect(fixture.requests).toHaveLength(5)
    const connections = reloaded.data.definitions
      .filter((item) => providers.some((spec) => spec.id === item.providerID))
      .map((item) => item.activeConnection)
    expect(connections.every((connection) => connection?.type === "credential")).toBe(true)
    expect(new Set(connections.flatMap((connection) => connection?.type === "credential" ? [connection.id] : [])).size).toBe(2)
  }),
  30_000,
)

it.live("P1 suspends both cached Locations before switching a global Chat endpoint and credential", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped("aigcfroge-provider-definition-locations-")
    const fixture = yield* generationServer
    const host = yield* boot(tmp.path)
    const saved = yield* host.save(providers[0].id, "shared-chat", {
      set: {
        canonical: Provider.ID.make("openai"),
        name: "Shared Chat instance",
        package: providers[0].package,
        settings: { baseURL: new URL(providers[0].prefix, fixture.server.url).href },
        models: {
          [modelID]: {
            modelID: providers[0].apiModelID,
            name: "Manual model",
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            limit: { context: 1_000_000, output: 32_000 },
          },
        },
      },
    }, { type: "create", key: providers[0].key, label: providers[0].id })
    expect(saved.info?.definition.adoption?.phase).toBe("ready")
    yield* Effect.promise(() => mkdir(path.join(tmp.path, "project-b"), { recursive: true }))
    const secondLocation = { directory: AbsolutePath.make(path.join(tmp.path, "project-b")) }
    yield* Effect.forEach([host.location, secondLocation], (location) => Effect.gen(function* () {
      const directory = yield* host.client.model.list({ location })
      expect(directory.location.directory).toBe(location.directory)
      expect(directory.data).toContainEqual(expect.objectContaining({ providerID: providers[0].id, id: modelID }))
    }))
    const session = yield* host.client.session.create({
      location: secondLocation,
      agent: Agent.ID.make("build"),
      title: "P1 shared global provider",
      model: { providerID: providers[0].id, id: modelID },
    })
    yield* host.run(providers[0], session.id)
    expect(fixture.requests).toHaveLength(1)
    expect(fixture.requests[0].path).toBe(providers[0].prefix + "/chat/completions")
    expect(fixture.requests[0].headers.get("authorization")).toBe("Bearer " + providers[0].key)

    const draft = yield* host.save(providers[0].id, "switch-shared-chat", {
      set: { settings: { baseURL: new URL(updatedChat.prefix, fixture.server.url).href } },
    }, { type: "create", label: "Updated Chat account" })
    expect(draft.info?.definition.adoption?.phase).toBe("draft")
    expect(draft.credential.status).toBe("pending")
    expect(draft.info?.activeConnection).toEqual(saved.info?.activeConnection)
    yield* Effect.forEach([host.location, secondLocation], (location) => Effect.gen(function* () {
      const directory = yield* host.client.model.list({ location })
      expect(directory.location.directory).toBe(location.directory)
      expect(directory.data.some((model) => model.providerID === providers[0].id)).toBe(false)
    }))
    const rejected = yield* host.run(providers[0], session.id).pipe(Effect.exit)
    expect(Exit.isFailure(rejected)).toBe(true)
    if (Exit.isSuccess(rejected)) return yield* Effect.die(new Error("The second Location executed a pending global provider"))
    expect(Cause.squash(rejected.cause)).toBeInstanceOf(SessionRunnerModel.ModelUnavailableError)
    expect(fixture.requests).toHaveLength(1)

    const adopted = yield* host.save(providers[0].id, "switch-shared-chat", {}, {
      type: "create", key: updatedChat.key, label: "Updated Chat account",
    })
    expect(adopted.info?.definition.adoption?.phase).toBe("ready")
    expect(adopted.credential.status).toBe("created")
    expect(adopted.info?.activeConnection).toMatchObject({
      type: "credential", id: draft.info?.definition.adoption?.credentialID,
    })
    yield* host.run(updatedChat, session.id)
    expect(fixture.requests).toHaveLength(2)
    expect(fixture.requests[1].path).toBe(updatedChat.prefix + "/chat/completions")
    expect(fixture.requests[1].body.model).toBe(updatedChat.apiModelID)
    expect(fixture.requests[1].headers.get("authorization")).toBe("Bearer " + updatedChat.key)
    expect(fixture.requests.filter((request) =>
      request.path.startsWith(providers[0].prefix + "/") &&
      request.headers.get("authorization") === "Bearer " + updatedChat.key,
    )).toHaveLength(0)
  }),
  30_000,
)
