import path from "node:path"
import { createServer } from "node:http"
import { expect } from "bun:test"
import { NodeFileSystem, NodeHttpServer } from "@effect/platform-node"
import { AigcForge } from "@aigcfroge/client/effect"
import { Database } from "@aigcfroge/core/database/database"
import { Integration } from "@aigcfroge/core/integration"
import { KVTable } from "@aigcfroge/core/kv/sql"
import { LocationServiceMap } from "@aigcfroge/core/location-service-map"
import { Session } from "@aigcfroge/core/session"
import { Agent } from "@aigcfroge/schema/agent"
import { Credential } from "@aigcfroge/schema/credential"
import { Model } from "@aigcfroge/schema/model"
import { ModelSource } from "@aigcfroge/schema/model-source"
import { Provider } from "@aigcfroge/schema/provider"
import { ProviderDefinition } from "@aigcfroge/schema/provider-definition"
import { ProviderDiscovery } from "@aigcfroge/schema/provider-discovery"
import { AbsolutePath } from "@aigcfroge/schema/schema"
import { Global } from "@aigcfroge/util/global"
import { Context, DateTime, Deferred, Effect, Exit, Fiber, FileSystem, Layer, Schema, Scope, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"

const it = testEffect(Layer.mergeAll(FetchHttpClient.layer, NodeHttpServer.layerHttpServices, NodeFileSystem.layer))

const chat = {
  id: Provider.ID.make("discovery-chat"),
  package: "@aigcfroge/ai/providers/openai-compatible",
  prefix: "/gateway-chat/v1",
  key: "fixture-discovery-chat-a",
  alternateKey: "fixture-discovery-chat-b",
  apiModelID: Model.ID.make("catalog-chat-a"),
  alternateModelID: Model.ID.make("catalog-chat-b"),
  result: "Recorded discovered Chat result",
} as const
const messages = {
  id: Provider.ID.make("discovery-messages"),
  package: "@aigcfroge/ai/providers/anthropic-compatible",
  prefix: "/gateway-messages/v1",
  key: "fixture-discovery-messages",
  apiModelID: Model.ID.make("catalog-messages-a"),
  alternateModelID: Model.ID.make("catalog-messages-b"),
  result: "Recorded discovered Messages result",
} as const
const selectedID = Model.ID.make("selected")
const aliasID = Model.ID.make("personal-alias")
const retainedHeader = "fixture-retained-directory-header"
const chatMetadata = {
  name: "Discovered Chat A",
  capabilities: { tools: false, input: ["text"], output: ["text"] },
  compatibility: { maxTokensField: "max_tokens" },
  limit: { context: 1_000_000, input: 1_000_000, output: 2_048 },
  quote: { status: "unknown" },
} satisfies ModelSource.Metadata
const requestJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json)))

const recorder = Effect.gen(function* () {
  const requests: { method: string; url: URL; headers: Headers; body?: Record<string, Schema.Json> }[] = []
  const failed = new Set<Provider.ID>()
  const server = yield* Effect.acquireRelease(
    Effect.sync(() => Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        const spec = [chat, messages].find((provider) => url.pathname.startsWith(provider.prefix + "/"))
        if (!spec) return new Response("Unexpected fixture route", { status: 404 })
        const body = request.method === "POST" ? requestJson(await request.text()) : undefined
        requests.push({ method: request.method, url, headers: new Headers(request.headers), body })
        if (request.method === "GET" && url.pathname === spec.prefix + "/models") {
          if (failed.has(spec.id)) return Response.json({ error: "Rejected " + spec.key }, { status: 401 })
          if (spec.id === chat.id) {
            const key = request.headers.get("authorization")
            if (key === "Bearer " + chat.alternateKey) return Response.json({
              data: [{ id: chat.alternateModelID, metadata: { ...chatMetadata, name: "Discovered Chat B" } }],
            })
            if (key !== "Bearer " + chat.key) return Response.json({ error: "Missing fixture account" }, { status: 401 })
            return Response.json({ data: [
              { id: chat.apiModelID, metadata: chatMetadata },
              { id: "candidate-only", metadata: { name: "Unselected candidate" } },
            ] })
          }
          if (request.headers.get("x-api-key") !== messages.key)
            return Response.json({ error: "Missing fixture account" }, { status: 401 })
          if (!url.searchParams.has("after_id")) return Response.json({
            data: [{ id: messages.apiModelID, display_name: "Discovered Messages A", max_input_tokens: 1_000_000, max_tokens: 2_048 }],
            has_more: true,
            last_id: messages.apiModelID,
          })
          if (url.searchParams.get("after_id") !== messages.apiModelID)
            return new Response("Unexpected fixture cursor", { status: 400 })
          return Response.json({
            data: [{
              id: messages.alternateModelID,
              display_name: "Discovered Messages B",
              max_input_tokens: 1_000_000,
              max_tokens: 2_048,
              capabilities: { image_input: { supported: false }, pdf_input: { supported: false } },
              metadata: { capabilities: { tools: false, output: ["text"] } },
            }],
            has_more: false,
            last_id: messages.alternateModelID,
          })
        }
        if (request.method !== "POST" || !body)
          return new Response("Unexpected fixture method", { status: 404 })
        if (url.pathname === chat.prefix + "/chat/completions") {
          const chunks = [
            { id: "fixture-discovery-chat", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: { role: "assistant", content: chat.result } }] },
            { id: "fixture-discovery-chat", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } },
          ]
          return new Response(chunks.map((chunk) => "data: " + JSON.stringify(chunk) + "\n\n").join("") + "data: [DONE]\n\n", {
            headers: { "content-type": "text/event-stream" },
          })
        }
        if (url.pathname !== messages.prefix + "/messages")
          return new Response("Unexpected fixture generation route", { status: 404 })
        const chunks = [
          { type: "message_start", message: { id: "fixture-discovery-messages", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 7, output_tokens: 0 } } },
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: messages.result } },
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
  return { server, requests, failed }
})

