export * as WorkArtifact from "./artifact"

import { Context, DateTime, Effect, Layer, Schema } from "effect"
import path from "path"
import { EventV2 } from "../event"
import { FileMutation } from "../file-mutation"
import { LocationMutation } from "../location-mutation"
import { FSUtil } from "../fs-util"
import { Identifier } from "../id/id"
import { SessionSchema } from "./schema"

/**
 * M1 Artifact 契约（D2 定案：内存态事件，不落库，对齐 ADR-15 §5）。
 * 落盘成功后发 `work.artifact_applied` 事件，App 侧监听更新 Artifact Tab。
 * 跨刷新丢失可接受（M1），M2 存为资产时转 Chat 资产持久化。
 */
export const ArtifactRecord = Schema.Struct({
  id: Schema.String.annotate({ description: "稳定 Artifact ID" }),
  sessionID: SessionSchema.ID,
  kind: Schema.Literal("document").annotate({ description: "M1 固定" }),
  title: Schema.String,
  mediaType: Schema.Literal("text/markdown"),
  relativePath: Schema.String.annotate({ description: "相对 Session Location，规范化后不得越界" }),
  status: Schema.Literals(["available", "missing"]),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}).annotate({ identifier: "WorkArtifact.ArtifactRecord" })
export type ArtifactRecord = typeof ArtifactRecord.Type

export const Event = {
  ArtifactApplied: EventV2.define({
    type: "work.artifact_applied",
    schema: {
      sessionID: SessionSchema.ID,
      artifactID: Schema.String,
    },
  }),
}

export class PathValidationError extends Schema.TaggedErrorClass<PathValidationError>()(
  "WorkArtifact.PathValidation",
  {
    relativePath: Schema.String,
    reason: Schema.String,
  },
) {}

export class ConflictError extends Schema.TaggedErrorClass<ConflictError>()("WorkArtifact.Conflict", {
  relativePath: Schema.String,
}) {}

export interface ApplyInput {
  readonly sessionID: SessionSchema.ID
  readonly title: string
  readonly relativePath: string
  readonly content: string
  readonly overwrite?: boolean
}

export interface ApplyResult {
  readonly artifact: ArtifactRecord
  readonly existed: boolean
}

export interface Interface {
  readonly apply: (input: ApplyInput) => Effect.Effect<ApplyResult, PathValidationError | ConflictError | FSUtil.Error>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/WorkArtifact") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const locationMutation = yield* LocationMutation.Service
    const fileMutation = yield* FileMutation.Service
    const fs = yield* FSUtil.Service
    const events = yield* EventV2.Service

    const validate = Effect.fnUntraced(function* (relativePath: string) {
      if (relativePath.trim() === "") {
        return yield* new PathValidationError({ relativePath, reason: "Path must not be empty" })
      }
      if (path.isAbsolute(relativePath)) {
        return yield* new PathValidationError({ relativePath, reason: "Path must be relative to the location" })
      }
      if (relativePath.split(/[\\/]/).includes("..")) {
        return yield* new PathValidationError({ relativePath, reason: "Path must not escape the location" })
      }
      return relativePath
    })

    const apply = Effect.fn("WorkArtifact.apply")(function* (input: ApplyInput) {
      yield* validate(input.relativePath)
      // LocationMutation.resolve 做真实路径规范化 + 符号链接越界拦截。
      const target = yield* locationMutation.resolve({ path: input.relativePath }).pipe(
        Effect.mapError(
          (error) => new PathValidationError({ relativePath: input.relativePath, reason: String(error) }),
        ),
      )
      const existed = yield* fs.exists(target.canonical)
      if (existed && !input.overwrite) {
        return yield* new ConflictError({ relativePath: input.relativePath })
      }
      yield* fileMutation.writeAtomic({ target, content: input.content })
      const now = yield* DateTime.nowAsDate
      const artifactID = Identifier.create("art", "ascending")
      const artifact: ArtifactRecord = {
        id: artifactID,
        sessionID: input.sessionID,
        kind: "document",
        title: input.title,
        mediaType: "text/markdown",
        relativePath: target.resource,
        status: "available",
        createdAt: now.getTime(),
        updatedAt: now.getTime(),
      }
      yield* events.publish(Event.ArtifactApplied, { sessionID: input.sessionID, artifactID })
      return { artifact, existed }
    })

    return Service.of({ apply })
  }),
)

export const locationLayer = layer.pipe(
  Layer.provide(LocationMutation.locationLayer),
  Layer.provide(FileMutation.locationLayer),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(EventV2.defaultLayer),
)
