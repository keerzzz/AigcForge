export * as Provider from "./provider.js"

import { Context, Effect, Layer, Option, Schema, Stream, Struct } from "effect"
import { Provider } from "@omnixa/schema/provider"
import { Model } from "@omnixa/schema/model"
import type { ModelSource } from "@omnixa/schema/model-source"
import { makeLocationNode } from "@omnixa/util/effect/app-node"
import { HttpTimeout, type ProviderPackageDefinition } from "@omnixa/ai"
import { isRecord } from "@omnixa/ai/utils/record"
import { Npm } from "@omnixa/util/npm"
import type { DeepMutable } from "./schema.js"
import { importModule, resolveModule } from "@omnixa/util/runtime-import"
import { Bus } from "./bus.js"
import { Integration } from "./integration.js"
import { State } from "./state.js"
import { IntegrationConnection } from "./integration/connection.js"
import { Credential } from "@omnixa/schema/credential"
import { Location } from "./location.js"
import { castDraft, freeze } from "immer"
import { AISDKNative } from "./aisdk-native.js"

export const ID = Provider.ID
export type ID = typeof ID.Type

export const AISDK_PREFIX = "aisdk:"
export const isAISDK = (value: string | undefined): value is string => value?.startsWith(AISDK_PREFIX) ?? false
export const aisdk = (value: string) => (isAISDK(value) ? value : `${AISDK_PREFIX}${value}`)
export function packageName(value: string): string
export function packageName(value: undefined): undefined
export function packageName(value: string | undefined): string | undefined
export function packageName(value: string | undefined) {
  if (value === undefined || !isAISDK(value)) return value
  return value.slice(AISDK_PREFIX.length)
}

type Json = Schema.Schema.Type<typeof Schema.Json>
const JsonRecord = Schema.Record(Schema.String, Schema.Json)
const decodeJsonRecord = Schema.decodeUnknownSync(JsonRecord)

export class LoadError extends Schema.TaggedError<LoadError>()("Provider.LoadError", {
  package: Schema.String,
  cause: Schema.Defect(),
}) {}
export type ProviderPackage = ProviderPackageDefinition