const boot = Effect.fnUntraced(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem
  const scope = yield* Scope.make()
  yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
  return yield* Effect.gen(function* () {
    const project = path.join(directory, "project")
    yield* fs.makeDirectory(project, { recursive: true })
    yield* fs.makeDirectory(path.join(directory, "data"), { recursive: true })
    const context = yield* Layer.buildWithScope(
      Layer.fresh(createRoutes({
        password: "secret",
        app: { version: "test-provider-discovery" },
        database: { path: path.join(directory, "data", "keeper.sqlite") },
        config: { directory: path.join(directory, "config"), project: false },
        models: { fetch: false },
        events: { persist: true },
        fs: { filewatcher: false },
      }, () => [], [Global.node.replace(Global.layerWith({
        home: directory,
        data: path.join(directory, "data"),
        config: path.join(directory, "config"),
        cache: path.join(directory, "cache"),
        state: path.join(directory, "state"),
        tmp: path.join(directory, "tmp"),
        bin: path.join(directory, "bin"),
        log: path.join(directory, "log"),
        repos: path.join(directory, "repos"),
      }))]).pipe(Layer.provide(NodeHttpServer.layerHttpServices))),
      scope,
    )
    const native = createServer()
    const server = yield* NodeHttpServer.make(() => native, { host: "127.0.0.1", port: 0 })
    yield* Effect.addFinalizer(() => Effect.sync(() => native.closeAllConnections()))
    yield* server.serve(Context.get(context, HttpRouter.HttpRouter).asHttpEffect()).pipe(
      Effect.provide(NodeHttpServer.layerHttpServices),
    )
    const http = yield* HttpClient.HttpClient
    const makeClient = () => AigcForge.make({ baseUrl: HttpServer.formatAddress(server.address) }).pipe(
      Effect.provideService(HttpClient.HttpClient, http.pipe(
        HttpClient.mapRequest((request) => HttpClientRequest.setHeader(request, "authorization", "Basic " + btoa("aigcfroge:secret"))),
      )),
    )
    const client = yield* makeClient()
    const location = { directory: AbsolutePath.make(project) }
    const snapshot = Effect.fnUntraced(function* () {
      yield* client.model.list({ location })
      const authored = yield* client.provider.definition.get({ location })
      // Routes expose Database; KV remains an internal dependency of the Location graph.
      const cache = yield* Context.get(context, Database.Service).db
        .select({ key: KVTable.key, value: KVTable.value })
        .from(KVTable)
        .orderBy(KVTable.key)
        .all()
        .pipe(Effect.orDie)
      return {
        authored: authored.data,
        files: yield* Effect.forEach(authored.data.targets, (target) => Effect.gen(function* () {
          return { path: target.path, text: (yield* fs.exists(target.path)) ? yield* fs.readFileString(target.path) : undefined }
        })),
        credentials: yield* client.credential.list(),
        cache,
        models: (yield* client.model.list({ location })).data,
      }
    })
    const save = Effect.fnUntraced(function* (
      providerID: Provider.ID,
      submissionID: string,
      patch: Schema.Codec.Encoded<typeof ProviderDefinition.Patch>,
      credential: Schema.Codec.Encoded<typeof ProviderDefinition.CredentialAction>,
    ) {
      const authored = yield* client.provider.definition.get({ location })
      const target = authored.data.targets.find((target) => target.scope === "global" && target.preferred && target.writable)
      if (!target) return yield* Effect.die(new Error("Provider read omitted a writable global target"))
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
      expect(saved.data.info?.definition.adoption?.phase).toBe("ready")
      return saved.data
    })
    const run = Effect.fnUntraced(function* (model: Model.Ref, result: string, previousSessionID?: string) {
      const session = yield* previousSessionID
        ? client.session.get({ sessionID: Session.ID.make(previousSessionID) })
        : client.session.create({ location, agent: Agent.ID.make("build"), title: "P2 keeper " + model.providerID, model })
      yield* client.session.prompt({ sessionID: session.id, text: "Use the selected discovered model", resume: false })
      yield* awaitWithTimeout(
        Context.get(context, Session.Service).resume(Session.ID.make(session.id)),
        "The imported model did not complete its original Session request",
        "10 seconds",
      )
      const assistant = (yield* client.session.context({ sessionID: session.id })).findLast((message) => message.type === "assistant")
      if (!assistant || assistant.type !== "assistant")
        return yield* Effect.die(new Error("The actual Session omitted the imported model's Assistant"))
      expect(assistant.model).toMatchObject(model)
      expect(assistant.finish).toBe("stop")
      expect(assistant.content.filter((part) => part.type === "text").map((part) => part.text).join("")).toBe(result)
      expect(assistant.tokens).toMatchObject({ input: 7, output: 3 })
      return session.id
    })
    return { client, makeClient, location, context, snapshot, save, run, baseURL: HttpServer.formatAddress(server.address), close: Scope.close(scope, Exit.void) }
  }).pipe(Effect.provideService(Scope.Scope, scope))
})

