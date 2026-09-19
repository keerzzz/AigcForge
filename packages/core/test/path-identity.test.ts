import { describe, expect } from "bun:test"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { PathIdentity } from "@aigcfroge/core/path-identity"
import { AbsolutePath } from "@aigcfroge/core/schema"
import path from "path"
import { Effect, FileSystem, Layer, Option } from "effect"
import { systemError } from "effect/PlatformError"
import { testEffect } from "./lib/effect"

const refs = new PathIdentity.CompareInput({
  left: new PathIdentity.Ref({ path: AbsolutePath.make("/left") }),
  right: new PathIdentity.Ref({ path: AbsolutePath.make("/right") }),
})

function info(device: number, inode: Option.Option<number>): FileSystem.File.Info {
  return {
    type: "Directory",
    mtime: Option.none(),
    atime: Option.none(),
    birthtime: Option.none(),
    dev: device,
    ino: inode,
    mode: 0,
    nlink: Option.none(),
    uid: Option.none(),
    gid: Option.none(),
    rdev: Option.none(),
    size: FileSystem.Size(0),
    blksize: Option.none(),
    blocks: Option.none(),
  }
}

function mocked(realPath: FSUtil.Interface["realPath"], stat: FSUtil.Interface["stat"]) {
  const filesystem = Layer.unwrap(
    FSUtil.Service.pipe(Effect.map((fs) => Layer.mock(FSUtil.Service)({ ...fs, realPath, stat }))),
  ).pipe(Layer.provide(FSUtil.defaultLayer))
  return PathIdentity.locationLayer.pipe(Layer.provide(filesystem))
}

function failure(method: string) {
  return Effect.fail(systemError({ _tag: "NotFound", module: "FileSystem", method }))
}

describe("PathIdentity", () => {
  let statCalls = 0
  const realPathIt = testEffect(
    mocked(
      () => Effect.succeed("/canonical"),
      () =>
        Effect.sync(() => {
          statCalls++
          return info(1, Option.some(1))
        }),
    ),
  )

  realPathIt.effect("proves equality by realpath before consulting stat", () =>
    Effect.gen(function* () {
      statCalls = 0
      const result = yield* (yield* PathIdentity.Service).compare(refs)
      expect(result).toEqual({
        status: "same",
        refs,
        evidence: { method: "realpath", path: AbsolutePath.make("/canonical") },
      })
      expect(statCalls).toBe(0)
    }),
  )

  const inodeIt = testEffect(
    mocked(
      (value) => Effect.succeed(`${value}-canonical`),
      () => Effect.succeed(info(9, Option.some(27))),
    ),
  )

  inodeIt.effect("falls back to matching device and inode when realpaths differ", () =>
    Effect.gen(function* () {
      const result = yield* (yield* PathIdentity.Service).compare(refs)
      expect(result).toEqual({
        status: "same",
        refs,
        evidence: { method: "device-inode", device: 9, inode: 27 },
      })
    }),
  )

  const failedRealPathIt = testEffect(
    mocked(
      () => failure("realPath"),
      () => Effect.succeed(info(4, Option.some(12))),
    ),
  )

  failedRealPathIt.effect("can still prove equality by device and inode when realpath is unavailable", () =>
    Effect.gen(function* () {
      const result = yield* (yield* PathIdentity.Service).compare(refs)
      expect(result).toMatchObject({
        status: "same",
        evidence: { method: "device-inode", device: 4, inode: 12 },
      })
    }),
  )

  const unavailableIt = testEffect(
    mocked(
      (value) => Effect.succeed(value),
      () => failure("stat"),
    ),
  )

  unavailableIt.effect("returns typed unknown when stat is unavailable", () =>
    Effect.gen(function* () {
      const result = yield* (yield* PathIdentity.Service).compare(refs)
      expect(result).toEqual({ status: "unknown", reason: "stat-unavailable" })
    }),
  )

  const missingInodeIt = testEffect(
    mocked(
      (value) => Effect.succeed(value),
      () => Effect.succeed(info(3, Option.none())),
    ),
  )

  missingInodeIt.effect("returns typed unknown when either inode is missing", () =>
    Effect.gen(function* () {
      const result = yield* (yield* PathIdentity.Service).compare(refs)
      expect(result).toEqual({ status: "unknown", reason: "inode-unavailable" })
    }),
  )

  const mismatchIt = testEffect(
    mocked(
      (value) => Effect.succeed(value),
      (value) => Effect.succeed(info(value === "/left" ? 1 : 2, Option.some(8))),
    ),
  )

  mismatchIt.effect("returns unknown rather than different when proof keys do not match", () =>
    Effect.gen(function* () {
      const result = yield* (yield* PathIdentity.Service).compare(refs)
      expect(result).toEqual({ status: "unknown", reason: "no-local-proof" })
      expect("different" in result).toBe(false)
    }),
  )

  const liveIt = testEffect(PathIdentity.locationLayer.pipe(Layer.provideMerge(FSUtil.defaultLayer)))

  liveIt.live("proves a symlink spelling through the real filesystem", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "aigcfroge-path-identity-" })
      const target = path.join(root, "target")
      const alias = path.join(root, "alias")
      yield* fs.makeDirectory(target)
      yield* fs.symlink(target, alias)

      const result = yield* (yield* PathIdentity.Service).compare(
        new PathIdentity.CompareInput({
          left: new PathIdentity.Ref({ path: AbsolutePath.make(target) }),
          right: new PathIdentity.Ref({ path: AbsolutePath.make(alias) }),
        }),
      )
      expect(result).toEqual({
        status: "same",
        refs: {
          left: { path: AbsolutePath.make(target) },
          right: { path: AbsolutePath.make(alias) },
        },
        evidence: { method: "realpath", path: AbsolutePath.make(target) },
      })
    }),
  )
})
