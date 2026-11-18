export * as ProviderDiscovery from "./discovery.js"

import { Cause, Context, DateTime, Deferred, Effect, Exit, Fiber, Layer, Option, Schedule, Schema, Scope, Semaphore } from "effect"
import { SqlError } from "effect/sql/SqlError"
import { HttpClient } from "effect/http"
import { isDeepStrictEqual } from "node:util"
import { ProviderDiscovery } from "@aigcfroge/schema/provider-discovery"
import { ModelSource } from "@aigcfroge/schema/model-source"
import { ConfigProvider } from "@aigcfroge/schema/config/provider"
import { ProviderDefinition } from "@aigcfroge/schema/provider-definition"
import { Document, Info, type Entry } from "@aigcfroge/schema/config"
import { Hash } from "@aigcfroge/util/hash"
import { makeLocationNode } from "@aigcfroge/util/effect/app-node"
import { httpClient } from "@aigcfroge/util/effect/app-node-platform"
import { Bus } from "../bus.js"
import { Config } from "../config.js"
import { ConfigProviderFile } from "../config/provider-file.js"
import { Credential } from "../credential.js"
import { Integration } from "../integration.js"
import { IntegrationConnection } from "../integration/connection.js"
import { KV } from "../kv.js"
import { Location } from "../location.js"
import { Model } from "../model.js"
import { ModelsDev } from "../models-dev.js"
import { Provider } from "../provider.js"
import { AISDKNative } from "../aisdk-native.js"
import { ProviderDiscoveryHTTP } from "./discovery-http.js"
import { Money } from "@aigcfroge/schema/money"

export { GetInput, PreviewInput, RefreshInput, Read, Inventory, Status, Event } from "@aigcfroge/schema/provider-discovery"

export class InvalidError extends Schema.TaggedError<InvalidError>()("ProviderDiscovery.Invalid", { message: Schema.String }) {}
export class UnavailableError extends Schema.TaggedError<UnavailableError>()("ProviderDiscovery.Unavailable", { message: Schema.String }) {}
export type Error = InvalidError | UnavailableError | ConfigProviderFile.Error