const packages = new Map<string, Promise<unknown>>()
const builtins = new Map<string, () => Promise<unknown>>([
  ["@omnixa/ai/providers/amazon-bedrock", () => import("@omnixa/ai/providers/amazon-bedrock")],
  ["@omnixa/ai/providers/amazon-bedrock/mantle", () => import("@omnixa/ai/providers/amazon-bedrock/mantle")],
  ["@omnixa/ai/providers/amazon-bedrock/mantle/chat", () => import("@omnixa/ai/providers/amazon-bedrock/mantle/chat")],
  [
    "@omnixa/ai/providers/amazon-bedrock/mantle/responses",
    () => import("@omnixa/ai/providers/amazon-bedrock/mantle/responses"),
  ],
  ["@omnixa/ai/providers/alibaba/chat", () => import("@omnixa/ai/providers/alibaba/chat")],
  ["@omnixa/ai/providers/alibaba/messages", () => import("@omnixa/ai/providers/alibaba/messages")],
  ["@omnixa/ai/providers/alibaba/responses", () => import("@omnixa/ai/providers/alibaba/responses")],
  ["@omnixa/ai/providers/anthropic", () => import("@omnixa/ai/providers/anthropic")],
  ["@omnixa/ai/providers/anthropic-compatible", () => import("@omnixa/ai/providers/anthropic-compatible")],
  ["@omnixa/ai/providers/azure", () => import("@omnixa/ai/providers/azure")],
  ["@omnixa/ai/providers/azure/chat", () => import("@omnixa/ai/providers/azure/chat")],
  ["@omnixa/ai/providers/azure/responses", () => import("@omnixa/ai/providers/azure/responses")],
  ["@omnixa/ai/providers/baseten", () => import("@omnixa/ai/providers/baseten")],
  ["@omnixa/ai/providers/cerebras", () => import("@omnixa/ai/providers/cerebras")],
  ["@omnixa/ai/providers/cloudflare-ai-gateway", () => import("@omnixa/ai/providers/cloudflare-ai-gateway")],
  ["@omnixa/ai/providers/cloudflare-workers-ai", () => import("@omnixa/ai/providers/cloudflare-workers-ai")],
  ["@omnixa/ai/providers/cohere", () => import("@omnixa/ai/providers/cohere")],
  ["@omnixa/ai/providers/cohere/chat", () => import("@omnixa/ai/providers/cohere/chat")],
  ["@omnixa/ai/providers/deepinfra", () => import("@omnixa/ai/providers/deepinfra")],
  ["@omnixa/ai/providers/deepseek", () => import("@omnixa/ai/providers/deepseek")],
  ["@omnixa/ai/providers/digitalocean", () => import("@omnixa/ai/providers/digitalocean")],
  ["@omnixa/ai/providers/fireworks", () => import("@omnixa/ai/providers/fireworks")],
  ["@omnixa/ai/providers/google", () => import("@omnixa/ai/providers/google")],
  ["@omnixa/ai/providers/google/interactions", () => import("@omnixa/ai/providers/google/interactions")],
  ["@omnixa/ai/providers/google-vertex", () => import("@omnixa/ai/providers/google-vertex")],
  ["@omnixa/ai/providers/google-vertex/gemini", () => import("@omnixa/ai/providers/google-vertex/gemini")],
  ["@omnixa/ai/providers/google-vertex/interactions", () => import("@omnixa/ai/providers/google-vertex/interactions")],
  ["@omnixa/ai/providers/google-vertex/chat", () => import("@omnixa/ai/providers/google-vertex/chat")],
  ["@omnixa/ai/providers/google-vertex/responses", () => import("@omnixa/ai/providers/google-vertex/responses")],
  ["@omnixa/ai/providers/google-vertex/messages", () => import("@omnixa/ai/providers/google-vertex/messages")],
  ["@omnixa/ai/providers/google-vertex/mistral", () => import("@omnixa/ai/providers/google-vertex/mistral")],
  ["@omnixa/ai/providers/groq", () => import("@omnixa/ai/providers/groq")],
  ["@omnixa/ai/providers/meta/chat", () => import("@omnixa/ai/providers/meta/chat")],
  ["@omnixa/ai/providers/meta/messages", () => import("@omnixa/ai/providers/meta/messages")],
  ["@omnixa/ai/providers/meta/responses", () => import("@omnixa/ai/providers/meta/responses")],
  ["@omnixa/ai/providers/minimax/chat", () => import("@omnixa/ai/providers/minimax/chat")],
  ["@omnixa/ai/providers/minimax/messages", () => import("@omnixa/ai/providers/minimax/messages")],
  ["@omnixa/ai/providers/minimax/responses", () => import("@omnixa/ai/providers/minimax/responses")],
  ["@omnixa/ai/providers/mistral", () => import("@omnixa/ai/providers/mistral")],
  ["@omnixa/ai/providers/moonshot/chat", () => import("@omnixa/ai/providers/moonshot/chat")],
  ["@omnixa/ai/providers/moonshot/messages", () => import("@omnixa/ai/providers/moonshot/messages")],
  ["@omnixa/ai/providers/moonshot/responses", () => import("@omnixa/ai/providers/moonshot/responses")],
  ["@omnixa/ai/providers/openai", () => import("@omnixa/ai/providers/openai")],
  ["@omnixa/ai/providers/openai/chat", () => import("@omnixa/ai/providers/openai/chat")],
  ["@omnixa/ai/providers/openai/responses", () => import("@omnixa/ai/providers/openai/responses")],
  ["@omnixa/ai/providers/openai-compatible", () => import("@omnixa/ai/providers/openai-compatible")],
  [
    "@omnixa/ai/providers/openai-compatible/responses",
    () => import("@omnixa/ai/providers/openai-compatible/responses"),
  ],
  [
    "@omnixa/ai/providers/openai-compatible-responses",
    () => import("@omnixa/ai/providers/openai-compatible-responses"),
  ],
  ["@omnixa/ai/providers/openrouter", () => import("@omnixa/ai/providers/openrouter")],
  ["@omnixa/ai/providers/togetherai", () => import("@omnixa/ai/providers/togetherai")],
  ["@omnixa/ai/providers/venice", () => import("@omnixa/ai/providers/venice")],
  ["@omnixa/ai/providers/vercel-ai-gateway", () => import("@omnixa/ai/providers/vercel-ai-gateway")],
  ["@omnixa/ai/providers/xai", () => import("@omnixa/ai/providers/xai")],
  ["@omnixa/ai/providers/zai/chat", () => import("@omnixa/ai/providers/zai/chat")],
  ["@omnixa/ai/providers/zai-coding-plan/chat", () => import("@omnixa/ai/providers/zai-coding-plan/chat")],
  ["@omnixa/ai/providers/zai-coding-plan/messages", () => import("@omnixa/ai/providers/zai-coding-plan/messages")],
  ["@omnixa/ai/providers/zai-coding-plan/responses", () => import("@omnixa/ai/providers/zai-coding-plan/responses")],
])

