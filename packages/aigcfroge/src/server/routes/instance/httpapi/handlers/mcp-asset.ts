export * as MCPAssetHandlers from "./mcp-asset"

import { InstanceState } from "@/effect/instance-state"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { MCPAssetService } from "@aigcfroge/core/mcp-asset-service"
import { MCPAsset } from "@aigcfroge/core/mcp-asset"
import { MCPAsset as SchemaMCPAsset } from "@aigcfroge/schema/mcp-asset"
import { Location } from "@aigcfroge/core/location"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Effect, Layer, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ConflictError, InvalidRequestError } from "../errors"
import { RuntimeFlags } from "@/effect/runtime-flags"

function toApplyError(err: unknown): Effect.Effect<never, ConflictError | InvalidRequestError> {
  let error: ConflictError | InvalidRequestError
  if (err instanceof MCPAssetService.InvalidCandidateError) {
    error = new InvalidRequestError({ message: err.reason })
  } else if (err instanceof MCPAssetService.StaleRevisionError) {
    error = new ConflictError({ message: `Stale revision: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof MCPAssetService.OverwriteRequiredError) {
    error = new ConflictError({ message: `Overwrite required: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof MCPAssetService.WriteFailedError) {
    error = new InvalidRequestError({ message: err.reason })
  } else if (err instanceof MCPAssetService.ConcurrentModificationError) {
    error = new ConflictError({ message: `Concurrent modification: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof MCPAssetService.ReadbackMismatchError) {
    error = new ConflictError({ message: `Readback mismatch at ${err.relativePath} — possible name conflict with another asset`, resource: err.relativePath })
  } else if (err instanceof MCPAssetService.RollbackFailedError) {
    error = new InvalidRequestError({ message: err.reason })
  } else {
    error = new InvalidRequestError({ message: String(err) })
  }
  return Effect.fail(error)
}

function toDeleteError(err: unknown): Effect.Effect<never, ConflictError | InvalidRequestError> {
  let error: ConflictError | InvalidRequestError
  if (err instanceof MCPAssetService.NotFoundError) {
    error = new InvalidRequestError({ message: `Not found: ${err.relativePath}` })
  } else if (err instanceof MCPAssetService.InvalidCandidateError) {
    error = new InvalidRequestError({ message: err.reason })
  } else if (err instanceof MCPAssetService.StaleRevisionError) {
    error = new ConflictError({ message: `Stale revision: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof MCPAssetService.WriteFailedError) {
    error = new InvalidRequestError({ message: err.reason })
  } else if (err instanceof MCPAssetService.ConcurrentModificationError) {
    error = new ConflictError({ message: `Concurrent modification: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof MCPAssetService.ReadbackMismatchError) {
    error = new ConflictError({ message: `Readback mismatch at ${err.relativePath} — possible name conflict with another asset`, resource: err.relativePath })
  } else if (err instanceof MCPAssetService.RollbackFailedError) {
    error = new InvalidRequestError({ message: err.reason })
  } else {
    error = new InvalidRequestError({ message: String(err) })
  }
  return Effect.fail(error)
}

export const mcpAssetHandlers = HttpApiBuilder.group(InstanceHttpApi, "mcp-asset", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap
    const flags = yield* RuntimeFlags.Service

    const list = Effect.fn("MCPAssetHttpApi.list")(function* (ctx: { query: { search?: string } }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const registry = yield* MCPAsset.Service.pipe(Effect.provide(layer), Effect.orDie)
      const all = yield* registry.list()
      const filtered = ctx.query.search
        ? all.filter((a) => a.name.toLowerCase().includes(ctx.query.search!.toLowerCase()) || a.description.toLowerCase().includes(ctx.query.search!.toLowerCase()))
        : all
      const invalid = yield* registry.listInvalid()
      return {
        assets: filtered.map((a) =>
          Schema.decodeUnknownSync(SchemaMCPAsset.Summary)({
            kind: "mcp",
            name: a.name,
            description: a.description,
            relativePath: a.relativePath,
            revision: a.revision,
          }),
        ),
        invalid: invalid.map((e) =>
          Schema.decodeUnknownSync(SchemaMCPAsset.InvalidEntry)({
            relativePath: e.relativePath,
            errorTag: e.errorTag,
          }),
        ),
      }
    })

    const content = Effect.fn("MCPAssetHttpApi.content")(function* (ctx: { query: { path: string } }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const registry = yield* MCPAsset.Service.pipe(Effect.provide(layer), Effect.orDie)
      const info = yield* registry.getByPath(ctx.query.path).pipe(
        Effect.catch(() => Effect.fail(new InvalidRequestError({ message: `Not found: ${ctx.query.path}` }))),
      )
      return Schema.decodeUnknownSync(SchemaMCPAsset.Info)({
        kind: info.kind,
        name: info.name,
        description: info.description,
        relativePath: info.relativePath,
        revision: info.revision,
        command: info.command,
        args: info.args,
        env: info.env,
        configJson: info.configJson,
      })
    })

    const apply = Effect.fn("MCPAssetHttpApi.apply")(function* (ctx: {
      payload: { candidate: SchemaMCPAsset.Candidate; baseRevision?: string; overwrite: boolean }
    }) {
      const ctx2 = yield* InstanceState.context
      if (!flags.experimentalChatAsset) return yield* Effect.fail(new InvalidRequestError({ message: "MCP asset creation is not enabled. Set AIGCFROGE_EXPERIMENTAL_CHAT_ASSET=true to enable." }))
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const service = yield* MCPAssetService.Service.pipe(Effect.provide(layer), Effect.orDie)
      const info = yield* service.apply({
        candidate: ctx.payload.candidate,
        baseRevision: ctx.payload.baseRevision ?? null,
        overwrite: ctx.payload.overwrite,
      }).pipe(Effect.catch(toApplyError))
      return Schema.decodeUnknownSync(SchemaMCPAsset.Info)({
        kind: info.kind,
        name: info.name,
        description: info.description,
        relativePath: info.relativePath,
        revision: info.revision,
        command: info.command,
        args: info.args,
        env: info.env,
        configJson: info.configJson,
      })
    })

    const deleteAsset = Effect.fn("MCPAssetHttpApi.delete")(function* (ctx: {
      payload: { relativePath: string; baseRevision?: string }
    }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const service = yield* MCPAssetService.Service.pipe(Effect.provide(layer), Effect.orDie)
      yield* service.delete({
        relativePath: ctx.payload.relativePath,
        baseRevision: ctx.payload.baseRevision ?? null,
      }).pipe(Effect.catch(toDeleteError))
    })

    return handlers.handle("list", list).handle("content", content).handle("apply", apply).handle("delete", deleteAsset)
  }),
).pipe(Layer.provide(LocationServiceMap.layer))
