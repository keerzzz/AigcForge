import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { FileSystem } from "@aigcfroge/core/filesystem"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { Location } from "@aigcfroge/core/location"
import { Ripgrep } from "@aigcfroge/core/ripgrep"
import { AbsolutePath, RelativePath } from "@aigcfroge/core/schema"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const provide = (directory: string) =>
  Effect.provide(
    FileSystem.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          FSUtil.defaultLayer,
          Ripgrep.defaultLayer,
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
        ),
      ),
    ),
  )

const withTmp = <A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(tmp.path)))

const missingDirectory = "/aigcfroge-test-missing-location-9f3c2a"

describe("FileSystem", () => {
  it.live("reads text and binary files", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "text.txt"), "hello"))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "data.bin"), Buffer.from([0, 1, 2])))
        const service = yield* FileSystem.Service
        const text = yield* service.read({ path: RelativePath.make("text.txt") })
        const binary = yield* service.read({ path: RelativePath.make("data.bin") })
        expect(new TextDecoder().decode(text.content)).toBe("hello")
        expect(text.mime).toBe("text/plain")
        expect(binary.content).toEqual(new Uint8Array([0, 1, 2]))
      }).pipe(provide(directory)),
    ),
  )

  it.live("lists direct children", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.mkdir(path.join(directory, "src")))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "README.md"), "# Test"))
        const entries = yield* (yield* FileSystem.Service).list()
        expect(entries.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
          { path: RelativePath.make("src" + path.sep), type: "directory" },
          { path: RelativePath.make("README.md"), type: "file" },
        ])
      }).pipe(provide(directory)),
    ),
  )

  it.live("rejects lexical escapes", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const result = yield* (yield* FileSystem.Service)
          .read({ path: RelativePath.make("../outside.txt") })
          .pipe(Effect.exit)
        expect(Exit.isFailure(result)).toBe(true)
      }).pipe(provide(directory)),
    ),
  )

  it.live("builds without dying when the location directory does not exist on disk", () =>
    Effect.gen(function* () {
      // Regression: a stale remembered location (directory deleted, renamed,
      // or migrated to a new machine) used to die at layer construction
      // (fff native search, ripgrep spawn, and an unguarded realPath all
      // assumed the directory exists), which LocationServiceMap's Layer.orDie
      // then escalated into an opaque empty 500/503 for every HTTP endpoint
      // sharing that location — not just filesystem browsing. Construction
      // must now succeed regardless of what any individual method call does
      // once invoked (an actual read/list against a missing path is a
      // separate, pre-existing "path resolution failed" defect, same as an
      // escaped path or a non-file target — unrelated to this fix).
      const buildExit = yield* Effect.exit(FileSystem.Service)
      expect(Exit.isSuccess(buildExit)).toBe(true)
    }).pipe(provide(missingDirectory)),
  )
})