const observeDiscovery = Effect.fnUntraced(function* (
  client: Effect.Success<ReturnType<typeof AigcForge.make>>,
  location: { readonly directory: AbsolutePath },
  providerID: Provider.ID,
) {
  const connected = yield* Deferred.make<void>()
  const notifications: { providerID: Provider.ID; connection?: ModelSource.ConnectionRef }[] = []
  const reads: ProviderDiscovery.Read[] = []
  const fiber = yield* client.event.subscribe().pipe(
    Stream.runForEach((event) => Effect.gen(function* () {
      if (event.type === "server.connected") {
        yield* Deferred.succeed(connected, undefined)
        return
      }
      if (event.type !== ProviderDiscovery.Event.Updated.type || event.data.providerID !== providerID) return
      notifications.push(event.data)
      reads.push((yield* client.provider.discovery.get({ location, providerID, connection: event.data.connection })).data)
    })),
    Effect.forkScoped,
  )
  yield* awaitWithTimeout(Deferred.await(connected), "The discovery status SSE connection did not become ready")
  return {
    fiber,
    notifications,
    reads,
    seen: (phase: ProviderDiscovery.Status["phase"], generation: number) => pollWithTimeout(
      Effect.sync(() => reads.findLast((read) => read.status.phase === phase && read.status.generation >= generation)),
      "The discovery status SSE client did not reread " + phase,
    ),
  }
})