export const loadPackage = Effect.fn("Provider.loadPackage")(function* (input: string, npm?: Npm.Interface) {
  const specifier = packageName(input)
  const builtin = builtins.get(specifier)
  if (builtin) return yield* importPackage(specifier, specifier, builtin)
  const resolved = yield* Effect.sync(() => {
    if (specifier.startsWith("file://") || specifier.startsWith("@omnixa/ai/")) return specifier
    try {
      return import.meta.resolve(specifier)
    } catch {
      return undefined
    }
  })
  if (resolved) return yield* importPackage(specifier, resolved)
  if (!npm) {
    return yield* new LoadError({
      package: specifier,
      cause: new Error(`Provider package ${specifier} is not installed`),
    })
  }
  const parts = specifier.split("/")
  const root = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier)
  const installed = yield* npm.add(root).pipe(Effect.mapError((cause) => new LoadError({ package: specifier, cause })))
  const entrypoint = yield* Effect.try({
    try: () => resolveModule(specifier, installed.directory),
    catch: (cause) => new LoadError({ package: specifier, cause }),
  })
  return yield* importPackage(specifier, entrypoint)
})

/** omnixa settings consumed in Core; native packages never receive them. */
const CORE_KEYS = ["chunkTimeout", "compaction", "fetch", "headerTimeout", "timeout", "transport"] as const
const PROVIDER_ONLY_KEYS = ["chunkTimeout", "headerTimeout", "timeout", "transport"] as const

export function nativeSettings(settings: Settings): Settings {
  return Struct.omit(settings, CORE_KEYS)
}

export function modelSettings(settings: Settings | undefined) {
  return settings && Struct.omit(settings, PROVIDER_ONLY_KEYS)
}

const decodeTimeout = Schema.decodeUnknownOption(HttpTimeout)

/** Applied to `headerTimeout` and `chunkTimeout` when provider settings leave them unset or invalid. */
export const DEFAULT_TIMEOUT_MS = 300_000

/** One timeout setting without a default; invalid values are dropped. */
export function timeout(value: unknown) {
  return Option.getOrUndefined(decodeTimeout(value))
}

/** Request timeouts from provider settings, resolved for every route. `timeout` has no default. */
export function timeouts(settings: Readonly<Record<string, unknown>>) {
  return {
    timeout: timeout(settings.timeout),
    headerTimeout: timeout(settings.headerTimeout) ?? DEFAULT_TIMEOUT_MS,
    chunkTimeout: timeout(settings.chunkTimeout) ?? DEFAULT_TIMEOUT_MS,
  }
}

export function mergeOverlay(
  base: Readonly<Record<string, unknown>> | undefined,
  overlay: Readonly<Record<string, unknown>> | undefined,
): Record<string, Json> | undefined {
  if (base === undefined) return overlay && decodeJsonRecord({ ...overlay })
  if (overlay === undefined) return decodeJsonRecord({ ...base })
  return decodeJsonRecord(
    Object.fromEntries(
      new Set([...Object.keys(base), ...Object.keys(overlay)]).values().map((key): [string, unknown] => {
        const left = base[key]
        const right = overlay[key]
        if (right === undefined) return [key, left]
        if (isRecord(left) && isRecord(right)) return [key, mergeOverlay(left, right) ?? {}]
        return [key, right]
      }),
    ),
  )
}

