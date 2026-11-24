export * as ModelGroup from "./model-group.js"

import { Context, Effect, Layer, Option, Schema } from "effect"
import { makeLocationNode } from "@omnixa/util/effect/app-node"
import { Hash } from "@omnixa/util/hash"
import { Model } from "@omnixa/schema/model"
import { ModelGroup } from "@omnixa/schema/model-group"
import { ProviderDefinition } from "@omnixa/schema/provider-definition"
import type { Entry } from "@omnixa/schema/config"
import { Config } from "./config.js"
import { ConfigProviderFile } from "./config/provider-file.js"

export {
  Member,
  Definition,
  BehaviorSnapshot,
  Current,
  Authored,
  Read,
  SaveInput,
  SaveResult,
  RemoveInput,
  RemoveResult,
  decodeSave,
  decodeRemove,
} from "@omnixa/schema/model-group"

export class UnavailableError extends Schema.TaggedError<UnavailableError>()("ModelGroup.Unavailable", {
  groupID: Model.GroupID,
  reason: Schema.Literals(["missing", "disabled", "empty", "no-candidates", "strategy-unavailable"]),
}) {
  override get message() {
    return `Model group "${this.groupID}" is unavailable: ${this.reason}`
  }
}

export function snapshot(groupID: Model.GroupID, definition: ModelGroup.Definition) {
  const members = definition.members.map((member) =>
    ModelGroup.Member.make({
      providerID: member.providerID,
      id: member.id,
      ...(member.variant === undefined || member.variant === "default" ? {} : { variant: member.variant }),
      ...(member.weight === undefined ? {} : { weight: member.weight }),
      ...(member.connections === undefined
        ? {}
        : { connections: member.connections.map((connection) => ({ ...connection })) }),
    }),
  )
  return new ModelGroup.BehaviorSnapshot({
    groupID,
    members,
    strategy: definition.strategy,
    affinity: definition.affinity,
    behaviorDigest: Hash.sha256(
      JSON.stringify({
        members: members.map((member) => ({
          ...Schema.encodeSync(ModelGroup.Member)(member),
          weight: member.weight ?? 1,
          ...(member.connections === undefined
            ? {}
            : {
                connections: member.connections.map((connection) => ({
                  ...connection,
                  weight: connection.weight ?? 1,
                })),
              }),
        })),
        strategy: definition.strategy,
        affinity: definition.affinity,
      }),
    ),
  })
}

/** Each named group owns one complete highest-priority definition. */
export function effectiveGroup(entries: readonly Entry[], groupID: Model.GroupID) {
  const entry = entries.findLast(
    (entry) => entry.type === "document" && entry.info.modelGroups?.[groupID] !== undefined,
  )
  const definition = entry?.type === "document" ? entry.info.modelGroups?.[groupID] : undefined
  return new ModelGroup.Current({
    groupID,
    definition,
    source: entry?.type === "document" && entry.path === undefined ? { scope: "virtual" } : undefined,
    behavior: definition === undefined ? undefined : snapshot(groupID, definition),
    unavailable:
      definition === undefined
        ? "missing"
        : !definition.enabled
          ? "disabled"
          : definition.members.length === 0
            ? "empty"
            : undefined,
  })
}

export const current = Effect.fn("ModelGroup.current")(function* (groupID: Model.GroupID) {
  const config = yield* Config.Service
  return effectiveGroup(yield* config.entries(), groupID)
})

export const behavior = Effect.fn("ModelGroup.behavior")(function* (groupID: Model.GroupID) {
  const selected = yield* current(groupID)
  if (selected.unavailable !== undefined || selected.behavior === undefined)
    return yield* new UnavailableError({ groupID, reason: selected.unavailable ?? "missing" })
  return selected.behavior
})