it.live("P2 saves key-preview aliases once, retries their bound seed exactly, and executes before refresh and after discovery shutdown", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped("aigcfroge-provider-discovery-import-")
    const fixture = yield* recorder
    const host = yield* boot(tmp.path)
    const definition = {
      canonical: Provider.ID.make("openai"),
      package: chat.package,
      settings: { baseURL: new URL(chat.prefix, fixture.server.url).href },
      headers: { "x-fixture-secret": retainedHeader },
      discovery: { enabled: true, autoSync: false, list: { protocol: "openai" as const } },
    }
    const before = yield* host.snapshot()
    const preview = yield* host.client.provider.discovery.preview({
      location: host.location,
      ...ProviderDiscovery.decodePreview({ providerID: chat.id, definition: { type: "new", definition }, credential: { type: "key", key: chat.key } }),
    })
    expect(preview.data.status).toMatchObject({ phase: "ready", cachePersisted: false })
    expect(preview.data.inventory?.complete).toBe(true)
    expect(preview.data.candidates.map((candidate) => candidate.id)).toEqual([chat.apiModelID, Model.ID.make("candidate-only")])
    expect(preview.data.candidates.every((candidate) => candidate.managedRefs.length === 0)).toBe(true)
    expect(preview.data.managed).toEqual([])
    expect(yield* host.snapshot()).toEqual(before)
    expect(fixture.requests).toHaveLength(1)
    expect(fixture.requests[0].method).toBe("GET")
    expect(fixture.requests[0].url.pathname).toBe(chat.prefix + "/models")
    expect(fixture.requests[0].headers.get("authorization")).toBe("Bearer " + chat.key)

    const inventory = preview.data.inventory
    const selected = inventory?.models.find((candidate) => candidate.id === chat.apiModelID)
    const target = before.authored.targets.find((target) => target.scope === "global" && target.preferred && target.writable)
    if (!inventory || !selected || !target) return yield* Effect.die(new Error("Key preview omitted its inventory or writable target"))
    expect(inventory.identity.connection).toBeUndefined()
    const transient = { identity: inventory.identity, inventoryDigest: inventory.digest, observedAt: inventory.observedAt, metadata: selected.metadata }
    const input = ProviderDefinition.decodeSave({
      providerID: chat.id,
      submissionID: "import-key-preview-chat",
      target: { scope: target.scope, path: target.path },
      expectedDigest: target.digest,
      patch: { set: { ...definition, models: {
        [selectedID]: { modelID: selected.id, seed: transient },
        [aliasID]: { modelID: selected.id, seed: transient, name: "Personal alias" },
      } } },
      credential: { type: "create", key: chat.key, label: "Chat A" },
    })
    const connected = yield* Deferred.make<void>()
    const credentialEvents: string[] = []
    const events = yield* host.client.event.subscribe().pipe(
      Stream.runForEach((event) => {
        if (event.type === "server.connected") return Deferred.succeed(connected, undefined).pipe(Effect.asVoid)
        if (event.type === Credential.Event.Updated.type || event.type === Credential.Event.Switched.type)
          credentialEvents.push(event.type)
        return Effect.void
      }),
      Effect.forkScoped,
    )
    yield* awaitWithTimeout(Deferred.await(connected), "Key-preview save SSE did not connect")
    const imported = (yield* host.client.provider.definition.save({ ...input, location: host.location })).data
    expect(imported.definition.status).toBe("saved")
    expect(imported.info?.definition.adoption?.phase).toBe("ready")
    const credentialID = imported.info?.definition.adoption?.credentialID
    if (imported.info?.definition.adoption?.phase !== "ready" || !credentialID)
      return yield* Effect.die(new Error("The one-step save omitted its ready credential adoption"))
    expect(imported.credential.credentialID).toBe(credentialID)
    expect(imported.addedModelIDs).toEqual([selectedID, aliasID])
    expect(imported.credential.status).toBe("created")
    const seed = imported.info?.definition.models?.[selectedID]?.seed
    if (!seed) return yield* Effect.die(new Error("The one-step save omitted its bound import seed"))
    expect(seed).toEqual({ ...transient, identity: { ...transient.identity, connection: { type: "credential", id: credentialID } } })
    expect(imported.info?.definition.models?.[aliasID]?.seed).toEqual(seed)
    const admitted = yield* host.snapshot()
    const retry = (yield* host.client.provider.definition.save({ ...input, location: host.location })).data
    expect(retry.definition.status).toBe("unchanged")
    expect(retry.credential).toEqual(imported.credential)
    expect(retry.info?.activeConnection).toEqual(imported.info?.activeConnection)
    expect(retry.info?.definition).toEqual(imported.info?.definition)
    expect(retry.definition.target?.digest).toBe(imported.definition.target?.digest)
    expect(yield* host.snapshot()).toEqual(admitted)
    yield* pollWithTimeout(Effect.sync(() => credentialEvents.includes(Credential.Event.Switched.type) ? true : undefined), "The original save did not activate its account")
    expect(credentialEvents.filter((type) => type === Credential.Event.Updated.type)).toHaveLength(1)
    expect(credentialEvents.filter((type) => type === Credential.Event.Switched.type)).toHaveLength(1)
    yield* Fiber.interrupt(events)
    const directory = (yield* host.client.model.list({ location: host.location })).data.filter((model) => model.providerID === chat.id)
    expect(directory).toHaveLength(2)
    expect(directory).toContainEqual(expect.objectContaining({ id: selectedID, modelID: chat.apiModelID, name: chatMetadata.name, capabilities: { tools: false, input: ["text"], output: ["text"] }, limit: chatMetadata.limit }))
    expect(directory.some((model) => model.id === "candidate-only")).toBe(false)
    const seeded = (yield* host.client.provider.discovery.get({ location: host.location, providerID: chat.id })).data
    expect(seeded.inventory).toBeUndefined()
    expect(seeded.managed.find((model) => model.ref.id === selectedID)).toMatchObject({ metadata: chatMetadata, origins: {
      name: "seed", compatibility: { maxTokensField: "seed" }, capabilities: { tools: "seed", input: "seed", output: "seed" }, limit: { context: "seed", input: "seed", output: "seed" }, quote: "unknown",
    } })
    const sessionID = yield* host.run({ providerID: chat.id, id: selectedID }, chat.result)
    expect(fixture.requests.filter((request) => request.method === "GET")).toHaveLength(1)
    const generation = fixture.requests.findLast((request) => request.method === "POST")
    expect(generation?.url.pathname).toBe(chat.prefix + "/chat/completions")
    expect(generation?.headers.get("authorization")).toBe("Bearer " + chat.key)
    expect(generation?.body).toMatchObject({ model: chat.apiModelID, stream: true, max_tokens: 2_048 })

    const refreshed = (yield* host.client.provider.discovery.refresh({ location: host.location, providerID: chat.id })).data
    expect(refreshed.status).toMatchObject({ phase: "ready", cachePersisted: true })
    expect(refreshed.inventory?.identity).toEqual(seed.identity)
    const managed = (yield* host.client.provider.discovery.get({ location: host.location, providerID: chat.id })).data
    expect(managed.candidates.find((candidate) => candidate.id === selected.id)?.managedRefs).toEqual(expect.arrayContaining([
      { providerID: chat.id, id: selectedID },
      { providerID: chat.id, id: aliasID },
    ]))
    expect(managed.managed.find((model) => model.ref.id === selectedID)?.origins.name).toBe("live")
    expect(managed.managed.find((model) => model.ref.id === aliasID)?.origins.name).toBe("user")
    expect(managed.managed.find((model) => model.ref.id === selectedID)?.metadata.quote).toEqual({ status: "unknown" })
    yield* host.save(chat.id, "disable-discovery-chat", { set: { discovery: { enabled: false } } }, { type: "keep" })
    const disabled = (yield* host.client.provider.discovery.get({ location: host.location, providerID: chat.id })).data
    expect(disabled.status.phase).toBe("disabled")
    expect(disabled.managed.find((model) => model.ref.id === selectedID)).toMatchObject({ seed, metadata: { name: chatMetadata.name }, origins: { name: "seed", capabilities: { tools: "seed" }, limit: { output: "seed" } } })
    const listRequests = fixture.requests.filter((request) => request.method === "GET").length
    yield* host.run({ providerID: chat.id, id: selectedID }, chat.result, sessionID)
    yield* host.close
    const reopened = yield* boot(tmp.path)
    const restored = (yield* reopened.client.provider.discovery.get({ location: reopened.location, providerID: chat.id })).data
    expect(restored.status.phase).toBe("disabled")
    expect(restored.managed.find((model) => model.ref.id === selectedID)?.seed).toEqual(seed)
    expect(restored.managed.find((model) => model.ref.id === selectedID)?.origins.name).toBe("seed")
    yield* reopened.run({ providerID: chat.id, id: selectedID }, chat.result, sessionID)
    expect(fixture.requests.filter((request) => request.method === "GET")).toHaveLength(listRequests)
    expect(fixture.requests.filter((request) => request.method === "POST")).toHaveLength(3)
    expect(fixture.requests.filter((request) => request.method === "POST").every((request) =>
      request.url.pathname === chat.prefix + "/chat/completions" && request.body?.model === chat.apiModelID && request.body.max_tokens === 2_048 && request.headers.get("authorization") === "Bearer " + chat.key,
    )).toBe(true)
  }),
  30_000,
)

