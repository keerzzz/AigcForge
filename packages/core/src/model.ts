import { Model } from "@aigcfroge/schema/model"
import { Provider } from "./provider.js"
import type { DeepMutable } from "./schema.js"
import { Context, Effect, Layer, Option, Stream } from "effect"
import { makeLocationNode } from "@aigcfroge/util/effect/app-node"
import { Bus } from "./bus.js"
import { State } from "./state.js"
import { Location } from "./location.js"
import { freeze } from "immer"
import { AISDKNative } from "./aisdk-native.js"
import { ModelGroup } from "./model-group.js"
import type { ConfigModel } from "@aigcfroge/schema/config/model"
import { Config } from "./config.js"
import type { ModelSource } from "@aigcfroge/schema/model-source"
import type { Integration } from "./integration.js"
import type { IntegrationConnection } from "./integration/connection.js"

export const ID = Model.ID
export type ID = typeof ID.Type

export const VariantID = Model.VariantID
export type VariantID = typeof VariantID.Type

// Grouping of models, eg claude opus, claude sonnet
export const Family = Model.Family
export type Family = Model.Family

export const ReasoningField = Model.ReasoningField
export type ReasoningField = Model.ReasoningField

export const Compatibility = Model.Compatibility
export type Compatibility = Model.Compatibility

export const Capabilities = Model.Capabilities
export type Capabilities = Model.Capabilities

/** Merges partial config capabilities onto a base model's capabilities, defaulting unset fields. */
export const mergeCapabilities = (config: Partial<Capabilities>, base: Capabilities | undefined) => {
  const fallback = base ?? Capabilities.default()
  return {
    tools: config.tools ?? fallback.tools,
    input: [...(config.input ?? fallback.input)],
    output: [...(config.output ?? fallback.output)],
  }
}

export const Cost = Model.Cost

export const Ref = Model.Ref
export type Ref = typeof Ref.Type

export const GroupID = Model.GroupID
export type GroupID = Model.GroupID
export const GroupRef = Model.GroupRef
export type GroupRef = Model.GroupRef
export const Selection = Model.Selection
export type Selection = Model.Selection

export const Info = Model.Info
export type Info = Model.Info

/** Effective provider and model settings used only while constructing a runtime model. */
export type RuntimeInfo = Omit<Info, "settings"> & { readonly settings?: Provider.Settings }

export type MutableInfo = DeepMutable<Info>

export { Event } from "@aigcfroge/schema/model"

export interface Editor {
  readonly scope?: Provider.ConnectionInput
  readonly connection: (integrationID: Integration.ID) => IntegrationConnection.Info | undefined
  /** Includes disabled candidates so later transforms can re-enable them. */
  readonly list: (providerID?: Provider.ID) => readonly MutableInfo[]
  readonly get: (providerID: Provider.ID, modelID: ID) => MutableInfo | undefined
  readonly update: (providerID: Provider.ID, modelID: ID, update: (model: MutableInfo) => void) => void
  readonly remove: (providerID: Provider.ID, modelID: ID) => void
  readonly default: {
    readonly get: () => { providerID: Provider.ID; modelID: ID } | undefined
    readonly set: (providerID: Provider.ID, modelID: ID) => void
    readonly selection: () => Selection | undefined
    readonly select: (selection: Selection) => void
  }
  /** Coherent, read-only provider inputs, including definitions from inactive providers. */
  readonly provider: {
    readonly list: () => readonly Provider.Definition[]
    readonly get: (providerID: Provider.ID) => Provider.Definition | undefined
  }
}

