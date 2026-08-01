export * as WorkArtifactHandlers from "./work-artifact"

import { InstanceState } from "@/effect/instance-state"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { WorkArtifact } from "@aigcfroge/core/session/artifact"
import { SessionV2 } from "@aigcfroge/core/session"
import { Location } from "@aigcfroge/core/location"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Effect, Layer, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ConflictError, InvalidRequestError } from "../errors"

function toApplyError(err: unknown): Effect.Effect<never, ConflictError | InvalidRequestError> {
  let error: ConflictError | InvalidRequestError
  if (err instanceof WorkArtifact.ConflictError) {
    error = new ConflictError({ message: `Overwrite required: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof WorkArtifact.PathValidationError) {
    error = new InvalidRequestError({ message: err.reason })
  } else {
    error = new InvalidRequestError({ message: String(err) })
  }
  return Effect.fail(error)
}

export const workArtifactHandlers = HttpApiBuilder.group(InstanceHttpApi, "work-artifact", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap

    const apply = Effect.fn("WorkArtifactHttpApi.apply")(function* (ctx: {
      params: { sessionID: string }
      payload: { title: string; relativePath: string; content: string; overwrite: boolean }
    }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const service = yield* WorkArtifact.Service.pipe(Effect.provide(layer), Effect.orDie)
      const result = yield* service
        .apply({
          sessionID: SessionV2.ID.make(ctx.params.sessionID),
          title: ctx.payload.title,
          relativePath: ctx.payload.relativePath,
          content: ctx.payload.content,
          overwrite: ctx.payload.overwrite,
        })
        .pipe(Effect.catch(toApplyError))
      return Schema.decodeUnknownSync(WorkArtifact.ArtifactRecord)(result.artifact)
    })

    return handlers.handle("apply", apply)
  }),
).pipe(Layer.provide(LocationServiceMap.layer))