it.live("P2 keeps same-URL accounts separate, preserves stored preview secrets, and rereads failures over two actual SSE connections", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped("aigcfroge-provider-discovery-status-")
    const fixture = yield* recorder
    const host = yield* boot(tmp.path)
    const saved = yield* host.save(chat.id, "save-account-directory", { set: {
      canonical: Provider.ID.make("openai"),
      package: chat.package,
      settings: { baseURL: new URL(chat.prefix, fixture.server.url).href },
      headers: { "x-fixture-secret": retainedHeader },
      discovery: { enabled: true, autoSync: false, list: { protocol: "openai" } },
    } }, { type: "create", key: chat.key, label: "Chat A" })
    const credentialID = saved.info?.definition.adoption?.credentialID
    if (saved.info?.definition.adoption?.phase !== "ready" || !credentialID)
      return yield* Effect.die(new Error("The saved account omitted its ready credential adoption"))
    expect(saved.credential.credentialID).toBe(credentialID)
    const first = (yield* host.client.provider.discovery.refresh({ location: host.location, providerID: chat.id })).data
    const alternate = yield* host.client.credential.create({ integrationID: Integration.ID.make(chat.id), label: "Chat B", value: Credential.Key.make({ type: "key", key: chat.alternateKey }), activate: false })
    const authored = yield* pollWithTimeout(
      host.client.provider.definition.get({ location: host.location, providerID: chat.id }).pipe(Effect.map((read) =>
        read.data.definitions.some((item) => item.connections.some((connection) => connection.type === "credential" && connection.id === alternate.id)) ? read : undefined,
      )),
      "The alternate stored account did not enter the provider's connection directory",
    )
    const target = authored.data.targets.find((target) => target.scope === "global" && target.preferred && target.writable)
    if (!target) return yield* Effect.die(new Error("Stored preview omitted its authored target"))
    expect(authored.data.definitions[0].redactedPaths).toContainEqual(["headers", "x-fixture-secret"])
    expect(authored.data.definitions[0].definition.headers?.["x-fixture-secret"]).toBeUndefined()
    const definition = { type: "stored" as const, target: { scope: target.scope, path: target.path }, expectedDigest: target.digest, patch: Schema.decodeUnknownSync(ProviderDefinition.Patch)({ set: { name: "Preview name" } }) }
    const before = yield* host.snapshot()
    const active = (yield* host.client.provider.discovery.preview({ location: host.location, providerID: chat.id, definition, credential: { type: "active" } })).data
    expect(active.candidates.map((candidate) => candidate.id)).toEqual([chat.apiModelID, Model.ID.make("candidate-only")])
    expect(fixture.requests.at(-1)?.headers.get("authorization")).toBe("Bearer " + chat.key)
    expect(fixture.requests.at(-1)?.headers.get("x-fixture-secret")).toBe(retainedHeader)
    const currentKey = (yield* host.client.provider.discovery.preview({ location: host.location, providerID: chat.id, definition, credential: { type: "key", key: chat.alternateKey } })).data
    expect(currentKey.candidates.map((candidate) => candidate.id)).toEqual([chat.alternateModelID])
    expect(fixture.requests.at(-1)?.headers.get("authorization")).toBe("Bearer " + chat.alternateKey)
    const alternateRef = { type: "credential" as const, id: alternate.id }
    const explicit = (yield* host.client.provider.discovery.preview({ location: host.location, providerID: chat.id, definition, credential: { type: "connection", connection: alternateRef } })).data
    expect(explicit.inventory?.identity.connection).toEqual(alternateRef)
    expect(explicit.candidates.map((candidate) => candidate.id)).toEqual([chat.alternateModelID])
    expect(yield* host.snapshot()).toEqual(before)
    const second = (yield* host.client.provider.discovery.refresh({ location: host.location, providerID: chat.id, connection: alternateRef })).data
    expect(second.inventory?.identity.listURL).toBe(first.inventory?.identity.listURL)
    expect(second.inventory?.identity.connection).toEqual(alternateRef)
    expect(second.inventory?.models.map((model) => model.id)).toEqual([chat.alternateModelID])
    const activeRead = (yield* host.client.provider.discovery.get({ location: host.location, providerID: chat.id })).data
    expect(activeRead.inventory).toEqual(first.inventory)
    expect(activeRead.status.identity?.connection).toEqual({ type: "credential", id: credentialID })
    expect((yield* host.client.provider.discovery.get({ location: host.location, providerID: chat.id, connection: alternateRef })).data.inventory).toEqual(second.inventory)
    const malformed = yield* (yield* HttpClient.HttpClient).execute(HttpClientRequest.get(host.baseURL + "/api/provider/discovery").pipe(
      HttpClientRequest.setUrlParams({ providerID: chat.id, "location[directory]": host.location.directory, "connection[type]": "credential" }),
      HttpClientRequest.setHeader("authorization", "Basic " + btoa("aigcfroge:secret")),
    ))
    expect(malformed.status).toBe(400)
    expect(yield* malformed.json).toMatchObject({ field: "connection" })

    const left = yield* observeDiscovery(yield* host.makeClient(), host.location, chat.id)
    const right = yield* observeDiscovery(yield* host.makeClient(), host.location, chat.id)
    fixture.failed.add(chat.id)
    const failed = (yield* host.client.provider.discovery.refresh({ location: host.location, providerID: chat.id, force: true })).data
    expect(failed.status).toMatchObject({ phase: "failed", error: { kind: "auth" }, lastSuccessAt: activeRead.status.lastSuccessAt })
    expect(failed.inventory).toEqual(activeRead.inventory)
    expect(failed.status.generation).toBeGreaterThan(activeRead.status.generation)
    const leftFailure = yield* left.seen("failed", failed.status.generation)
    const rightFailure = yield* right.seen("failed", failed.status.generation)
    expect(leftFailure).toEqual(failed)
    expect(rightFailure).toEqual(failed)
    expect(left.notifications).toContainEqual({ providerID: chat.id, connection: failed.status.identity?.connection })
    expect(JSON.stringify({ failed, events: left.notifications })).not.toContain(chat.key)
    expect(JSON.stringify({ failed, events: right.notifications })).not.toContain(retainedHeader)
    yield* Fiber.interrupt(left.fiber)
    fixture.failed.delete(chat.id)
    const recovered = (yield* host.client.provider.discovery.refresh({ location: host.location, providerID: chat.id, force: true })).data
    expect(recovered.status.phase).toBe("ready")
    expect(recovered.inventory?.digest).toBe(first.inventory?.digest)
    expect(yield* right.seen("ready", recovered.status.generation)).toEqual(recovered)
    const reconnectedClient = yield* host.makeClient()
    const reconnected = yield* observeDiscovery(reconnectedClient, host.location, chat.id)
    expect((yield* reconnectedClient.provider.discovery.get({ location: host.location, providerID: chat.id })).data).toEqual(recovered)
    expect(fixture.requests.filter((request) => request.method === "POST")).toHaveLength(0)
    yield* Fiber.interrupt(right.fiber)
    yield* Fiber.interrupt(reconnected.fiber)
  }),
  30_000,
)