export interface Interface {
  readonly prepare: (input: ProviderDiscovery.GetInput) => Effect.Effect<void>
  readonly get: (input: ProviderDiscovery.GetInput) => Effect.Effect<ProviderDiscovery.Read, Error>
  readonly preview: (input: ProviderDiscovery.PreviewInput) => Effect.Effect<ProviderDiscovery.Read, Error>
  readonly refresh: (input: ProviderDiscovery.RefreshInput) => Effect.Effect<ProviderDiscovery.Read, Error>
  readonly sync: () => Effect.Effect<void>
  readonly start: () => Effect.Effect<void, never, Scope.Scope>
  /** Config's final transform uses captured snapshots only. */
  readonly apply: (providerID: Provider.ID, id: Model.ID, model: Model.MutableInfo, connection?: ModelSource.ConnectionRef) => void
  readonly setDefaults: (providers: readonly Provider.Info[], input?: Provider.ConnectionInput) => void
  readonly bindSeeds: (input: { readonly providerID: Provider.ID; readonly target: ProviderDefinition.Target; readonly candidate: ConfigProvider.Info; readonly key: string; readonly credentialID: Credential.ID }) => Effect.Effect<Readonly<Record<string, ModelSource.Seed>>, Error>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/ProviderDiscovery") {}

type Capture = {
  readonly identity: ModelSource.Identity
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly definition: ConfigProvider.Info
  readonly cacheEligible: boolean
}
type Source = {
  readonly scope: Scope.Closeable
  readonly identity: string
  period?: Scope.Closeable
  interval?: number
}
type Stored = {
  request: Capture
  status: ProviderDiscovery.Status
  inventory?: ProviderDiscovery.Inventory
  active: number
}
type Flight = {
  readonly headers: Readonly<Record<string, string>>
  readonly url: string
  readonly scope: Scope.Closeable
  readonly result: Deferred.Deferred<ProviderDiscoveryHTTP.Listing & { readonly observedAt: number }, ProviderDiscoveryHTTP.FetchError>
  active: number
}

export const layer = Layer.effect(Service, Effect.gen(function* () {
  const config = yield* Config.Service
  const integration = yield* Integration.Service
  const credentials = yield* Credential.Service
  const providers = yield* Provider.Service
  const models = yield* Model.Service
  const kv = yield* KV.Service
  const bus = yield* Bus.Service
  const location = yield* Location.Service
  const http = yield* HttpClient.HttpClient
  const scope = yield* Effect.scope
  const modelsDev = yield* ModelsDev.Service
  let publicModels = yield* modelsDev.get()
  let loaded = yield* config.entries()
  let running = false
  const sources = new Map<Provider.ID, Source>()
  const stored = new Map<string, Stored>()
  const current = new Map<Provider.ID, Map<string, Capture>>()
  const defaults = new Map<string, Map<Provider.ID, Provider.Info>>()
  let prepared = false
  const flights = new Map<string, Flight[]>()
  const lock = Semaphore.makeUnsafe(1)
  const definitions = () => configured(config.current?.() ?? loaded)
  // Match ConfigProviderPlugin's admission gate across every authored layer.
  const suspended = (providerID: Provider.ID) => (config.current?.() ?? loaded).some((entry) =>
    entry.type === "document" && entry.info.providers?.[providerID]?.adoption !== undefined && entry.info.providers[providerID].adoption!.phase !== "ready",
  )
  const notify = (providerID: Provider.ID, connection?: ModelSource.ConnectionRef) => bus.publish(ProviderDiscovery.Event.Updated, { providerID, connection }, {
    location: { directory: location.directory, workspaceID: location.workspaceID },
  })

  const capture = Effect.fnUntraced(function* (
    input: ProviderDiscovery.GetInput,
    options?: { readonly definition?: ConfigProvider.Info; readonly credential?: ProviderDiscovery.PreviewCredential; readonly list?: ModelSource.Discovery["list"]; readonly renew?: boolean },
  ) {
    const definition = options?.definition ?? definitions().get(input.providerID)
    const provider = yield* providers.get(input.providerID, input.connection)
    const base = prepared ? defaults.get(Provider.connectionKey(input.connection && { providerID: input.providerID, connection: input.connection }))?.get(input.providerID) : provider
    if (!definition && !provider) return yield* new InvalidError({ message: "The provider definition does not exist" })
    const source = definition?.canonical && publicModels.find((item) => item.info.id === definition.canonical)
    const specifier = Provider.packageName(definition?.package ?? base?.package ?? (source ? source.info.package : undefined))
    const packageName = specifier && (AISDKNative.native(specifier, { providerID: input.providerID, canonical: definition?.canonical ?? base?.canonical, settings: definition?.settings }) ?? specifier)
    const nativeOpenAI = packageName !== undefined && NativeOpenAI.has(packageName)
    const protocol = options?.list?.protocol ?? definition?.discovery?.list?.protocol ?? listingProtocol(packageName)
    if (!protocol) return yield* new InvalidError({ message: "Select an OpenAI or Anthropic listing protocol for this provider" })
    const integrationID = base?.integrationID ?? provider?.integrationID ?? Integration.ID.make(input.providerID)
    const available = (yield* integration.get(integrationID))?.connections ?? []
    const previewCredential = options?.credential
    const requested = previewCredential?.type === "connection" ? previewCredential.connection : input.connection
    if (requested && !available.some((item) => IntegrationConnection.key(item) === IntegrationConnection.key(requested)))
      return yield* new InvalidError({ message: "The selected connection does not belong to this provider" })
    const selected = previewCredential?.type === "none" || previewCredential?.type === "key" ? undefined : requested ? available.find((item) => IntegrationConnection.key(item) === IntegrationConnection.key(requested)) : available[0]
    const connection: ModelSource.ConnectionRef | undefined = selected?.type === "credential" ? { type: "credential", id: selected.id } : selected?.type === "env" ? { type: "env", name: selected.name } : undefined
    const credential = previewCredential?.type === "key" ? Credential.Key.make({ type: "key", key: previewCredential.key }) : selected && (options?.renew
      ? yield* integration.connection.resolve(selected).pipe(Effect.mapError(() => new UnavailableError({ message: "The selected connection could not be resolved" })))
      : selected.type === "credential" ? (yield* credentials.get(selected.id))?.value : process.env[selected.name] ? Credential.Key.make({ type: "key", key: process.env[selected.name]! }) : undefined)
    if (selected && !credential) return yield* new UnavailableError({ message: "The selected connection no longer has a credential" })
    if (credential?.type === "external") return yield* new InvalidError({ message: "This external connection has no OpenAI or Anthropic listing credential" })
    const settings = { ...(source ? source.info.settings : undefined), ...base?.settings, ...definition?.settings, ...credential?.metadata, ...(credential?.type === "key" ? credential.configuration : undefined) }
    const baseURL = typeof settings.baseURL === "string" ? settings.baseURL.replace(/\$\{([^}]+)\}/g, (placeholder, name: string) => process.env[name] ?? placeholder) : protocol === "anthropic" && packageName === "@aigcfroge/ai/providers/anthropic" ? "https://api.anthropic.com/v1" : nativeOpenAI ? "https://api.openai.com/v1" : undefined
    const rawURL = options?.list?.url ?? definition?.discovery?.list?.url ?? (baseURL && `${baseURL.replace(/\/+$/, "")}/models`)
    if (!rawURL || rawURL.includes("${")) return yield* new InvalidError({ message: "The model directory requires a resolved URL" })
    const url = yield* Effect.try({ try: () => new URL(rawURL), catch: () => new InvalidError({ message: "The model directory URL is invalid" }) })
    if (nativeOpenAI && settings.queryParams !== undefined) {
      const query = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.String))(settings.queryParams)
      if (Option.isNone(query)) return yield* new InvalidError({ message: "OpenAI queryParams must be a record of strings" })
      for (const [key, value] of Object.entries(query.value)) url.searchParams.set(key, value)
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return yield* new InvalidError({ message: "The model directory URL must use HTTP or HTTPS" })
    const headers: Record<string, string> = Object.fromEntries(Object.entries(Provider.mergeHeaders(base?.headers, definition?.headers) ?? {}).map(([key, value]) => [key.toLowerCase(), value]))
    // OpenAI.config emits these defaults before given headers. Preserve the
    // same override relation after normalizing header names.
    if (nativeOpenAI && typeof settings.organization === "string" && headers["openai-organization"] === undefined) headers["openai-organization"] = settings.organization
    if (nativeOpenAI && typeof settings.project === "string" && headers["openai-project"] === undefined) headers["openai-project"] = settings.project
    if (previewCredential?.type === "none") {
      delete headers.authorization
      delete headers["x-api-key"]
    }
    const token = credential?.type === "key" ? credential.key : credential?.type === "oauth" ? credential.access : previewCredential?.type === "none" ? undefined : typeof settings.apiKey === "string" ? settings.apiKey : typeof settings.authToken === "string" ? settings.authToken : undefined
    if (credential || previewCredential?.type === "key") {
      delete headers.authorization
      delete headers["x-api-key"]
    }
    if (token) {
      delete headers.authorization
      delete headers["x-api-key"]
      const bearer = protocol !== "anthropic" || credential?.type === "oauth" || (!credential && typeof settings.authToken === "string" && typeof settings.apiKey !== "string")
      headers[bearer ? "authorization" : "x-api-key"] = bearer ? `Bearer ${token}` : token
    }
    if (protocol === "anthropic" && !headers["anthropic-version"]) headers["anthropic-version"] = "2023-06-01"
    const auth = headers.authorization ? "bearer" : headers["x-api-key"] ? "api-key" : "none"
    const safeURL = new URL(url)
    let embeddedSecret = Boolean(safeURL.username || safeURL.password)
    safeURL.username = ""
    safeURL.password = ""
    for (const key of safeURL.searchParams.keys()) {
      if (!/(?:key|token|secret|password|authorization)/i.test(key)) continue
      embeddedSecret = true
      safeURL.searchParams.set(key, "redacted")
    }
    const safeHeaders = Object.fromEntries(Object.keys(headers).sort().map((key) => [key, /(?:authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|secret|password|cookie)/i.test(key) ? "redacted" : headers[key]]))
    const identity: ModelSource.Identity = { providerID: input.providerID, connection, listURL: safeURL.href, protocol, auth, configurationDigest: Hash.sha256(JSON.stringify({ url: safeURL.href, headers: safeHeaders })) }
    return { identity, url: url.href, headers, definition: definition ?? new ConfigProvider.Info({}), cacheEligible: !embeddedSecret && (connection !== undefined || auth === "none") } satisfies Capture
  })

  const entry = Effect.fnUntraced(function* (request: Capture) {
    const captures = current.get(request.identity.providerID) ?? new Map<string, Capture>()
    captures.set(IntegrationConnection.key(request.identity.connection) ?? "", request)
    current.set(request.identity.providerID, captures)
    const key = identityKey(request.identity)
    const existing = stored.get(key)
    if (existing) {
      if (!isDeepStrictEqual(existing.request.headers, request.headers) || existing.request.url !== request.url) {
        existing.status = { ...existing.status, phase: "idle", generation: existing.status.generation + 1, error: undefined }
        yield* notify(request.identity.providerID, request.identity.connection)
      }
      existing.request = request
      return existing
    }
    const cached = request.cacheEligible ? Schema.decodeUnknownOption(ProviderDiscovery.Inventory)(yield* kv.get(`provider-discovery:${key}`)) : Option.none()
    const inventory = Option.isSome(cached) && cached.value.complete && identityKey(cached.value.identity) === key ? cached.value : undefined
    const result: Stored = {
      request,
      inventory,
      active: 0,
      status: { providerID: request.identity.providerID, identity: request.identity, phase: inventory ? "ready" : "idle", lastSuccessAt: inventory?.observedAt, cachePersisted: Boolean(inventory), generation: 0 },
    }
    stored.set(key, result)
    return result
  })

  const fetch = Effect.fnUntraced(function* (request: Capture) {
    // Provider inference shape does not identify a listing request. Connection,
    // URL, list protocol and exact captured headers do identify one.
    const key = Hash.sha256(JSON.stringify({ ...request.identity, providerID: undefined }))
    const choices = flights.get(key) ?? []
    const joined = choices.find((flight) => flight.url === request.url && isDeepStrictEqual(flight.headers, request.headers))
    const flight = joined ?? { headers: request.headers, url: request.url, scope: yield* Scope.fork(scope), result: yield* Deferred.make<ProviderDiscoveryHTTP.Listing & { readonly observedAt: number }, ProviderDiscoveryHTTP.FetchError>(), active: 0 }
    if (!joined) {
      flights.set(key, [...choices, flight])
      yield* (request.identity.protocol === "anthropic" ? ProviderDiscoveryHTTP.anthropic(request) : ProviderDiscoveryHTTP.openai(request)).pipe(
        Effect.provideService(HttpClient.HttpClient, http),
        Effect.flatMap((listing) => DateTime.nowAsDate.pipe(Effect.map((date) => ({ ...listing, observedAt: date.getTime() })))),
        Effect.exit,
        Effect.flatMap((exit) => Deferred.done(flight.result, exit)),
        Effect.forkIn(flight.scope, { startImmediately: true }),
      )
    }
    flight.active++
    return yield* Deferred.await(flight.result).pipe(Effect.ensuring(Effect.gen(function* () {
      flight.active--
      if (flight.active) return
      const remaining = (flights.get(key) ?? []).filter((item) => item !== flight)
      if (remaining.length) flights.set(key, remaining)
      if (!remaining.length) flights.delete(key)
      yield* Scope.close(flight.scope, Exit.void)
    })))
  })

  const publicMetadata = (providerID: Provider.ID, definition: ConfigProvider.Info, modelID: Model.ID) => {
    const canonical = definition.canonical ?? (publicModels.some((item) => item.info.id === providerID) ? providerID : undefined)
    return canonical && publicModels.find((item) => item.info.id === canonical)?.models.find((item) => item.modelID === modelID)?.metadata
  }
  const resolve = (request: Capture, id: Model.ID, runtime: Model.Info | undefined, inventory: ProviderDiscovery.Inventory | undefined) => {
    const configuredModel = request.definition.models?.[id]
    const modelID = configuredModel?.modelID ?? id
    const live = request.definition.discovery?.enabled !== false && !suspended(request.identity.providerID) ? inventory?.models.find((item) => item.id === modelID)?.metadata : undefined
    const seed = request.cacheEligible && configuredModel?.seed && identityKey(configuredModel.seed.identity) === identityKey(request.identity) ? configuredModel.seed.metadata : undefined
    return resolveMetadata({ user: configuredModel, live, public: publicMetadata(request.identity.providerID, request.definition, modelID), seed, runtime: runtime ?? Model.Info.default(request.identity.providerID, id) })
  }
  const read = Effect.fnUntraced(function* (request: Capture, item: Stored, inventory: ProviderDiscovery.Inventory | undefined = item.inventory) {
    const available = yield* models.all(request.identity.connection && { providerID: request.identity.providerID, connection: request.identity.connection })
    const members = Object.entries(request.definition.models ?? {}).map(([id, model]) => {
      const ref = { providerID: request.identity.providerID, id: Model.ID.make(id) }
      const modelID = model.modelID ?? ref.id
      return { ref, modelID, ...resolve(request, ref.id, available.find((candidate) => candidate.providerID === ref.providerID && candidate.id === ref.id), inventory), seed: model.seed, membership: inventory?.models.some((candidate) => candidate.id === modelID) ? "present" as const : inventory?.complete ? "absent" as const : "unknown" as const }
    })
    return {
      status: { ...item.status, ...(request.definition.discovery?.enabled === false || suspended(request.identity.providerID) ? { phase: "disabled" as const } : {}) },
      inventory,
      candidates: (inventory?.models ?? []).map((model) => ({ ...model, managedRefs: members.filter((member) => member.modelID === model.id).map((member) => member.ref), membership: "present" as const })),
      managed: members,
    } satisfies ProviderDiscovery.Read
  })

  const refresh = Effect.fn("ProviderDiscovery.refresh")(function* (input: ProviderDiscovery.RefreshInput, periodic = false) {
    const admitted = yield* capture(input)
    if (admitted.definition.discovery?.enabled === false || definitions().get(input.providerID)?.discovery?.enabled === false || suspended(input.providerID))
      return yield* read(admitted, yield* entry(admitted))
    const owner: Source = sources.get(input.providerID) ?? { scope: yield* Scope.fork(scope), identity: identityKey(admitted.identity) }
    sources.set(input.providerID, owner)
    const executionScope = periodic ? owner.period : owner.scope
    if (!executionScope) return yield* read(admitted, yield* entry(admitted))
    const supervised = Effect.gen(function* () {
    const request = yield* capture(input, { renew: true })
    const item = yield* entry(request)
    if (definitions().get(input.providerID)?.discovery?.enabled === false || suspended(input.providerID) || sources.get(input.providerID) !== owner) {
      const current = yield* capture(input)
      return yield* read(current, yield* entry(current))
    }
    const generation = item.status.phase === "fetching" ? item.status.generation : item.status.generation + 1
    item.active++
    item.status = { ...item.status, identity: request.identity, phase: "fetching", lastAttemptAt: (yield* DateTime.nowAsDate).getTime(), error: undefined, generation }
    yield* notify(input.providerID, request.identity.connection)
    const operation = Effect.gen(function* () {
      const result = yield* fetch(request).pipe(Effect.result)
      const latest = yield* capture({ providerID: input.providerID, connection: input.connection })
      if (identityKey(latest.identity) !== identityKey(request.identity) || latest.url !== request.url || !isDeepStrictEqual(latest.headers, request.headers) || latest.definition.discovery?.enabled === false || suspended(input.providerID))
        return yield* read(latest, yield* entry(latest))
      if (item.status.generation !== generation || !isDeepStrictEqual(item.request.headers, request.headers)) return yield* read(item.request, item)
      if (result._tag === "Failure") {
        item.status = { ...item.status, phase: result.failure.kind === "incomplete" ? "partial" : "failed", error: { kind: result.failure.kind, message: result.failure.message } }
        yield* notify(input.providerID, request.identity.connection)
        return yield* read(request, item)
      }
      const listing = result.success
      if (!listing.complete) {
        item.status = { ...item.status, phase: "partial", error: listing.error }
        yield* notify(input.providerID, request.identity.connection)
        return yield* read(request, item)
      }
      const inventory: ProviderDiscovery.Inventory = { identity: request.identity, complete: true, models: listing.models, observedAt: listing.observedAt, digest: Hash.sha256(JSON.stringify(listing.models)) }
      const changed = item.inventory?.digest !== inventory.digest
      item.inventory = inventory
      const persisted = request.cacheEligible ? yield* kv.set(`provider-discovery:${identityKey(request.identity)}`, Schema.encodeSync(ProviderDiscovery.Inventory)(inventory)).pipe(
        Effect.as(true),
        Effect.catchCauseIf((cause) => !Cause.hasInterrupts(cause) && cause.reasons.length > 0 && cause.reasons.every((reason) => Cause.isDieReason(reason) && reason.defect instanceof SqlError), () => Effect.succeed(false)),
      ) : false
      if (item.status.generation !== generation) return yield* read(item.request, item)
      item.status = { ...item.status, phase: "ready", lastSuccessAt: inventory.observedAt, cachePersisted: persisted, error: persisted || !request.cacheEligible ? undefined : { kind: "cache", message: "The inventory is available in memory; its cache could not be saved" } }
      if (changed) yield* models.reload()
      yield* notify(input.providerID, request.identity.connection)
      return yield* read(request, item)
    }).pipe(Effect.ensuring(Effect.gen(function* () {
      item.active--
      if (item.active || item.status.generation !== generation || item.status.phase !== "fetching") return
      item.status = { ...item.status, phase: item.inventory ? "ready" : "idle" }
      yield* notify(input.providerID, request.identity.connection)
    })))
    return yield* operation
    })
    return yield* supervised.pipe(Effect.forkIn(executionScope, { startImmediately: true }), Effect.flatMap(Fiber.join))
  })

  const sync = () => lock.withPermit(Effect.gen(function* () {
    loaded = yield* config.entries()
    publicModels = yield* modelsDev.get()
    const configuredProviders = definitions()
    for (const [providerID, owner] of sources) {
      if (configuredProviders.has(providerID)) continue
      sources.delete(providerID)
      current.delete(providerID)
      yield* Scope.close(owner.scope, Exit.void)
    }
    for (const [providerID, definition] of configuredProviders) {
      const captured = yield* capture({ providerID }).pipe(Effect.result)
      if (captured._tag === "Failure") {
        current.delete(providerID)
        const previous = sources.get(providerID)
        sources.delete(providerID)
        if (previous) yield* Scope.close(previous.scope, Exit.void)
        continue
      }
      const request = captured.success
      const captures = current.get(providerID) ?? new Map<string, Capture>()
      const previous = captures.get("")
      const changed = previous && identityKey(previous.identity) !== identityKey(request.identity)
      captures.set("", request)
      current.set(providerID, captures)
      const item = yield* entry(request)
      const key = identityKey(request.identity)
      const existing = sources.get(providerID)
      const pending = suspended(providerID)
      if (definition.discovery?.enabled === false || pending || (existing && existing.identity !== key)) {
        if (existing) yield* Scope.close(existing.scope, Exit.void)
        sources.delete(providerID)
      }
      if (definition.discovery?.enabled === false || pending) {
        if (item.status.phase !== "disabled") {
          item.status = { ...item.status, phase: "disabled", generation: item.status.generation + 1 }
          yield* notify(providerID, request.identity.connection)
        }
        continue
      }
      if (item.status.phase === "disabled") {
        item.status = { ...item.status, phase: item.inventory ? "ready" : "idle", generation: item.status.generation + 1 }
        yield* notify(providerID, request.identity.connection)
      }
      if (changed) yield* notify(providerID, request.identity.connection)
      if (!running) continue
      const owner: Source = sources.get(providerID) ?? { scope: yield* Scope.fork(scope), identity: key }
      sources.set(providerID, owner)
      const interval = definition.discovery?.intervalMs ?? 300_000
      if (owner.period && (definition.discovery?.autoSync !== true || owner.interval !== interval)) {
        const period = owner.period
        owner.period = undefined
        yield* Scope.close(period, Exit.void)
      }
      if (definition.discovery?.autoSync === true && !owner.period) {
        owner.period = yield* Scope.fork(owner.scope)
        owner.interval = interval
        yield* refresh({ providerID }, true).pipe(Effect.ignore, Effect.repeat(Schedule.spaced(interval)), Effect.forkIn(owner.period, { startImmediately: true }))
      }
    }
  }).pipe(Effect.orDie))

  return Service.of({
    prepare: Effect.fn("ProviderDiscovery.prepare")(function* (input) {
      const previous = current.get(input.providerID)?.get(IntegrationConnection.key(input.connection) ?? "")
      const inventory = previous && stored.get(identityKey(previous.identity))?.inventory
      const request = yield* capture(input).pipe(
        Effect.catchTag("ProviderDiscovery.Invalid", () => Effect.undefined),
        Effect.catchTag("ProviderDiscovery.Unavailable", () => Effect.undefined),
      )
      if (!request) return
      const captured = yield* entry(request)
      if (!previous || identityKey(previous.identity) !== identityKey(request.identity) || inventory !== captured.inventory)
        yield* models.reload()
    }),
    sync,
    bindSeeds: Effect.fn("ProviderDiscovery.bindSeeds")(function* (input) {
      const definition = yield* effectiveDefinition(config, input.providerID, input.target, input.candidate)
      const request = yield* capture({ providerID: input.providerID }, { definition, credential: { type: "key", key: input.key } }).pipe(
        Effect.catchTag("ProviderDiscovery.Invalid", () => Effect.undefined),
        Effect.catchTag("ProviderDiscovery.Unavailable", () => Effect.undefined),
      )
      if (!request) return {}
      return Object.fromEntries(Object.entries(input.candidate.models ?? {}).flatMap(([id, model]) => {
        const seed = model.seed
        if (!seed || seed.identity.connection !== undefined || identityKey(seed.identity) !== identityKey(request.identity)) return []
        return [[id, { ...seed, identity: { ...request.identity, connection: { type: "credential" as const, id: input.credentialID } } }]]
      }))
    }),
    setDefaults: (providers, input) => {
      prepared = true
      if (!input) defaults.clear()
      defaults.set(Provider.connectionKey(input), new Map(providers.map((provider) => [provider.id, { ...provider, settings: provider.settings && { ...provider.settings }, headers: provider.headers && { ...provider.headers } }])))
    },
    start: () => Effect.gen(function* () {
      running = true
      yield* Effect.addFinalizer(() => Effect.gen(function* () {
        running = false
        current.clear()
        for (const owner of sources.values()) yield* Scope.close(owner.scope, Exit.void)
        sources.clear()
      }))
      yield* sync()
    }),
    apply: (providerID, id, model, connection) => {
      const request = current.get(providerID)?.get(IntegrationConnection.key(connection) ?? "")
      const definition = definitions().get(providerID)
      if (!definition?.models?.[id]) return
      const value = request
        ? resolve({ ...request, definition }, id, model, stored.get(identityKey(request.identity))?.inventory)
        : resolveMetadata({ user: definition.models[id], public: publicMetadata(providerID, definition, definition.models[id].modelID ?? id), runtime: model })
      model.metadata = {
        ...value.metadata,
        capabilities: value.metadata.capabilities && { ...value.metadata.capabilities, input: value.metadata.capabilities.input?.slice(), output: value.metadata.capabilities.output?.slice() },
        quote: value.metadata.quote?.status === "unknown" ? value.metadata.quote : value.metadata.quote && { ...value.metadata.quote, prices: value.metadata.quote.prices.map((cost) => ({ ...cost, cache: { ...cost.cache } })) },
        quota: value.metadata.quota && { ...value.metadata.quota, windows: value.metadata.quota.windows.map((window) => ({ ...window, modelIDs: window.modelIDs && [...window.modelIDs] })) },
      }
      model.origins = structuredClone(value.origins)
      if (value.metadata.name !== undefined) model.name = value.metadata.name
      if (value.metadata.family !== undefined) model.family = value.metadata.family
      if (value.metadata.compatibility !== undefined) model.compatibility = structuredClone(value.metadata.compatibility)
      if (value.metadata.capabilities !== undefined) model.capabilities = Model.mergeCapabilities(value.metadata.capabilities, model.capabilities)
      if (value.metadata.limit.context !== undefined) model.limit.context = value.metadata.limit.context
      if (value.metadata.limit.input !== undefined) model.limit.input = value.metadata.limit.input
      if (value.metadata.limit.output !== undefined) model.limit.output = value.metadata.limit.output
      if (value.metadata.quote.status !== "unknown") model.cost = value.metadata.quote.prices.map((cost) => ({ ...cost, cache: { ...cost.cache } }))
    },
    get: Effect.fn("ProviderDiscovery.get")(function* (input) {
      const request = yield* capture(input)
      return yield* read(request, yield* entry(request))
    }),
    refresh,
    preview: Effect.fn("ProviderDiscovery.preview")(function* (input) {
      let definition: ConfigProvider.Info
      if (input.definition.type === "new") definition = new ConfigProvider.Info(input.definition.definition)
      if (input.definition.type === "stored") {
        if (!config.provider) return yield* new UnavailableError({ message: "Authored provider definitions are unavailable" })
        const draft = input.definition
        definition = yield* config.provider.transaction(draft.target, (file) => Effect.gen(function* () {
          if (file.target.digest !== draft.expectedDigest) return yield* new ConfigProviderFile.ConflictError({ target: file.target, message: "The configuration changed since it was read" })
          const candidate = yield* ConfigProviderFile.preview(file, input.providerID, draft.patch)
          return yield* effectiveDefinition(config, input.providerID, draft.target, candidate)
        }))
      }
      const request = yield* capture({ providerID: input.providerID }, { definition: definition!, credential: input.credential, list: input.list })
      const listing = yield* (request.identity.protocol === "anthropic" ? ProviderDiscoveryHTTP.anthropic(request) : ProviderDiscoveryHTTP.openai(request)).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.result)
      const observedAt = (yield* DateTime.nowAsDate).getTime()
      const inventory = listing._tag === "Success" ? { identity: request.identity, complete: listing.success.complete, digest: Hash.sha256(JSON.stringify(listing.success.models)), models: listing.success.models, observedAt } : undefined
      const item: Stored = { request, inventory, active: 0, status: { providerID: input.providerID, identity: request.identity, phase: listing._tag === "Failure" ? listing.failure.kind === "incomplete" ? "partial" : "failed" : listing.success.complete ? "ready" : "partial", lastAttemptAt: observedAt, lastSuccessAt: listing._tag === "Success" && listing.success.complete ? observedAt : undefined, cachePersisted: false, generation: 0, error: listing._tag === "Failure" ? { kind: listing.failure.kind, message: listing.failure.message } : listing.success.error } }
      return yield* read(request, item, inventory)
    }),
  })
}))

