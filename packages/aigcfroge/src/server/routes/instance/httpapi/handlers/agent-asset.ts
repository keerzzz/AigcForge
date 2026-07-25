export * as AgentAssetHandlers from "./agent-asset"

import { InstanceState } from "@/effect/instance-state"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { AgentAssetService } from "@aigcfroge/core/agent-asset-service"
import { AgentAsset } from "@aigcfroge/core/agent-asset"
import { AgentAsset as SchemaAgentAsset } from "@aigcfroge/schema/agent-asset"
import { Location } from "@aigcfroge/core/location"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Effect, Layer, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ConflictError, InvalidRequestError } from "../errors"
import { RuntimeFlags } from "@/effect/runtime-flags"

function toApplyError(err: unknown): Effect.Effect<never, ConflictError | InvalidRequestError, never> {
  let error: ConflictError | InvalidRequestError
  if (err instanceof AgentAssetService.InvalidCandidateError) {
    error = new InvalidRequestError({ message: err.reason })
  } else if (err instanceof AgentAssetService.StaleRevisionError) {
    error = new ConflictError({ message: `Stale revision: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof AgentAssetService.OverwriteRequiredError) {
    error = new ConflictError({ message: `Overwrite required: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof AgentAssetService.WriteFailedError) {
    error = new InvalidRequestError({ message: err.reason })
  } else if (err instanceof AgentAssetService.ConcurrentModificationError) {
    error = new ConflictError({ message: `Concurrent modification: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof AgentAssetService.ReadbackMismatchError) {
    error = new ConflictError({ message: `Readback mismatch at ${err.relativePath} — possible name conflict with another asset`, resource: err.relativePath })
  } else if (err instanceof AgentAssetService.RollbackFailedError) {
    error = new InvalidRequestError({ message: err.reason })
  } else {
    error = new InvalidRequestError({ message: String(err) })
  }
  return Effect.fail(error)
}

function toDeleteError(err: unknown): Effect.Effect<never, ConflictError | InvalidRequestError, never> {
  let error: ConflictError | InvalidRequestError
  if (err instanceof AgentAssetService.NotFoundError) {
    error = new InvalidRequestError({ message: `Not found: ${err.relativePath}` })
  } else if (err instanceof AgentAssetService.InvalidCandidateError) {
    error = new InvalidRequestError({ message: err.reason })
  } else if (err instanceof AgentAssetService.StaleRevisionError) {
    error = new ConflictError({ message: `Stale revision: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof AgentAssetService.WriteFailedError) {
    error = new InvalidRequestError({ message: err.reason })
  } else if (err instanceof AgentAssetService.ConcurrentModificationError) {
    error = new ConflictError({ message: `Concurrent modification: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof AgentAssetService.ReadbackMismatchError) {
    error = new ConflictError({ message: `Readback mismatch at ${err.relativePath} — possible name conflict with another asset`, resource: err.relativePath })
  } else if (err instanceof AgentAssetService.RollbackFailedError) {
    error = new InvalidRequestError({ message: err.reason })
  } else {
    error = new InvalidRequestError({ message: String(err) })
  }
  return Effect.fail(error)
}

export const agentAssetHandlers = HttpApiBuilder.group(InstanceHttpApi, "agent-asset", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap

    const list = Effect.fn("AgentAssetHttpApi.list")(function* (ctx: { query: { search?: string } }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const registry = yield* AgentAsset.Service.pipe(Effect.provide(layer), Effect.orDie)
      const all = yield* registry.list()
      const filtered = ctx.query.search
        ? all.filter((a) => a.name.toLowerCase().includes(ctx.query.search!.toLowerCase()) || a.description.toLowerCase().includes(ctx.query.search!.toLowerCase()))
        : all
      const invalid = yield* registry.listInvalid()
      return {
        assets: filtered.map((a) =>
          Schema.decodeUnknownSync(SchemaAgentAsset.Summary)({
            kind: "agent",
            name: a.name,
            description: a.description,
            relativePath: a.relativePath,
            revision: a.revision,
          }),
        ),
        invalid: invalid.map((e) =>
          Schema.decodeUnknownSync(SchemaAgentAsset.InvalidEntry)({
            relativePath: e.relativePath,
            errorTag: e.errorTag,
          }),
        ),
      }
    })

    const content = Effect.fn("AgentAssetHttpApi.content")(function* (ctx: { query: { path: string } }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const registry = yield* AgentAsset.Service.pipe(Effect.provide(layer), Effect.orDie)
      const info = yield* registry.getByPath(ctx.query.path).pipe(
        Effect.catch(() => Effect.fail(new InvalidRequestError({ message: `Not found: ${ctx.query.path}` }))),
      )
      return Schema.decodeUnknownSync(SchemaAgentAsset.Info)({
        kind: info.kind,
        name: info.name,
        description: info.description,
        relativePath: info.relativePath,
        revision: info.revision,
        config: info.config,
        source: info.source,
      })
    })

    const apply = Effect.fn("AgentAssetHttpApi.apply")(function* (ctx: {
      payload: { candidate: SchemaAgentAsset.Candidate; baseRevision?: string; overwrite: boolean }
    }) {
      const flags = yield* RuntimeFlags.Service
      if (!flags.experimentalChatAsset) return yield* Effect.fail(new InvalidRequestError({ message: "Agent asset creation is not enabled. Set AIGCFROGE_EXPERIMENTAL_CHAT_ASSET=true to enable." }))
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const service = yield* AgentAssetService.Service.pipe(Effect.provide(layer), Effect.orDie)
      const info = yield* service.apply({
        candidate: ctx.payload.candidate,
        baseRevision: ctx.payload.baseRevision ?? null,
        overwrite: ctx.payload.overwrite,
      }).pipe(Effect.catch(toApplyError))
      return Schema.decodeUnknownSync(SchemaAgentAsset.Info)({
        kind: info.kind,
        name: info.name,
        description: info.description,
        relativePath: info.relativePath,
        revision: info.revision,
        config: info.config,
        source: info.source,
      })
    })

    const deleteAsset = Effect.fn("AgentAssetHttpApi.delete")(function* (ctx: {
      payload: { relativePath: string; baseRevision?: string }
    }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const flags = yield* RuntimeFlags.Service
      if (!flags.experimentalChatAsset) return yield* Effect.fail(new InvalidRequestError({ message: "Agent asset deletion is not enabled." }))
      const service = yield* AgentAssetService.Service.pipe(Effect.provide(layer), Effect.orDie)
      yield* service.delete({
        relativePath: ctx.payload.relativePath,
        baseRevision: ctx.payload.baseRevision ?? null,
      }).pipe(Effect.catch(toDeleteError))
    })

    return handlers.handle("list", list).handle("content", content).handle("apply", apply).handle("delete", deleteAsset)
  }),
).pipe(Layer.provide(LocationServiceMap.layer))
