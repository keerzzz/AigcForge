import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { FileMutation } from "@aigcfroge/core/file-mutation"
import { LocationMutation } from "@aigcfroge/core/location-mutation"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { Location } from "@aigcfroge/core/location"
import { EventV2 } from "@aigcfroge/core/event"
import { SessionV2 } from "@aigcfroge/core/session"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { WorkArtifact } from "../src/session/artifact"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const sessionID = SessionV2.ID.make("ses_artifact_apply")

const published: Array<{ type: string; data: unknown }> = []
const events = Layer.succeed(
  EventV2.Service,
  EventV2.Service.of({
    publish: (definition: any, data: any) =>
      Effect.sync(() => {
        const event = { id: EventV2.ID.create(), type: definition.type, data } as EventV2.Payload<typeof definition>
        published.push({ type: definition.type, data })
        return event
      }),
    subscribe: () => Stream.empty,
    all: () => Stream.empty,
    durable: () => Stream.empty,
    listen: () => Effect.succeed(Effect.void),
    project: () => Effect.void,
    replay: () => Effect.void,
    replayAll: () => Effect.succeed(undefined),
    remove: () => Effect.void,
    claim: () => Effect.void,
  }),
)

function provide(directory: string) {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
  )
  const resolution = LocationMutation.layer.pipe(Layer.provide(FSUtil.defaultLayer), Layer.provide(activeLocation))
  const mutation = FileMutation.layer.pipe(Layer.provide(FSUtil.defaultLayer))
  const artifact = WorkArtifact.layer.pipe(
    Layer.provide(resolution),
    Layer.provide(mutation),
    Layer.provide(events),
    Layer.provide(FSUtil.defaultLayer),
  )
  return Effect.provide(Layer.mergeAll(activeLocation, resolution, mutation, events, artifact))
}

function withTmp<A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) {
  return Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(tmp.path)))
}

describe("WorkArtifact.apply", () => {
  it.live("writes the candidate to the current location atomically and publishes the event", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        published.length = 0
        const service = yield* WorkArtifact.Service
        const result = yield* service.apply({
          sessionID,
          title: "视频分镜脚本",
          relativePath: "分镜脚本.md",
          content: "# 分镜脚本\n\n镜头一",
        })
        expect(result.artifact.status).toBe("available")
        expect(result.artifact.mediaType).toBe("text/markdown")
        expect(yield* Effect.promise(() => fs.readFile(path.join(directory, "分镜脚本.md"), "utf8"))).toBe(
          "# 分镜脚本\n\n镜头一",
        )
        expect(published).toEqual([
          { type: "work.artifact_applied", data: { sessionID, artifactID: result.artifact.id } },
        ])
      }).pipe(provide(directory)),
    ),
  )

  it.live("rejects a relative path escaping the location", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const service = yield* WorkArtifact.Service
        const failure = yield* service
          .apply({ sessionID, title: "x", relativePath: "../escape.md", content: "x" })
          .pipe(Effect.flip)
        expect(failure._tag).toBe("WorkArtifact.PathValidation")
      }).pipe(provide(directory)),
    ),
  )

  it.live("rejects an absolute path", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const service = yield* WorkArtifact.Service
        const failure = yield* service
          .apply({ sessionID, title: "x", relativePath: "/etc/escape.md", content: "x" })
          .pipe(Effect.flip)
        expect(failure._tag).toBe("WorkArtifact.PathValidation")
      }).pipe(provide(directory)),
    ),
  )

  it.live("rejects an existing target when overwrite is not confirmed", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "分镜脚本.md"), "existing"))
        const service = yield* WorkArtifact.Service
        const failure = yield* service
          .apply({ sessionID, title: "x", relativePath: "分镜脚本.md", content: "new" })
          .pipe(Effect.flip)
        expect(failure._tag).toBe("WorkArtifact.Conflict")
      }).pipe(provide(directory)),
    ),
  )

  it.live("overwrites an existing target when overwrite is confirmed", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "分镜脚本.md"), "existing"))
        const service = yield* WorkArtifact.Service
        const result = yield* service.apply({
          sessionID,
          title: "x",
          relativePath: "分镜脚本.md",
          content: "new",
          overwrite: true,
        })
        expect(result.existed).toBe(true)
        expect(yield* Effect.promise(() => fs.readFile(path.join(directory, "分镜脚本.md"), "utf8"))).toBe("new")
      }).pipe(provide(directory)),
    ),
  )
})