export const node = makeLocationNode({ service: Service, layer, deps: [Config.node, Credential.node, Integration.node, Provider.node, Model.node, ModelsDev.node, KV.node, Bus.node, Location.node, httpClient] })

export function identityKey(identity: ModelSource.Identity) {
  return Hash.sha256(JSON.stringify([identity.providerID, IntegrationConnection.key(identity.connection), identity.listURL, identity.protocol, identity.auth, identity.configurationDigest]))
}

function effectiveDefinition(config: Config.Interface, providerID: Provider.ID, target: ProviderDefinition.Target, candidate: ConfigProvider.Info) {
  return Effect.gen(function* () {
    if (!config.provider) return yield* new UnavailableError({ message: "Authored provider definitions are unavailable" })
    const authored = yield* config.provider.list({ providerID, target, definition: candidate })
    const layers = authored.definitions.filter((item) => item.providerID === providerID).map((item) => new Document({ type: "document", path: item.source.path, info: new Info({ providers: { [providerID]: item.target?.path === target.path ? candidate : item.definition } }) }))
    return configured(layers).get(providerID) ?? candidate
  })
}

const NativeOpenAI = new Set(["@aigcfroge/ai/providers/openai", "@aigcfroge/ai/providers/openai/chat", "@aigcfroge/ai/providers/openai/responses"])