export function mergeHeaders(
  base: Readonly<Record<string, string>> | undefined,
  overlay: Readonly<Record<string, string>> | undefined,
) {
  if (base === undefined) return overlay && { ...overlay }
  if (overlay === undefined) return { ...base }
  return Object.fromEntries(
    [...Object.entries(base), ...Object.entries(overlay)]
      .reduce((result, entry) => {
        result.set(entry[0].toLowerCase(), entry)
        return result
      }, new Map<string, [string, string]>())
      .values(),
  )
}

export const Request = Provider.Request
export type Request = Provider.Request

export const Compaction = Provider.Compaction
export type Compaction = Provider.Compaction

export const Transport = Provider.Transport
export type Transport = Provider.Transport

export const Settings = Provider.Settings
export type Settings = Provider.Settings

export const Info = Provider.Info
export type Info = Provider.Info

export type MutableInfo = DeepMutable<Info>

export { Event } from "@omnixa/schema/provider"

/** Provider metadata owns its drafts; model definitions remain immutable inputs. */
export type Definition = {
  readonly provider: Info
  readonly models: ReadonlyMap<Model.ID, Model.Info>
  readonly sourceConnection?: IntegrationConnection.Info
}

export type ConnectionInput = {
  readonly providerID: ID
  readonly connection: ModelSource.ConnectionRef
}

export function connectionKey(input: ConnectionInput | undefined) {
  return input ? JSON.stringify([input.providerID, IntegrationConnection.key(input.connection)]) : ""
}

export interface Editor {
  readonly scope?: ConnectionInput
  readonly connection: (integrationID: Integration.ID) => IntegrationConnection.Info | undefined
  readonly list: () => readonly Definition[]
  readonly get: (providerID: ID) => Definition | undefined
  readonly add: (definition: {
    readonly info: Info
    readonly models: readonly Model.Info[]
    readonly sourceConnection?: IntegrationConnection.Info
  }) => void
  readonly update: (providerID: ID, update: (provider: MutableInfo) => void) => void
  readonly remove: (providerID: ID) => void
  readonly models: {
    readonly set: (providerID: ID, models: readonly Model.Info[]) => void
    readonly update: (providerID: ID, modelID: Model.ID, update: (model: DeepMutable<Model.Info>) => void) => void
    readonly remove: (providerID: ID, modelID: Model.ID) => void
  }
}

export interface Snapshot {
  readonly scope?: ConnectionInput
  readonly connections?: ReadonlyMap<Integration.ID, IntegrationConnection.Info>
  readonly records: ReadonlyMap<ID, Definition>
  readonly available: readonly Definition[]
  readonly providers: readonly Info[]
}

export interface Interface extends State.Transformable<Editor> {
  readonly get: (providerID: ID, connection?: ModelSource.ConnectionRef) => Effect.Effect<Info | undefined>
  readonly all: () => Effect.Effect<readonly Info[]>
  readonly available: () => Effect.Effect<readonly Info[]>
  /** Internal definition/access snapshot; raw model inventories never cross the HTTP API. */
  readonly snapshot: (input?: ConnectionInput) => Effect.Effect<Snapshot>
}

export class Service extends Context.Service<Service, Interface>()("@omnixa/Provider") {}

type MutableDefinition = {
  provider: MutableInfo
  models: ReadonlyMap<Model.ID, Model.Info>
  sourceConnection?: IntegrationConnection.Info
}
type Records = Map<ID, MutableDefinition>