export const get = Effect.fn("ModelGroup.get")(function* (groupID?: Model.GroupID) {
  const config = yield* Config.Service
  const entries = yield* config.entries()
  const authored = config.provider
    ? yield* config.provider.list()
    : {
        targets: [],
        groups: entries.flatMap((entry) =>
          entry.type === "document"
            ? Object.entries(entry.info.modelGroups ?? {}).map(([id, definition]) => ({
                groupID: Model.GroupID.make(id),
                definition,
                source: { scope: "virtual" as const, path: entry.path },
                target: undefined,
              }))
            : [],
        ),
      }
  const definitions = authored.groups
    .filter((item) => groupID === undefined || item.groupID === groupID)
    .map(
      (item, index, groups) =>
        new ModelGroup.Authored({
          ...item,
          inherited: groups
            .slice(0, index)
            .filter((prior) => prior.groupID === item.groupID)
            .map((prior) => prior.source),
        }),
    )
  const ids =
    groupID === undefined
      ? [
          ...new Set(
            entries
              .flatMap((entry) =>
                entry.type === "document"
                  ? Object.keys(entry.info.modelGroups ?? {}).map((id) => Model.GroupID.make(id))
                  : [],
              )
              .concat(definitions.map((item) => item.groupID)),
          ),
        ]
      : [groupID]
  return new ModelGroup.Read({
    targets: authored.targets,
    definitions,
    effective: ids.map((id) => {
      const selected = effectiveGroup(entries, id)
      return new ModelGroup.Current({
        ...selected,
        source:
          selected.definition === undefined
            ? undefined
            : (definitions.findLast((item) => item.groupID === id)?.source ?? selected.source),
      })
    }),
  })
})

export const save = Effect.fn("ModelGroup.save")(function* (input: ModelGroup.SaveInput) {
  const config = yield* Config.Service
  if (!config.provider)
    return yield* new ConfigProviderFile.InvalidTargetError({
      message: "Authored model group configuration is unavailable",
    })
  const definition = yield* config.provider
    .transaction(input.target, (file, write, reload) =>
      Effect.gen(function* () {
        if (input.expectedDigest !== file.target.digest)
          return yield* new ConfigProviderFile.ConflictError({
            target: file.target,
            message: "The configuration changed since it was read",
          })
        const base =
          file.modelGroups[input.groupID] ??
          effectiveGroup(yield* config.entries(), input.groupID).definition ??
          new ModelGroup.Definition({
            name: input.groupID,
            enabled: true,
            members: [],
            strategy: "order",
            affinity: "turn",
          })
        const candidate = Schema.decodeUnknownOption(ModelGroup.Definition)({ ...base, ...input.patch.set })
        if (Option.isNone(candidate))
          return yield* new ConfigProviderFile.InvalidDocumentError({
            target: file.target,
            message: "The requested model group definition is invalid",
          })
        const next = yield* write({ type: "group-set", groupID: input.groupID, definition: candidate.value })
        yield* reload
        return {
          status: next.target.digest === file.target.digest ? "unchanged" : "saved",
          target: next.target,
        } satisfies ProviderDefinition.DefinitionResult
      }),
    )
    .pipe(
      Effect.catchTag("ConfigProviderFile.Conflict", (error) =>
        Effect.succeed({
          status: "conflict",
          target: error.target,
          message: error.message,
        } satisfies ProviderDefinition.DefinitionResult),
      ),
      Effect.catchTag("ConfigProviderFile.InvalidDocument", (error) =>
        Effect.succeed({
          status: "failed",
          target: error.target,
          message: error.message,
        } satisfies ProviderDefinition.DefinitionResult),
      ),
      Effect.catchTag("ConfigProviderFile.Write", (error) =>
        Effect.succeed({
          status: "failed",
          target: error.target,
          message: error.message,
        } satisfies ProviderDefinition.DefinitionResult),
      ),
      Effect.catchTag("ConfigProviderFile.Read", (error) =>
        Effect.succeed({ status: "failed", message: error.message } satisfies ProviderDefinition.DefinitionResult),
      ),
    )
  if (definition.status === "conflict") yield* config.provider.reload(input.target)
  const readback = yield* get(input.groupID).pipe(Effect.catchTag("ConfigProviderFile.Read", () => Effect.undefined))
  return new ModelGroup.SaveResult({ groupID: input.groupID, definition, readback })
})