function listingProtocol(packageName: string | undefined): ModelSource.Protocol | undefined {
  if (packageName === "@aigcfroge/ai/providers/anthropic" || packageName === "@aigcfroge/ai/providers/anthropic-compatible") return "anthropic"
  if (packageName !== undefined && NativeOpenAI.has(packageName) || packageName === "@aigcfroge/ai/providers/openai-compatible" || packageName === "@aigcfroge/ai/providers/openai-compatible/responses" || packageName === "@aigcfroge/ai/providers/openai-compatible-responses") return "openai"
}

function configured(entries: readonly Entry[]) {
  const result = new Map<Provider.ID, ConfigProvider.Info>()
  for (const entry of entries) {
    if (entry.type !== "document") continue
    for (const [id, definition] of Object.entries(entry.info.providers ?? {})) {
      const providerID = Provider.ID.make(id)
      const before = result.get(providerID)
      result.set(providerID, new ConfigProvider.Info({ ...before, ...definition, settings: Provider.mergeOverlay(before?.settings, definition.settings), headers: Provider.mergeHeaders(before?.headers, definition.headers), body: Provider.mergeOverlay(before?.body, definition.body), discovery: { ...before?.discovery, ...definition.discovery, ...(before?.discovery?.list || definition.discovery?.list ? { list: { ...before?.discovery?.list, ...definition.discovery?.list } } : {}) }, models: Object.fromEntries([...new Set([...Object.keys(before?.models ?? {}), ...Object.keys(definition.models ?? {})])].map((modelID) => {
        const previous = before?.models?.[modelID]
        const next = definition.models?.[modelID]
        return [modelID, new ConfigProvider.Model({ ...previous, ...next, compatibility: previous?.compatibility || next?.compatibility ? { ...previous?.compatibility, ...next?.compatibility } : undefined, capabilities: previous?.capabilities || next?.capabilities ? { ...previous?.capabilities, ...next?.capabilities } : undefined, limit: previous?.limit || next?.limit ? { ...previous?.limit, ...next?.limit } : undefined })]
      })) }))
    }
  }
  return result
}