export interface Interface extends State.Transformable<Editor> {
  readonly get: (providerID: Provider.ID, modelID: ID, connection?: ModelSource.ConnectionRef) => Effect.Effect<Info | undefined>
  readonly all: (input?: Provider.ConnectionInput) => Effect.Effect<readonly Info[]>
  readonly available: (input?: Provider.ConnectionInput) => Effect.Effect<readonly Info[]>
  readonly default: () => Effect.Effect<Info | undefined, ModelGroup.UnavailableError>
  readonly selection: () => Effect.Effect<Selection | undefined>
  readonly small: (providerID: Provider.ID) => Effect.Effect<Info | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/Model") {}

type Data = {
  models: Map<Provider.ID, ReadonlyMap<ID, Info>>
  defaultModel?: Selection
}

type Catalog = {
  data: Data
  all: readonly Info[]
  available: readonly Info[]
  byProvider: ReadonlyMap<Provider.ID, ReadonlyMap<ID, Info>>
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const providers = yield* Provider.Service
    const bus = yield* Bus.Service
    const location = yield* Location.Service
    const groups = yield* ModelGroup.Service
    const config = yield* Config.Service
    let groupEntries = yield* config.entries()
    const requested = new Map<string, Provider.ConnectionInput>()
    let input = new Map<string, Provider.Snapshot>()
    const editor = (data: Data, providerInput?: Provider.Snapshot): Editor => {
        // Definitions are shared across Locations; a provider's map and a model are copied before their first edit.
        const owned = new WeakSet<ReadonlyMap<ID, Info>>()
        const drafts = new WeakSet<Info>()
        const writable = (providerID: Provider.ID) => {
          const current = data.models.get(providerID)
          if (!current) return undefined
          if (owned.has(current)) return current as Map<ID, Info>
          const copy = new Map(current)
          owned.add(copy)
          data.models.set(providerID, copy)
          return copy
        }
        const draft = (providerID: Provider.ID, modelID: ID) => {
          const models = writable(providerID)
          if (!models) return undefined
          const current = models.get(modelID)
          if (!current) return undefined
          if (drafts.has(current)) return current as MutableInfo
          const copy = structuredClone(current) as MutableInfo
          drafts.add(copy)
          models.set(modelID, copy)
          return copy
        }
        return {
          scope: providerInput?.scope,
          connection: (integrationID) => providerInput?.connections?.get(integrationID),
          list: (providerID) => {
            const ids = providerID === undefined ? Array.from(data.models.keys()) : [providerID]
            return ids.flatMap((id) =>
              Array.from(data.models.get(id)?.keys() ?? []).flatMap((modelID) => draft(id, modelID) ?? []),
            )
          },
          get: draft,
          update: (providerID, modelID, update) => {
            // Model edits cannot create/enable a provider or bypass its availability decision.
            const models = writable(providerID)
            if (!models) return
            const model = draft(providerID, modelID) ?? (Info.default(providerID, modelID) as MutableInfo)
            update(model)
            model.id = modelID
            model.providerID = providerID
            const provider = providerInput?.records.get(providerID)?.provider
            AISDKNative.rewrite(model, {
              specifier: model.package ?? provider?.package,
              providerID,
              canonical: model.canonical ?? provider?.canonical,
              modelID: model.modelID ?? modelID,
            })
            drafts.add(model)
            models.set(modelID, model)
          },
          remove: (providerID, modelID) => {
            writable(providerID)?.delete(modelID)
          },
          default: {
            get: () => {
              if (data.defaultModel === undefined) return undefined
              if (!Selection.isGroup(data.defaultModel)) return { providerID: data.defaultModel.providerID, modelID: data.defaultModel.id }
              const selected = groupDefault(ModelGroup.effectiveGroup(config.current?.() ?? groupEntries, data.defaultModel.groupID), data.models)
              if (selected instanceof ModelGroup.UnavailableError) throw selected
              return { providerID: selected.providerID, modelID: selected.id }
            },
            set: (providerID, modelID) => {
              data.defaultModel = Ref.make({ providerID, id: modelID })
            },
            selection: () => data.defaultModel,
            select: (selection) => { data.defaultModel = selection },
          },
          provider: {
            list: () => Array.from(providerInput?.records.values() ?? []),
            get: (providerID) => providerInput?.records.get(providerID),
          },
        }
      }
    const state = State.create<Map<string, Data>, Map<string, Editor>>({
      name: "model",
      initial: () => new Map<string, Data>(Array.from(input, ([key, value]) => [key, {
        models: new Map(value.available.map((record) => [record.provider.id, record.models])),
      }])),
      editor: (data) => new Map(Array.from(data, ([key, value]) => [key, editor(value, input.get(key))])),
      // read() also refreshes dependencies changed inside a State.batch before notification.
      notify: () => notify,
    })
    yield* Effect.addFinalizer(() => State.shutdown(state.reload()))
    const cached = new Map<string, Catalog>()
    const prepare = Effect.gen(function* () {
      groupEntries = yield* config.entries()
      const snapshots = new Map(yield* Effect.forEach(
        ["", ...requested.keys()],
        (key) => providers.snapshot(requested.get(key)).pipe(Effect.map((value) => [key, value] as const)),
      ))
      if (input.size !== snapshots.size || Array.from(snapshots).some(([key, value]) => input.get(key) !== value)) {
        input = snapshots
        state.invalidate()
      }
      return snapshots
    })
    // An unedited model keeps its shared definition object across rebuilds, so its merged output is reusable.
    const merged = new WeakMap<Info, { provider: Provider.Info | undefined; model: Info }>()
    const read = Effect.fn("Model.snapshot")(function* (scope?: Provider.ConnectionInput) {
      const key = Provider.connectionKey(scope)
      if (scope && !requested.has(key)) requested.set(key, scope)
      if (scope) {
        const { ProviderDiscovery } = yield* Effect.promise(() => import("./provider/discovery.js"))
        const discovery = yield* Effect.serviceOption(ProviderDiscovery.Service)
        if (Option.isSome(discovery)) yield* discovery.value.prepare(scope)
      }
      while (true) {
        const current = (yield* prepare).get(key)
        const data = state.get().get(key)
        if (!data) throw new Error("The model connection view is unavailable")
        const previous = cached.get(key)
        if (previous && previous.data === data) return previous
        // A failed model transform can remove its plugin's provider/integration registrations.
        // Re-materialize from the surviving inputs, not from the failed candidate's seed.
        if (current !== (yield* providers.snapshot(scope))) continue
        const byProvider = new Map(
          Array.from(data.models, ([providerID, models]) => {
            const provider = current?.records.get(providerID)?.provider
            return [
              providerID,
              new Map(
                Array.from(models, ([id, model]) => {
                  const reusable = merged.get(model)
                  if (reusable && reusable.provider === provider) return [id, reusable.model]
                  const value = {
                    ...model,
                    ...(provider?.canonical === undefined ? {} : { canonical: provider.canonical }),
                    package: model.package ?? provider?.package,
                    settings: Provider.mergeOverlay(
                      Provider.modelSettings(provider?.settings),
                      Provider.modelSettings(model.settings),
                    ),
                    headers: Provider.mergeHeaders(provider?.headers, model.headers),
                    body: Provider.mergeOverlay(provider?.body, model.body),
                  } satisfies Info
                  merged.set(model, { provider, model: value })
                  return [id, value]
                }),
              ),
            ]
          }),
        )
        const all = Array.from(byProvider.values())
          .flatMap((models) => Array.from(models.values()))
          .sort((left, right) => right.time.released - left.time.released)
        const value = freeze({ data, all, available: all.filter((model) => model.enabled), byProvider }, true)
        cached.set(key, value)
        return value
      }
    })
    const reload = () => prepare.pipe(Effect.andThen(state.reload()))
    let published: Catalog | undefined
    const notify: Effect.Effect<void> = Effect.gen(function* () {
      const value = yield* read()
      if (value === published) return
      published = value
      yield* bus.publish(
        Model.Event.Updated,
        {},
        {
          location: { directory: location.directory, workspaceID: location.workspaceID },
        },
      )
    })
    yield* bus.subscribe(Provider.Event.Updated).pipe(
      Stream.runForEach(() => notify),
      Effect.forkScoped({ startImmediately: true }),
    )
    return Service.of({
      transform: (update) => prepare.pipe(Effect.andThen(state.transform((editors) => editors.forEach(update)))),
      reload,
      get: Effect.fn("Model.get")((providerID, modelID, connection) =>
        read(connection && { providerID, connection }).pipe(Effect.map((value) => value.byProvider.get(providerID)?.get(modelID))),
      ),
      all: Effect.fn("Model.all")((scope) => read(scope).pipe(Effect.map((value) => scope
        ? value.all.filter((model) => model.providerID === scope.providerID)
        : value.all))),
      available: Effect.fn("Model.available")((scope) => read(scope).pipe(Effect.map((value) => scope
        ? value.available.filter((model) => model.providerID === scope.providerID)
        : value.available))),
      selection: Effect.fn("Model.selection")(function* () {
        const value = yield* read()
        const requested = value.data.defaultModel
        if (requested && Selection.isGroup(requested)) return requested
        if (requested && value.byProvider.get(requested.providerID)?.get(requested.id)?.enabled) return requested
        const fallback = value.available.find(supportsText)
        return fallback ? Ref.make({ providerID: fallback.providerID, id: fallback.id }) : undefined
      }),
      default: Effect.fn("Model.default")(function* () {
        const value = yield* read()
        const requested = value.data.defaultModel
        if (requested && Selection.isGroup(requested)) {
          const current = yield* groups.current(requested.groupID)
          const selected = groupDefault(current, value.byProvider)
          if (selected instanceof ModelGroup.UnavailableError) return yield* selected
          return selected
        }
        const model = requested && value.byProvider.get(requested.providerID)?.get(requested.id)
        return model?.enabled ? model : value.available.find(supportsText)
      }),
      small: Effect.fn("Model.small")(function* (providerID) {
        const value = yield* read()
        const models = value.available.filter(
          (model) =>
            model.providerID === providerID &&
            model.status === "active" &&
            model.capabilities.input.some((item) => item.startsWith("text")) &&
            model.capabilities.output.some((item) => item.startsWith("text")),
        )
        return ["gpt-luna", "gemini-flash-lite", "gemini-flash", "claude-haiku"].flatMap(
          (family) => models.find((model) => model.family === family) ?? [],
        )[0]
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Provider.node, Bus.node, Location.node, ModelGroup.node, Config.node] })

export function supportsText(model: Pick<Info, "capabilities">) {
  return (
    (model.capabilities.input.length === 0 || model.capabilities.input.some((item) => item.startsWith("text"))) &&
    (model.capabilities.output.length === 0 || model.capabilities.output.some((item) => item.startsWith("text")))
  )
}

export function compatibility(input: unknown): Compatibility | undefined {
  if (typeof input === "string") return { reasoningField: input }
  if (typeof input !== "object" || input === null || Array.isArray(input) || !("field" in input)) return undefined
  return typeof input.field === "string" ? { reasoningField: input.field } : undefined
}

export function parse(input: string): { providerID: Provider.ID; modelID: ID } {
  const index = input.indexOf("/")
  return {
    providerID: Provider.ID.make(index === -1 ? input : input.slice(0, index)),
    modelID: ID.make(index === -1 ? "" : input.slice(index + 1)),
  }
}

/** Config retains its historical `model` key at the input boundary. */
export function fromConfig(selection: ConfigModel.Selection): Selection {
  if ("type" in selection) return new GroupRef({ type: "group", groupID: selection.groupID })
  return Ref.make({
    providerID: selection.providerID,
    id: selection.model,
    ...(selection.variant === undefined ? {} : { variant: selection.variant }),
  })
}

function groupDefault(current: ModelGroup.Current, models: ReadonlyMap<Provider.ID, ReadonlyMap<ID, Info>>) {
  if (current.unavailable !== undefined) return new ModelGroup.UnavailableError({ groupID: current.groupID, reason: current.unavailable })
  const selected = current.definition?.members.flatMap((member) => {
    const model = models.get(member.providerID)?.get(member.id)
    return model?.enabled && supportsText(model) && (member.variant === undefined || member.variant === "default" || model.variants.some((variant) => variant.id === member.variant)) ? [model] : []
  })[0]
  return selected ?? new ModelGroup.UnavailableError({ groupID: current.groupID, reason: "no-candidates" })
}

export * as Model from "./model.js"