export const remove = Effect.fn("ModelGroup.remove")(function* (input: ModelGroup.RemoveInput) {
  const config = yield* Config.Service
  if (!config.provider)
    return yield* new ConfigProviderFile.InvalidTargetError({
      message: "Authored model group configuration is unavailable",
    })
  const definition = yield* config.provider
    .transaction(input.target, (file, write, reload) =>
      Effect.gen(function* () {
        if (input.expectedDigest !== file.target.digest)
          return yield* new ConfigProviderFile.ConflictError({
            target: file.target,
            message: "The configuration changed since it was read",
          })
        const next = yield* write({ type: "group-remove", groupID: input.groupID })
        yield* reload
        return {
          status: next.target.digest === file.target.digest ? "unchanged" : "saved",
          target: next.target,
        } satisfies ProviderDefinition.DefinitionResult
      }),
    )
    .pipe(
      Effect.catchTag("ConfigProviderFile.Conflict", (error) =>
        Effect.succeed({
          status: "conflict",
          target: error.target,
          message: error.message,
        } satisfies ProviderDefinition.DefinitionResult),
      ),
      Effect.catchTag("ConfigProviderFile.InvalidDocument", (error) =>
        Effect.succeed({
          status: "failed",
          target: error.target,
          message: error.message,
        } satisfies ProviderDefinition.DefinitionResult),
      ),
      Effect.catchTag("ConfigProviderFile.Write", (error) =>
        Effect.succeed({
          status: "failed",
          target: error.target,
          message: error.message,
        } satisfies ProviderDefinition.DefinitionResult),
      ),
      Effect.catchTag("ConfigProviderFile.Read", (error) =>
        Effect.succeed({ status: "failed", message: error.message } satisfies ProviderDefinition.DefinitionResult),
      ),
    )
  if (definition.status === "conflict") yield* config.provider.reload(input.target)
  const readback = yield* get(input.groupID).pipe(Effect.catchTag("ConfigProviderFile.Read", () => Effect.undefined))
  return new ModelGroup.RemoveResult({
    groupID: input.groupID,
    definition,
    inherited:
      readback?.definitions.filter((item) => item.target?.path !== input.target.path).map((item) => item.source) ?? [],
    readback,
  })
})

export interface Interface {
  readonly current: (groupID: Model.GroupID) => Effect.Effect<ModelGroup.Current>
  readonly behavior: (groupID: Model.GroupID) => Effect.Effect<ModelGroup.BehaviorSnapshot, UnavailableError>
  readonly get: (groupID?: Model.GroupID) => Effect.Effect<ModelGroup.Read, ConfigProviderFile.Error>
  readonly save: (input: ModelGroup.SaveInput) => Effect.Effect<ModelGroup.SaveResult, ConfigProviderFile.Error>
  readonly remove: (input: ModelGroup.RemoveInput) => Effect.Effect<ModelGroup.RemoveResult, ConfigProviderFile.Error>
}

export class Service extends Context.Service<Service, Interface>()("@omnixa/ModelGroup") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    return Service.of({
      current: (groupID) => current(groupID).pipe(Effect.provideService(Config.Service, config)),
      behavior: (groupID) => behavior(groupID).pipe(Effect.provideService(Config.Service, config)),
      get: (groupID) => get(groupID).pipe(Effect.provideService(Config.Service, config)),
      save: (input) => save(input).pipe(Effect.provideService(Config.Service, config)),
      remove: (input) => remove(input).pipe(Effect.provideService(Config.Service, config)),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Config.node] })