// Every location references the same index for a shared immutable definition array.
const definitions = new WeakMap<readonly Model.Info[], Map<ID, ReadonlyMap<Model.ID, Model.Info>>>()
function index(providerID: ID, models: readonly Model.Info[]) {
  const indexes = definitions.get(models) ?? new Map<ID, ReadonlyMap<Model.ID, Model.Info>>()
  const cached = indexes.get(providerID)
  if (cached) return cached
  // Model shares these definitions without copying, so a foreign definition takes this provider's identity here.
  const result = freeze(
    new Map(models.map((model) => [model.id, model.providerID === providerID ? model : { ...model, providerID }])),
    true,
  )
  indexes.set(providerID, result)
  definitions.set(models, indexes)
  return result
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const integrations = yield* Integration.Service
    const location = yield* Location.Service
    const requested = new Map<string, ConnectionInput>()
    let byID = new Map<Integration.ID, Integration.Info>()
    let connectionSignature = ""
    const editor = (records: Records, input?: ConnectionInput): Editor => {
      const maps = new WeakMap<ReadonlyMap<Model.ID, Model.Info>, Map<Model.ID, Model.Info>>()
      const models = new WeakSet<Model.Info>()
      const entry = (id: ID) => {
        const current = records.get(id)
        if (current) return current
        const added = { provider: Info.empty(id) as MutableInfo, models: new Map<Model.ID, Model.Info>() }
        records.set(id, added)
        maps.set(added.models, added.models)
        return added
      }
      const writable = (id: ID) => {
        const record = entry(id)
        const current = maps.get(record.models)
        if (current) return current
        const owned = new Map(record.models)
        record.models = owned
        maps.set(owned, owned)
        return owned
      }
      return {
        scope: input,
        connection: (id) => {
          const integration = byID.get(id)
          if (
            input &&
            id === (records.get(input.providerID)?.provider.integrationID ?? Integration.ID.make(input.providerID))
          )
            return integration?.connections.find(
              (connection) => IntegrationConnection.key(connection) === IntegrationConnection.key(input.connection),
            )
          return integration?.connections[0]
        },
        list: () => Array.from(records.values()),
        get: (id) => records.get(id),
        add: (definition) => {
          records.set(definition.info.id, {
            provider: structuredClone(definition.info) as MutableInfo,
            models: index(definition.info.id, definition.models),
            sourceConnection: definition.sourceConnection,
          })
        },
        update: (id, update) => {
          const record = entry(id)
          update(record.provider)
          record.provider.id = id
          AISDKNative.rewrite(record.provider, {
            specifier: record.provider.package,
            providerID: id,
            canonical: record.provider.canonical,
          })
        },
        remove: (id) => {
          records.delete(id)
        },
        models: {
          set: (id, values) => {
            entry(id).models = index(id, values)
          },
          update: (providerID, modelID, update) => {
            const record = entry(providerID)
            const target = writable(providerID)
            const current = target.get(modelID)
            const model = // An earlier add/set can publish and freeze an owned model within this fold.
              castDraft<Model.Info>(
                current && models.has(current) && !Object.isFrozen(current)
                  ? current
                  : current
                    ? structuredClone(current)
                    : Model.Info.default(providerID, modelID),
              )
            update(model)
            model.id = modelID
            model.providerID = providerID
            AISDKNative.rewrite(model, {
              specifier: model.package ?? record.provider.package,
              providerID,
              canonical: model.canonical ?? record.provider.canonical,
              modelID: model.modelID ?? modelID,
            })
            models.add(model)
            target.set(modelID, model)
          },
          remove: (providerID, modelID) => {
            if (!records.has(providerID)) return
            writable(providerID).delete(modelID)
          },
        },
      }
    }
    const state = State.create<Map<string, Records>, Map<string, Editor>>({
      name: "provider",
      initial: () =>
        new Map<string, Records>([
          ["", new Map<ID, MutableDefinition>()],
          ...Array.from(requested.keys(), (key) => [key, new Map<ID, MutableDefinition>()] as const),
        ]),
      editor: (records) => new Map(Array.from(records, ([key, value]) => [key, editor(value, requested.get(key))])),
      notify: () => notify,
    })
    // Registrations may outlive a borrowed service layer; their later disposal must
    // not query dependencies that have already closed.
    yield* Effect.addFinalizer(() => State.shutdown(state.reload()))
    const cached = new Map<string, { records: Snapshot["records"]; value: Snapshot }>()
    const snapshot = Effect.fn("Provider.snapshot")(function* (input?: ConnectionInput) {
      while (true) {
        const revision = integrations.revision()
        // Connection presence decides availability; resolving OAuth tokens belongs to execution.
        const connections = yield* integrations.list()
        const signature = JSON.stringify(connections.map((integration) => [integration.id, integration.connections]))
        byID = new Map(connections.map((integration) => [integration.id, integration]))
        if (connectionSignature !== signature) {
          connectionSignature = signature
          state.invalidate()
        }
        const key = connectionKey(input)
        if (input && !requested.has(key)) {
          requested.set(key, input)
          state.invalidate()
        }
        const views = state.get()
        // Either fold can disable a plugin that also contributed to the other domain.
        if (revision !== integrations.revision() || views !== state.get()) continue
        const records = views.get(key)
        if (!records) throw new Error("The provider connection view is unavailable")
        const target =
          input && (records.get(input.providerID)?.provider.integrationID ?? Integration.ID.make(input.providerID))
        const selected = new Map(
          connections.flatMap((integration) => {
            const connection =
              input && integration.id === target
                ? integration.connections.find(
                    (connection) =>
                      IntegrationConnection.key(connection) === IntegrationConnection.key(input.connection),
                  )
                : integration.connections[0]
            return connection ? [[integration.id, connection] as const] : []
          }),
        )
        const available = Array.from(records.values()).filter((record) => {
          if (record.provider.activation === "disabled") return false
          const integrationID = record.provider.integrationID ?? Integration.ID.make(record.provider.id)
          const integration = byID.get(integrationID)
          const connection = selected.get(integrationID)
          if (
            input &&
            record.provider.id === input.providerID &&
            (!connection || connection.status?.status === "needs_auth")
          )
            return false
          // Never combine the previous account's discovered endpoints/models with a new connection.
          if (
            record.sourceConnection &&
            IntegrationConnection.key(record.sourceConnection) !== IntegrationConnection.key(connection)
          )
            return false
          if (record.provider.activation === "enabled") return true
          if (integration?.connections.length) return true
          return record.provider.integrationID === undefined && !integration
        })
        // A credential change that leaves the same definitions available is not a catalog change.
        const previous = cached.get(key)
        if (
          previous &&
          previous.records === records &&
          previous.value.available.length === available.length &&
          previous.value.available.every((record, index) => record === available[index])
        )
          return previous.value
        const value = freeze(
          {
            scope: input,
            connections: selected,
            records,
            available,
            providers: available.map((record) => record.provider),
          },
          true,
        )
        cached.set(key, { records, value })
        return value
      }
    })
    let published: Snapshot | undefined
    const notify: Effect.Effect<void> = Effect.gen(function* () {
      const value = yield* snapshot()
      if (value === published) return
      published = value
      yield* bus.publish(
        Provider.Event.Updated,
        {},
        {
          location: { directory: location.directory, workspaceID: location.workspaceID },
        },
      )
    })
    yield* bus.subscribe([Integration.Event.Updated, Credential.Event.Updated, Credential.Event.Switched]).pipe(
      Stream.runForEach(() => notify),
      Effect.forkScoped({ startImmediately: true }),
    )
    return Service.of({
      transform: (update) => state.transform((editors) => editors.forEach(update)),
      reload: state.reload,
      get: Effect.fn("Provider.get")((id, connection) =>
        connection
          ? snapshot({ providerID: id, connection }).pipe(Effect.map((value) => value.records.get(id)?.provider))
          : Effect.sync(() => freeze(state.get().get("")?.get(id)?.provider, true)),
      ),
      all: Effect.fn("Provider.all")(() =>
        Effect.sync(() => Array.from(state.get().get("")?.values() ?? [], (record) => freeze(record.provider, true))),
      ),
      available: Effect.fn("Provider.available")(() => snapshot().pipe(Effect.map((value) => value.providers))),
      snapshot,
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Bus.node, Integration.node, Location.node] })

const importPackage = Effect.fn("Provider.importPackage")(function* (
  specifier: string,
  entrypoint: string,
  load = () => importModule(entrypoint),
) {
  const module = yield* Effect.tryPromise({
    try: () => {
      const existing = packages.get(entrypoint)
      if (existing) return existing
      const loaded = load()
      packages.set(entrypoint, loaded)
      return loaded
    },
    catch: (cause) => new LoadError({ package: specifier, cause }),
  })
  if (typeof module !== "object" || module === null || typeof (module as { model?: unknown }).model !== "function") {
    return yield* new LoadError({
      package: specifier,
      cause: new Error(`Provider package ${specifier} does not export model(modelID, settings)`),
    })
  }
  return module as ProviderPackageDefinition
})
