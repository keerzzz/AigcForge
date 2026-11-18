export * as ProviderDefinition from "./definition.js"

import { Cause, Context, Effect, Option, RcMap, Schema, type LayerMap } from "effect"
import { isDeepStrictEqual } from "node:util"
import { SqlError } from "effect/sql/SqlError"
import { ConfigProvider } from "@aigcfroge/schema/config/provider"
import { ProviderDefinition } from "@aigcfroge/schema/provider-definition"
import { Config } from "../config.js"
import { ConfigProviderFile } from "../config/provider-file.js"
import { Credential } from "../credential.js"
import { Integration } from "../integration.js"
import { Provider } from "../provider.js"
import { Model } from "../model.js"
import { IntegrationConnection } from "../integration/connection.js"
import { LocationServiceMap } from "../location-service-map.js"
import { ProviderDiscovery } from "./discovery.js"
import type { Location } from "../location.js"
import type { Instance } from "../instance.js"

export {
  Info,
  List,
  SaveInput,
  SaveResult,
  RemoveInput,
  RemoveResult,
  decodeSave,
  decodeRemove,
} from "@aigcfroge/schema/provider-definition"

export class UnavailableError extends Schema.TaggedError<UnavailableError>()("ProviderDefinition.Unavailable", {
  message: Schema.String,
}) {}

export class AdoptionError extends Schema.TaggedError<AdoptionError>()("ProviderDefinition.Adoption", {
  stage: Schema.Literals(["credential", "connection", "catalog"]),
  message: Schema.String,
}) {}

export const get = Effect.fn("ProviderDefinition.get")(function* (providerID?: Provider.ID) {
  const config = yield* Config.Service
  if (!config.provider) return yield* new UnavailableError({ message: "Authored provider definitions are unavailable" })
  const authored = yield* config.provider.list()
  const integrations = yield* Integration.Service
  const credentials = yield* Credential.Service
  const providers = yield* Provider.Service
  const connections = new Map(
    (yield* integrations.list()).map((integration) => [integration.id, integration.connections]),
  )
  const definitions = yield* Effect.forEach(
    authored.definitions.filter((item) => providerID === undefined || item.providerID === providerID),
    (item) =>
      Effect.gen(function* () {
        const provider = yield* providers.get(item.providerID)
        const integrationID = provider?.integrationID ?? Integration.ID.make(item.providerID)
        const known = connections.get(integrationID) ?? []
        const stored = yield* credentials.list(integrationID)
        const available: readonly IntegrationConnection.Info[] = known.length
          ? known
          : stored.toReversed().map((credential) => ({
              type: "credential",
              id: credential.id,
              label: credential.label,
              method: credential.value.type,
            }))
        const safe = ConfigProviderFile.redact(item.definition)
        return {
          ...item,
          ...safe,
          inherited: authored.definitions
            .slice(0, authored.definitions.indexOf(item))
            .filter((prior) => prior.providerID === item.providerID)
            .map((prior) => prior.source),
          connections: available,
          activeConnection: available[0],
        } satisfies ProviderDefinition.Info
      }),
  )
  return { targets: authored.targets, definitions } satisfies ProviderDefinition.List
})