it.live("P2 follows the Messages listing cursor through HTTP and sends its imported API model through the original Session", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped("aigcfroge-provider-discovery-messages-")
    const fixture = yield* recorder
    const host = yield* boot(tmp.path)
    const definition = {
      canonical: Provider.ID.make("anthropic"),
      package: messages.package,
      settings: { baseURL: new URL(messages.prefix, fixture.server.url).href },
      discovery: { enabled: true, autoSync: false, list: { protocol: "anthropic" as const } },
    }
    const before = yield* host.snapshot()
    const preview = (yield* host.client.provider.discovery.preview({
      location: host.location,
      ...ProviderDiscovery.decodePreview({ providerID: messages.id, definition: { type: "new", definition }, credential: { type: "key", key: messages.key } }),
    })).data
    expect(preview.inventory?.complete).toBe(true)
    expect(preview.candidates.map((candidate) => candidate.id)).toEqual([messages.apiModelID, messages.alternateModelID])
    expect(yield* host.snapshot()).toEqual(before)
    expect(fixture.requests).toHaveLength(2)
    expect(fixture.requests.map((request) => request.url.pathname)).toEqual([messages.prefix + "/models", messages.prefix + "/models"])
    expect(fixture.requests.map((request) => request.url.searchParams.get("after_id"))).toEqual([null, messages.apiModelID])
    expect(fixture.requests.every((request) => request.headers.get("x-api-key") === messages.key && request.headers.get("anthropic-version") === "2023-06-01")).toBe(true)
    yield* host.save(messages.id, "save-discovery-messages", { set: definition }, { type: "create", key: messages.key, label: "Messages" })
    const inventory = (yield* host.client.provider.discovery.refresh({ location: host.location, providerID: messages.id })).data.inventory
    const candidate = inventory?.models.find((model) => model.id === messages.alternateModelID)
    if (!inventory || !candidate) return yield* Effect.die(new Error("The complete saved Messages inventory omitted its second page"))
    expect(candidate.metadata).toMatchObject({ name: "Discovered Messages B", capabilities: { tools: false, input: ["text"], output: ["text"] }, limit: { context: 1_000_000, input: 1_000_000, output: 2_048 } })
    yield* host.save(messages.id, "import-discovery-messages", { set: { models: { [selectedID]: {
      modelID: candidate.id,
      seed: { identity: inventory.identity, inventoryDigest: inventory.digest, observedAt: inventory.observedAt, metadata: candidate.metadata },
    } } } }, { type: "keep" })
    yield* host.run({ providerID: messages.id, id: selectedID }, messages.result)
    const generation = fixture.requests.findLast((request) => request.method === "POST")
    expect(generation?.url.pathname).toBe(messages.prefix + "/messages")
    expect(generation?.headers.get("x-api-key")).toBe(messages.key)
    expect(generation?.headers.get("anthropic-version")).toBe("2023-06-01")
    expect(generation?.body).toMatchObject({ model: messages.alternateModelID, stream: true, max_tokens: 2_048 })
    expect(fixture.requests.filter((request) => request.method === "POST")).toHaveLength(1)
  }),
  30_000,
)