export function resolveMetadata(input: { readonly user?: ConfigProvider.Model; readonly live?: ModelSource.Metadata; readonly public?: ModelSource.Metadata; readonly seed?: ModelSource.Metadata; readonly runtime: Model.Info }) {
  const costs = input.user?.cost && (Array.isArray(input.user.cost) ? input.user.cost : [input.user.cost]).map((cost) => ({ ...cost, cache: { read: cost.cache?.read ?? Money.USDPerMillionTokens.zero, write: cost.cache?.write ?? Money.USDPerMillionTokens.zero } }))
  const authoredQuote: ModelSource.Quote | undefined = input.user?.quote ?? (costs === undefined ? undefined : costs.length === 0
    ? { status: "unknown" }
    : { status: costs.every((cost) => cost.input === 0 && cost.output === 0 && cost.cache.read === 0 && cost.cache.write === 0) ? "free" : "known", prices: costs })
  const candidates: readonly { readonly metadata: ModelSource.Metadata; readonly origin: ModelSource.Origin }[] = [
    { metadata: { ...input.user, quote: authoredQuote }, origin: "user" },
    { metadata: input.live ?? {}, origin: "live" },
    { metadata: input.public ?? {}, origin: "public" },
    { metadata: input.seed ?? {}, origin: "seed" },
    { metadata: { name: input.runtime.name, family: input.runtime.family, compatibility: input.runtime.compatibility, capabilities: input.runtime.capabilities, limit: input.runtime.limit }, origin: "runtime-default" },
  ]
  const pick = <A>(field: (metadata: ModelSource.Metadata) => A | undefined) => {
    const candidate = candidates.find((candidate) => field(candidate.metadata) !== undefined)
    return candidate ? { value: field(candidate.metadata)!, origin: candidate.origin } : undefined
  }
  const name = pick((metadata) => metadata.name)
  const family = pick((metadata) => metadata.family)
  const compatibility = Object.fromEntries([...new Set(candidates.flatMap((candidate) => Object.keys(candidate.metadata.compatibility ?? {})))].map((key) => [key, pick((metadata) => metadata.compatibility?.[key as keyof Model.Compatibility])!]))
  const tools = pick((metadata) => metadata.capabilities?.tools)
  const modalityInput = pick((metadata) => metadata.capabilities?.input)
  const output = pick((metadata) => metadata.capabilities?.output)
  const context = pick((metadata) => metadata.limit?.context)
  const tokenInput = pick((metadata) => metadata.limit?.input)
  const tokenOutput = pick((metadata) => metadata.limit?.output)
  const quote = authoredQuote === undefined
    ? pick((metadata) => metadata.quote?.status === "unknown" ? undefined : metadata.quote)
    : { value: authoredQuote, origin: "user" as const }
  return {
    metadata: {
      name: name?.value,
      family: family?.value,
      compatibility: Object.fromEntries(Object.entries(compatibility).map(([key, picked]) => [key, picked.value])),
      capabilities: { tools: tools?.value, input: modalityInput?.value, output: output?.value },
      limit: { context: context?.value, input: tokenInput?.value, output: tokenOutput?.value },
      quote: quote?.value ?? { status: "unknown" as const },
      quota: input.live?.quota ?? input.runtime.metadata?.quota,
    },
    origins: {
      name: name?.origin,
      family: family?.origin,
      compatibility: Object.fromEntries(Object.entries(compatibility).map(([key, picked]) => [key, picked.origin])),
      capabilities: { tools: tools?.origin, input: modalityInput?.origin, output: output?.origin },
      limit: { context: context?.origin, input: tokenInput?.origin, output: tokenOutput?.origin },
      quote: quote?.origin ?? "unknown" as const,
    },
  } satisfies { readonly metadata: ModelSource.Metadata; readonly origins: ModelSource.Origins }
}
