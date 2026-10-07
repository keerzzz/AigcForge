export * as WorkReviewFixture from "./work-review"

import { Effect, Layer } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { FileMutation } from "@aigcfroge/core/file-mutation"
import { Location } from "@aigcfroge/core/location"
import { LocationMutation } from "@aigcfroge/core/location-mutation"
import { ProjectV2 } from "@aigcfroge/core/project"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { WorkArtifact } from "@aigcfroge/core/session/artifact"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionStore } from "@aigcfroge/core/session/store"
import { WorkReviewService } from "@aigcfroge/core/session/work-review-service"
import { location } from "./location"

export function layer(directory: string, filename: string) {
  const database = Database.layerFromPath(filename)
  const shared = Layer.mergeAll(
    database,
    EventV2.layer.pipe(Layer.provide(database)),
    SessionStore.layer.pipe(Layer.provide(database)),
    SessionExecution.noopLayer,
    FSUtil.defaultLayer,
    Layer.succeed(Location.Service, location(Location.Ref.make({ directory: AbsolutePath.make(directory) }))),
    Layer.mock(ProjectV2.Service, {
      resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
      directories: () => Effect.succeed([]),
      commit: () => Effect.void,
    }),
  )
  const mutation = Layer.mergeAll(LocationMutation.layer, FileMutation.layer).pipe(Layer.provide(shared))
  const artifacts = WorkArtifact.layer.pipe(Layer.provide(shared), Layer.provide(mutation))
  return Layer.mergeAll(
    shared,
    artifacts,
    SessionV2.layer.pipe(Layer.provide(shared)),
    SessionProjector.layer.pipe(Layer.provide(shared)),
    WorkReviewService.layer.pipe(Layer.provide(shared), Layer.provide(artifacts)),
  ).pipe(Layer.fresh)
}