it.live("P2 previews an expiring OAuth account without renewal and lets explicit refresh renew its actual stored credential once", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped("aigcfroge-provider-discovery-oauth-")
    const fixture = yield* recorder
    const host = yield* boot(tmp.path)
    yield* host.save(chat.id, "save-oauth-directory", { set: {
      canonical: Provider.ID.make("openai"),
      package: chat.package,
      settings: { baseURL: new URL(chat.prefix, fixture.server.url).href },
      discovery: { enabled: true, autoSync: false, list: { protocol: "openai" } },
    } }, { type: "keep" })
    const methodID = Integration.MethodID.make("fixture-directory-oauth")
    const original = Credential.OAuth.make({ type: "oauth", methodID, refresh: "fixture-oauth-refresh-a", access: chat.key, expires: 0 })
    const callbacks: Credential.OAuth[] = []
    const services = yield* Context.get(host.context, LocationServiceMap.Service).contextEffect(host.location)
    const integration = Context.get(services, Integration.Service)
    yield* integration.transform((editor) => editor.method.update({
      integrationID: Integration.ID.make(chat.id),
      method: { id: methodID, type: "oauth", label: "Loopback directory OAuth" },
      authorize: () => Effect.succeed({
        mode: "auto" as const,
        url: fixture.server.url.href,
        instructions: "Loopback OAuth fixture",
        callback: Effect.succeed(original),
      }),
      refresh: (credential) => Effect.gen(function* () {
        callbacks.push(credential)
        return Credential.OAuth.make({
          ...credential,
          access: chat.alternateKey,
          refresh: "fixture-oauth-refresh-b",
          expires: (yield* DateTime.nowAsDate).getTime() + 3_600_000,
        })
      }),
    }))
    const account = yield* host.client.credential.create({ integrationID: Integration.ID.make(chat.id), label: "Expiring OAuth", value: original })
    const connection = { type: "credential" as const, id: account.id }
    expect(account.value).toEqual(original)
    expect((yield* host.client.integration.get({ location: host.location, integrationID: Integration.ID.make(chat.id) })).data.methods)
      .toContainEqual(expect.objectContaining({ type: "oauth", id: methodID }))
    const connected = yield* Deferred.make<void>()
    const credentialUpdates: string[] = []
    const events = yield* host.client.event.subscribe().pipe(
      Stream.runForEach((event) => {
        if (event.type === "server.connected") return Deferred.succeed(connected, undefined).pipe(Effect.asVoid)
        if (event.type === Credential.Event.Updated.type) credentialUpdates.push(event.type)
        return Effect.void
      }),
      Effect.forkScoped,
    )
    yield* awaitWithTimeout(Deferred.await(connected), "OAuth credential SSE did not connect")
    const discovery = yield* observeDiscovery(yield* host.makeClient(), host.location, chat.id)
    const before = yield* host.snapshot()
    const target = before.authored.targets.find((target) => target.scope === "global" && target.preferred && target.writable)
    if (!target) return yield* Effect.die(new Error("OAuth preview omitted its authored target"))
    const definition = {
      type: "stored" as const,
      target: { scope: target.scope, path: target.path },
      expectedDigest: target.digest,
      patch: {},
    }
    yield* Effect.forEach([{ type: "active" }, { type: "connection", connection }] as const, (credential) => Effect.gen(function* () {
      const preview = (yield* host.client.provider.discovery.preview({ location: host.location, providerID: chat.id, definition, credential })).data
      expect(preview.status).toMatchObject({ phase: "ready", cachePersisted: false })
      expect(preview.inventory?.identity.connection).toEqual(connection)
      expect(preview.candidates.map((candidate) => candidate.id)).toEqual([chat.apiModelID, Model.ID.make("candidate-only")])
      expect(fixture.requests.at(-1)?.headers.get("authorization")).toBe("Bearer " + original.access)
    }))
    expect(callbacks).toEqual([])
    expect(credentialUpdates).toHaveLength(0)
    expect(yield* host.snapshot()).toEqual(before)
    const refreshed = (yield* host.client.provider.discovery.refresh({ location: host.location, providerID: chat.id, connection })).data
    expect(callbacks).toEqual([original])
    expect(refreshed.status.phase).toBe("ready")
    expect(refreshed.inventory?.identity.connection).toEqual(connection)
    expect(refreshed.inventory?.models.map((model) => model.id)).toEqual([chat.alternateModelID])
    expect(fixture.requests.at(-1)?.headers.get("authorization")).toBe("Bearer " + chat.alternateKey)
    const stored = (yield* host.client.credential.list()).find((credential) => credential.id === account.id)
    expect(stored?.value).toMatchObject({ type: "oauth", methodID, access: chat.alternateKey, refresh: "fixture-oauth-refresh-b" })
    if (stored?.value.type !== "oauth") return yield* Effect.die(new Error("Explicit refresh lost the OAuth credential"))
    expect(stored.value.expires).toBeGreaterThan(original.expires)
    expect((yield* discovery.seen("ready", refreshed.status.generation)).inventory).toEqual(refreshed.inventory)
    expect(credentialUpdates).toHaveLength(0)
    expect((yield* host.snapshot()).files).toEqual(before.files)
    expect(fixture.requests).toHaveLength(3)
    expect(fixture.requests.every((request) => request.method === "GET" && request.url.pathname === chat.prefix + "/models")).toBe(true)
    yield* Fiber.interrupt(events)
    yield* Fiber.interrupt(discovery.fiber)
  }),
  30_000,
)
