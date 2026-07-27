export * as WorkflowAssetHandlers from "./workflow-asset"

import path from "path"
import fs from "fs/promises"
import { Effect, Layer, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { WorkflowAsset } from "@aigcfroge/core/workflow-asset"
import { WorkflowAssetPath } from "@aigcfroge/core/workflow-asset/path"
import { ProposeWorkflowAssetTool } from "@aigcfroge/core/tool/propose-workflow-asset"
import { WorkflowAsset as SchemaWorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { Location } from "@aigcfroge/core/location"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Hash } from "@aigcfroge/core/util/hash"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ConflictError, InvalidRequestError } from "../errors"
import { WORKFLOWS_DIR } from "@aigcfroge/core/constants"

export const workflowAssetHandlers = HttpApiBuilder.group(InstanceHttpApi, "workflow-asset", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap
    const flags = yield* RuntimeFlags.Service

    const list = Effect.fn("WorkflowAssetHttpApi.list")(function* (ctx: { query: { search?: string } }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const registry = yield* WorkflowAsset.Service.pipe(Effect.provide(layer), Effect.orDie)
      const all = yield* registry.list()
      const filtered = ctx.query.search
        ? all.filter((a) => a.name.toLowerCase().includes(ctx.query.search!.toLowerCase()) || a.description.toLowerCase().includes(ctx.query.search!.toLowerCase()))
        : all
      const invalid = yield* registry.listInvalid()
      return {
        assets: filtered.map((a) =>
          Schema.decodeUnknownSync(SchemaWorkflowAsset.Summary)({
            kind: "workflow", name: a.name, description: a.description,
            relativePath: a.relativePath, revision: a.revision,
          }),
        ),
        invalid: invalid.map((e) =>
          Schema.decodeUnknownSync(SchemaWorkflowAsset.InvalidEntry)({
            relativePath: e.relativePath, errorTag: e.errorTag,
          }),
        ),
      }
    })

    const content = Effect.fn("WorkflowAssetHttpApi.content")(function* (ctx: { query: { path: string } }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const registry = yield* WorkflowAsset.Service.pipe(Effect.provide(layer), Effect.orDie)
      const info = yield* registry.getByPath(ctx.query.path).pipe(
        Effect.catch(() => Effect.fail(new InvalidRequestError({ message: `Not found: ${ctx.query.path}` }))),
      )
      return Schema.decodeUnknownSync(SchemaWorkflowAsset.Info)({
        kind: info.kind, name: info.name, description: info.description,
        relativePath: info.relativePath, revision: info.revision,
        version: info.version, triggers: info.triggers, steps: info.steps,
      })
    })

    const apply = Effect.fn("WorkflowAssetHttpApi.apply")(function* (ctx: {
      payload: { candidate: { name: string; description: string; content: string }; baseRevision?: string; overwrite: boolean }
    }) {
      if (!flags.experimentalChatAsset) {
        return yield* Effect.fail(new InvalidRequestError({ message: "Workflow asset creation is not enabled" }))
      }
      // Validate content against the Frontmatter contract BEFORE writing — a write that
      // the registry would reject on reload must fail here, not after persisting.
      const invalidContent = ProposeWorkflowAssetTool.validateContent(ctx.payload.candidate.content)
      if (invalidContent) {
        return yield* Effect.fail(new InvalidRequestError({ message: invalidContent }))
      }
      const ctx2 = yield* InstanceState.context
      const ref = Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) })
      const layer = locations.get(ref)
      const registry = yield* WorkflowAsset.Service.pipe(Effect.provide(layer), Effect.orDie)

      let relativePath: string
      try { relativePath = WorkflowAssetPath.nameToRelativePath(ctx.payload.candidate.name) }
      catch { return yield* Effect.fail(new InvalidRequestError({ message: `Invalid workflow name: ${ctx.payload.candidate.name}` })) }

      const targetPath = path.resolve(ctx2.directory, relativePath)
      const fileExists = yield* Effect.tryPromise(() => fs.stat(targetPath).then(() => true)).pipe(
        Effect.catch(() => Effect.succeed(false)),
      )
      if (fileExists && !ctx.payload.overwrite) {
        return yield* Effect.fail(new ConflictError({ message: `Already exists at "${relativePath}". Set overwrite=true.`, resource: relativePath }))
      }
      if (fileExists && ctx.payload.baseRevision) {
        const currentBytes = yield* Effect.tryPromise(() => fs.readFile(targetPath)).pipe(
          Effect.catch(() => Effect.succeed(undefined)),
        )
        if (currentBytes) {
          const currentRevision = Hash.sha256(Buffer.from(currentBytes))
          if (currentRevision !== ctx.payload.baseRevision) {
            return yield* Effect.fail(new ConflictError({ message: `Stale revision for "${relativePath}". Refresh and retry.`, resource: relativePath }))
          }
        }
      }

      yield* Effect.tryPromise(() => fs.mkdir(path.resolve(ctx2.directory, WORKFLOWS_DIR), { recursive: true })).pipe(Effect.ignore)
      yield* Effect.tryPromise(() => fs.writeFile(targetPath, ctx.payload.candidate.content)).pipe(
        Effect.catch(() => Effect.fail(new InvalidRequestError({ message: `Failed to write at "${relativePath}".` }))),
      )

      yield* registry.reload().pipe(Effect.provide(layer), Effect.catch(() => Effect.void))

      // Registry uses path.relative(ownerRoot, file) as key (= short filename), but nameToRelativePath returns WORKFLOWS_DIR-prefixed path.
      const registryPath = path.basename(relativePath)
      const info = yield* registry.getByPath(registryPath).pipe(
        Effect.provide(layer),
        Effect.catch(() => Effect.fail(new InvalidRequestError({ message: `Failed to read back "${relativePath}".` }))),
      )
      return Schema.decodeUnknownSync(SchemaWorkflowAsset.Info)({
        kind: info.kind, name: info.name, description: info.description,
        relativePath: info.relativePath, revision: info.revision,
        version: info.version, triggers: info.triggers, steps: info.steps,
      })
    })

    const deleteAsset = Effect.fn("WorkflowAssetHttpApi.delete")(function* (ctx: {
      payload: { relativePath: string; baseRevision?: string }
    }) {
      const ctx2 = yield* InstanceState.context
      const ref = Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) })
      const layer = locations.get(ref)
      const registry = yield* WorkflowAsset.Service.pipe(Effect.provide(layer), Effect.orDie)

      // Payload path is the registry key (relative to the workflows root); validate
      // segments before resolving so nested keys work and traversal is rejected.
      let relativePath: string
      try { relativePath = WorkflowAssetPath.validateRelativePath(ctx.payload.relativePath) }
      catch { return yield* Effect.fail(new InvalidRequestError({ message: `Invalid path: ${ctx.payload.relativePath}` })) }

      const info = yield* registry.getByPath(relativePath).pipe(
        Effect.provide(layer),
        Effect.catch(() => Effect.fail(new InvalidRequestError({ message: `Not found: ${relativePath}` }))),
      )

      if (ctx.payload.baseRevision && info.revision !== ctx.payload.baseRevision) {
        return yield* Effect.fail(new ConflictError({ message: `Stale revision for "${relativePath}". Refresh and retry.`, resource: relativePath }))
      }

      yield* Effect.tryPromise(() => fs.rm(path.resolve(ctx2.directory, WORKFLOWS_DIR, relativePath))).pipe(
        Effect.catch(() => Effect.fail(new InvalidRequestError({ message: `Failed to delete at "${relativePath}".` }))),
      )
      return yield* registry.reload().pipe(Effect.provide(layer), Effect.catch(() => Effect.void))
    })

    return handlers.handle("list", list).handle("content", content).handle("apply", apply).handle("delete", deleteAsset)
  }),
).pipe(Layer.provide(LocationServiceMap.layer))