export const save = Effect.fn("ProviderDefinition.save")(function* (input: ProviderDefinition.SaveInput) {
  const config = yield* Config.Service
  if (!config.provider) return yield* new UnavailableError({ message: "Authored provider definitions are unavailable" })
  if (!input.providerID.trim() || !input.submissionID.trim())
    return yield* new ConfigProviderFile.InvalidTargetError({ message: "Provider and submission IDs must be nonempty" })
  const credentials = yield* Credential.Service
  const integrations = yield* Integration.Service
  const providers = yield* Provider.Service
  const models = yield* Model.Service
  const discovery = Option.getOrUndefined(yield* Effect.serviceOption(ProviderDiscovery.Service))
  const locations = Option.getOrUndefined(yield* Effect.serviceOption(LocationServiceMap.Service))
  let definition: ProviderDefinition.DefinitionResult = { status: "unchanged" }
  let credential: ProviderDefinition.CredentialResult = { status: "skipped" }
  let catalog: ProviderDefinition.CatalogResult = { status: "pending" }
  let addedModelIDs: readonly Model.ID[] = []

  yield* config.provider
    .transaction(input.target, (file, write, reload) =>
      Effect.gen(function* () {
        definition = { status: "unchanged", target: file.target }
        const original = file.definitions[input.providerID]
        const retry = original?.adoption?.submissionID === input.submissionID
        const action =
          input.credential.type === "create" &&
          input.credential.key !== undefined &&
          !input.credential.key.trim() &&
          !retry
            ? { type: "keep" as const }
            : input.credential
        const integrationID =
          (yield* providers.get(input.providerID))?.integrationID ?? Integration.ID.make(input.providerID)
        const active = yield* integrations.connection.active(integrationID)
        const credentialID = retry
          ? original.adoption!.credentialID
          : action.type === "create"
            ? Credential.ID.create()
            : action.type === "use"
              ? action.credentialID
              : active?.type === "credential"
                ? active.id
                : undefined
        const draft = yield* ConfigProviderFile.preview(file, input.providerID, input.patch)
        const savedCredential =
          retry && action.type === "create" && !action.key?.trim() && credentialID
            ? yield* credentials.get(credentialID)
            : undefined
        const key =
          action.type === "create"
            ? action.key?.trim()
              ? action.key
              : savedCredential?.value.type === "key"
                ? savedCredential.value.key
                : undefined
            : undefined
        const seeds =
          discovery &&
          action.type === "create" &&
          key &&
          credentialID &&
          Object.values(draft.models ?? {}).some((model) => model.seed && model.seed.identity.connection === undefined)
            ? yield* discovery.bindSeeds({
                providerID: input.providerID,
                target: input.target,
                candidate: draft,
                key,
                credentialID,
              })
            : {}
        const patch: ProviderDefinition.Patch = Object.keys(seeds).length
          ? {
              ...input.patch,
              set: {
                ...input.patch.set,
                models: {
                  ...input.patch.set?.models,
                  ...Object.fromEntries(
                    Object.entries(seeds).map(([id, seed]) => [
                      id,
                      new ConfigProvider.Model({ ...input.patch.set?.models?.[id], seed }),
                    ]),
                  ),
                },
              },
            }
          : input.patch
        const candidate = yield* ConfigProviderFile.preview(file, input.providerID, patch)
        const targetDigest = ConfigProviderFile.digest(candidate)
        const currentValue = original && { ...Schema.encodeSync(ConfigProvider.Info)(original) }
        const candidateValue = { ...Schema.encodeSync(ConfigProvider.Info)(candidate) }
        if (currentValue) delete currentValue.adoption
        delete candidateValue.adoption
        if (
          retry &&
          (original.adoption?.targetDefinitionDigest !== targetDigest ||
            !isDeepStrictEqual(currentValue, candidateValue) ||
            original.adoption.credentialAction !== action.type ||
            (action.type === "use" && action.credentialID !== original.adoption.credentialID) ||
            (action.type === "create" &&
              action.label !== undefined &&
              action.label !== original.adoption.credentialLabel) ||
            (action.type === "create" &&
              action.activate !== undefined &&
              action.activate !== original.adoption.activate))
        )
          return yield* new ConfigProviderFile.ConflictError({
            target: file.target,
            message: "This submission ID already belongs to a different save",
          })
        if (!retry && input.expectedDigest !== file.target.digest)
          return yield* new ConfigProviderFile.ConflictError({
            target: file.target,
            message: "The configuration changed since it was read",
          })

        addedModelIDs = retry
          ? original.adoption!.addedModelIDs
          : Object.keys(candidate.models ?? {})
              .filter((id) => !original?.models?.[id])
              .map((id) => Model.ID.make(id))
        const simple = action.type === "keep" && (!original?.adoption || original.adoption.phase === "ready")
        let adoption: ConfigProvider.Adoption = retry
          ? original.adoption!
          : {
              phase: simple ? "ready" : action.type === "create" && !action.key?.trim() ? "draft" : "applying",
              submissionID: input.submissionID,
              targetDefinitionDigest: targetDigest,
              stage: simple ? "complete" : "credential",
              credentialAction: action.type,
              credentialID,
              credentialLabel: action.type === "create" ? (action.label ?? "default") : undefined,
              activate: action.type === "create" ? action.activate !== false : action.type === "use",
              addedModelIDs,
            }

        const qualifyCredential = Effect.fnUntraced(function* () {
          if (!adoption.credentialID) return
          const stored = yield* credentials.get(adoption.credentialID)
          if (stored && stored.integrationID !== integrationID)
            return yield* new ConfigProviderFile.ConflictError({
              target: file.target,
              message: "The credential belongs to a different integration",
            })
          if (
            stored &&
            action.type === "create" &&
            action.key?.trim() &&
            (stored.value.type !== "key" || stored.value.key !== action.key)
          )
            return yield* new ConfigProviderFile.ConflictError({
              target: file.target,
              message: "This submission ID already saved a different credential",
            })
          return stored
        })
        const completedCredential = retry ? yield* qualifyCredential() : undefined
        if (retry && adoption.phase === "ready") {
          credential =
            adoption.credentialAction !== "keep" && !completedCredential
              ? {
                  status: "failed",
                  credentialID: adoption.credentialID,
                  message: "The completed save's credential was removed",
                }
              : {
                  status:
                    adoption.credentialAction === "create"
                      ? "created"
                      : adoption.credentialAction === "use"
                        ? "used"
                        : "kept",
                  credentialID: adoption.credentialID,
                }
          catalog = (yield* providers.available()).some((provider) => provider.id === input.providerID)
            ? { status: "ready" }
            : { status: "unavailable", message: "The definition is saved; this provider is currently unavailable" }
          return
        }

        const adoptCatalog = Effect.gen(function* () {
          yield* integrations.reload()
          if (discovery) yield* discovery.sync()
          yield* providers.reload()
          yield* models.reload()
          if (!locations) return
          yield* reloadLocations(
            locations,
            config,
            input.target,
            adoption.phase !== "ready" ? input.providerID : undefined,
          )
        })
        const advance = Effect.fnUntraced(function* (next: ConfigProvider.Adoption, initial = false) {
          const written = yield* write(
            initial
              ? { type: "patch", providerID: input.providerID, patch, adoption: next }
              : { type: "adoption", providerID: input.providerID, adoption: next },
          )
          adoption = next
          definition = { status: "saved", target: written.target }
          yield* reload
          yield* adoptCatalog
        })
        if (!retry) yield* advance(adoption, true)
        if (retry) yield* reload.pipe(Effect.andThen(adoptCatalog))

        if (adoption.phase !== "ready") {
          // Synchronously rebuild the original transforms from Config.current before
          // changing a globally active credential. The terminal policy still runs last.
          if ((yield* providers.available()).some((provider) => provider.id === input.providerID))
            return yield* new AdoptionError({
              stage: "catalog",
              message: "The saved adoption has not suspended the provider",
            })
          if (adoption.credentialAction !== "keep") {
            const stored = yield* qualifyCredential()
            if (adoption.credentialAction === "create" && !stored) {
              const key = action.type === "create" ? action.key : undefined
              if (!key?.trim()) {
                credential = {
                  status: "pending",
                  credentialID: adoption.credentialID,
                  message: "Enter the API key to finish this saved definition",
                }
                return
              }
              yield* credentialBoundary(
                credentials.create({
                  id: adoption.credentialID,
                  integrationID,
                  value: Credential.Key.make({ type: "key", key }),
                  label: adoption.credentialLabel,
                  activate: adoption.activate,
                }),
              )
            }
            if (adoption.credentialAction === "use" && !stored)
              return yield* new AdoptionError({
                stage: "credential",
                message: "The selected credential no longer exists",
              })
            if (adoption.activate && adoption.credentialID && adoption.stage === "credential") {
              const selected = yield* integrations.connection.active(integrationID)
              if (selected?.type !== "credential" || selected.id !== adoption.credentialID)
                yield* credentialBoundary(credentials.activate(adoption.credentialID))
            }
            credential = {
              status: adoption.credentialAction === "create" ? "created" : "used",
              credentialID: adoption.credentialID,
            }
          }
          if (adoption.credentialAction === "keep") credential = { status: "kept", credentialID: adoption.credentialID }
          if (adoption.stage === "credential") yield* advance({ ...adoption, phase: "applying", stage: "connection" })
          const connection = yield* integrations.connection.active(integrationID)
          if (adoption.activate && (connection?.type !== "credential" || connection.id !== adoption.credentialID))
            return yield* new AdoptionError({
              stage: "connection",
              message: "The selected connection changed while adopting this definition",
            })
          if (connection) {
            const resolved = yield* integrations.connection
              .resolve(connection)
              .pipe(
                Effect.mapError(
                  () =>
                    new AdoptionError({ stage: "connection", message: "The saved connection could not be resolved" }),
                ),
              )
            if (!resolved)
              return yield* new AdoptionError({
                stage: "connection",
                message: "The saved connection has no usable credential",
              })
          }
          if (!connection && adoption.credentialAction !== "keep")
            return yield* new AdoptionError({
              stage: "connection",
              message: "The saved credential has no active connection",
            })
          if (adoption.stage !== "catalog") yield* advance({ ...adoption, phase: "applying", stage: "catalog" })
          yield* advance({ ...adoption, phase: "ready", stage: "complete" })
        }
        if (simple) credential = { status: "kept", credentialID: adoption.credentialID }
        catalog = (yield* providers.available()).some((provider) => provider.id === input.providerID)
          ? { status: "ready" }
          : {
              status: "unavailable",
              message: "The definition is saved; execution is disabled or denied by provider policy",
            }
      }),
    )
    .pipe(
      Effect.catchTag("ConfigProviderFile.Conflict", (error) =>
        Effect.sync(() => {
          definition = { status: "conflict", target: error.target, message: error.message }
        }),
      ),
      Effect.catchTag("ConfigProviderFile.InvalidDocument", (error) =>
        Effect.sync(() => {
          definition = { status: "failed", target: error.target, message: error.message }
        }),
      ),
      Effect.catchTag("ConfigProviderFile.Write", (error) =>
        Effect.sync(() => {
          definition = { status: "failed", target: error.target, message: error.message }
        }),
      ),
      Effect.catchTag("ConfigProviderFile.Read", (error) =>
        Effect.sync(() => {
          definition = { status: "failed", message: error.message }
        }),
      ),
      Effect.catchTag("ProviderDefinition.Adoption", (error) =>
        Effect.sync(() => {
          if (error.stage === "credential") credential = { ...credential, status: "failed", message: error.message }
          if (error.stage !== "credential")
            catalog = { status: error.stage === "catalog" ? "pending" : "failed", message: error.message }
        }),
      ),
    )
  const readback = yield* get(input.providerID)
  const info = readback.definitions.find(
    (item) => item.target?.scope === input.target.scope && item.target.path === input.target.path,
  )
  return {
    providerID: input.providerID,
    submissionID: input.submissionID,
    definition,
    credential,
    catalog,
    info,
    addedModelIDs,
  } satisfies ProviderDefinition.SaveResult
})

export const remove = Effect.fn("ProviderDefinition.remove")(function* (input: ProviderDefinition.RemoveInput) {
  const config = yield* Config.Service
  if (!config.provider) return yield* new UnavailableError({ message: "Authored provider definitions are unavailable" })
  const integrations = yield* Integration.Service
  const providers = yield* Provider.Service
  const models = yield* Model.Service
  const discovery = Option.getOrUndefined(yield* Effect.serviceOption(ProviderDiscovery.Service))
  const locations = Option.getOrUndefined(yield* Effect.serviceOption(LocationServiceMap.Service))
  let definition: ProviderDefinition.DefinitionResult = { status: "unchanged" }
  yield* config.provider
    .transaction(input.target, (file, write, reload) =>
      Effect.gen(function* () {
        if (file.target.digest !== input.expectedDigest)
          return yield* new ConfigProviderFile.ConflictError({
            target: file.target,
            message: "The configuration changed since it was read",
          })
        if (!file.definitions[input.providerID]) {
          definition = { status: "unchanged", target: file.target }
          return
        }
        const written = yield* write({ type: "remove", providerID: input.providerID })
        definition = { status: "saved", target: written.target }
        yield* reload
        yield* integrations.reload()
        if (discovery) yield* discovery.sync()
        yield* providers.reload()
        yield* models.reload()
        if (locations) yield* reloadLocations(locations, config, input.target)
      }),
    )
    .pipe(
      Effect.catchTag("ConfigProviderFile.Conflict", (error) =>
        Effect.sync(() => {
          definition = { status: "conflict", target: error.target, message: error.message }
        }),
      ),
      Effect.catchTag("ConfigProviderFile.InvalidDocument", (error) =>
        Effect.sync(() => {
          definition = { status: "failed", target: error.target, message: error.message }
        }),
      ),
      Effect.catchTag("ConfigProviderFile.Write", (error) =>
        Effect.sync(() => {
          definition = { status: "failed", target: error.target, message: error.message }
        }),
      ),
      Effect.catchTag("ConfigProviderFile.Read", (error) =>
        Effect.sync(() => {
          definition = { status: "failed", message: error.message }
        }),
      ),
    )
  return {
    providerID: input.providerID,
    definition,
    inherited: (yield* get(input.providerID)).definitions.map((item) => item.source),
  } satisfies ProviderDefinition.RemoveResult
})

function credentialBoundary<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return effect.pipe(
    Effect.catchCauseIf(
      (cause) =>
        !Cause.hasInterrupts(cause) &&
        cause.reasons.length > 0 &&
        cause.reasons.every((reason) => Cause.isDieReason(reason) && reason.defect instanceof SqlError),
      () =>
        Effect.fail(
          new AdoptionError({
            stage: "credential",
            message: "The credential could not be saved; reopen the definition to resume",
          }),
        ),
    ),
  )
}

function reloadLocations(
  locations: LayerMap.LayerMap<Location.Ref, Instance.Services, Instance.Error>,
  current: Config.Interface,
  target: ProviderDefinition.Target,
  pendingProviderID?: Provider.ID,
) {
  return Effect.scoped(
    Effect.gen(function* () {
      for (const ref of yield* RcMap.keys(locations.rcMap)) {
        const cached = yield* locations.contextEffectOption(ref).pipe(
          Effect.mapError(
            () =>
              new AdoptionError({
                stage: "catalog",
                message: "A loaded Location could not refresh its provider definitions",
              }),
          ),
        )
        if (Option.isNone(cached)) continue
        const config = Context.get(cached.value, Config.Service)
        if (config === current || !config.provider) continue
        if (!(yield* config.provider.reload(target))) continue
        const integrations = Context.get(cached.value, Integration.Service)
        const providers = Context.get(cached.value, Provider.Service)
        const models = Context.get(cached.value, Model.Service)
        const discovery = Context.get(cached.value, ProviderDiscovery.Service)
        yield* integrations.reload()
        yield* discovery.sync()
        yield* providers.reload()
        yield* models.reload()
        if (pendingProviderID && (yield* providers.available()).some((provider) => provider.id === pendingProviderID))
          return yield* new AdoptionError({
            stage: "catalog",
            message: "A loaded Location has not suspended the pending provider",
          })
      }
    }),
  )
}
