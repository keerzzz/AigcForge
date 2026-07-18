import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import { FileMutation } from "@aigcfroge/core/file-mutation"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { Location } from "@aigcfroge/core/location"
import { LocationMutation } from "@aigcfroge/core/location-mutation"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

function provide(directory: string, filesystem = FSUtil.defaultLayer) {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
  )
  const resolution = LocationMutation.layer.pipe(Layer.provide(filesystem), Layer.provide(activeLocation))
  const mutation = FileMutation.layer.pipe(Layer.provide(filesystem))
  return Layer.mergeAll(resolution, mutation)
}

function withTmp<A, E>(f: (directory: string) => Effect.Effect<A, E>) {
  return Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(tmp.path)))
}

function run<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(FSUtil.defaultLayer)))
}

describe("FileMutation.writeAtomic", () => {
  it.live("creates a new file atomically", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const target = yield* (yield* LocationMutation.Service).resolve({ path: "new.md" })
        const result = yield* (yield* FileMutation.Service).writeAtomic({ target, content: "hello" })

        expect(result.operation).toBe("atomic_write")
        expect(result.existed).toBe(false)
        expect(result.priorBytes).toBeNull()

        const content = yield* Effect.promise(() => fs.readFile(target.canonical, "utf8"))
        expect(content).toBe("hello")
      }).pipe(Effect.provide(provide(directory))),
    ),
  )

  it.live("overwrites an existing file and returns prior bytes", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const targetPath = path.join(directory, "existing.md")
        yield* Effect.promise(() => fs.writeFile(targetPath, "before"))
        const target = yield* (yield* LocationMutation.Service).resolve({ path: "existing.md" })
        const result = yield* (yield* FileMutation.Service).writeAtomic({ target, content: "after" })

        expect(result.operation).toBe("atomic_write")
        expect(result.existed).toBe(true)
        expect(new TextDecoder().decode(result.priorBytes!)).toBe("before")

        const content = yield* Effect.promise(() => fs.readFile(targetPath, "utf8"))
        expect(content).toBe("after")
      }).pipe(Effect.provide(provide(directory))),
    ),
  )

  it.live("writes bytes and preserves BOM", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const target = yield* (yield* LocationMutation.Service).resolve({ path: "bom.md" })
        const bom = new Uint8Array([0xef, 0xbb, 0xbf])
        const content = new Uint8Array([...bom, ...new TextEncoder().encode("content")])
        const result = yield* (yield* FileMutation.Service).writeAtomic({ target, content })

        expect(result.existed).toBe(false)
        const read = yield* Effect.promise(() => fs.readFile(target.canonical))
        expect(read[0]).toBe(0xef)
        expect(read[1]).toBe(0xbb)
        expect(read[2]).toBe(0xbf)
      }).pipe(Effect.provide(provide(directory))),
    ),
  )

  it.live("creates parent directories for new files", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const target = yield* (yield* LocationMutation.Service).resolve({
          path: path.join("deep", "nested", "file.md"),
        })
        yield* (yield* FileMutation.Service).writeAtomic({ target, content: "nested" })

        const content = yield* Effect.promise(() => fs.readFile(target.canonical, "utf8"))
        expect(content).toBe("nested")
      }).pipe(Effect.provide(provide(directory))),
    ),
  )

  test("does not create target file when temp write fails", async () => {
    const tmp = await tmpdir()
    try {
      const failingFs = Layer.effect(
        FSUtil.Service,
        Effect.gen(function* () {
          const fsUtil = yield* FSUtil.Service
          return FSUtil.Service.of({
            ...fsUtil,
            writeFile: () => Effect.fail(new Error("write failed")) as never,
            writeFileString: () => Effect.fail(new Error("write failed")) as never,
          })
        }),
      ).pipe(Layer.provide(FSUtil.defaultLayer))

      const target = await Effect.runPromise(
        Effect.gen(function* () {
          const mutation = yield* LocationMutation.Service
          return yield* mutation.resolve({ path: "fail.md" })
        }).pipe(Effect.provide(provide(tmp.path))),
      )

      await Effect.runPromise(
        Effect.gen(function* () {
          const files = yield* FileMutation.Service
          yield* files.writeAtomic({ target, content: "will fail" })
        }).pipe(
          Effect.provide(provide(tmp.path, failingFs)),
          Effect.flip,
        ),
      )

      const exists = await fs.stat(target.canonical).then(
        () => true,
        () => false,
      )
      expect(exists).toBe(false)
    } finally {
      await tmp[Symbol.asyncDispose]()
    }
  })

  it.live("serializes concurrent writes to the same target", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const target = yield* (yield* LocationMutation.Service).resolve({ path: "shared.md" })
        const files = yield* FileMutation.Service

        yield* Effect.all([
          files.writeAtomic({ target, content: "first" }),
          files.writeAtomic({ target, content: "second" }),
        ])

        const content = yield* Effect.promise(() => fs.readFile(target.canonical, "utf8"))
        expect(content).toBe("second")
      }).pipe(Effect.provide(provide(directory))),
    ),
  )

  it.live("allows concurrent writes to different targets", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const mutation = yield* LocationMutation.Service
        const files = yield* FileMutation.Service
        const firstTarget = yield* mutation.resolve({ path: "first.md" })
        const secondTarget = yield* mutation.resolve({ path: "second.md" })

        const [a, b] = yield* Effect.all([
          files.writeAtomic({ target: firstTarget, content: "alpha" }),
          files.writeAtomic({ target: secondTarget, content: "beta" }),
        ])
        expect(a.existed).toBe(false)
        expect(b.existed).toBe(false)
        expect(yield* Effect.promise(() => fs.readFile(firstTarget.canonical, "utf8"))).toBe("alpha")
        expect(yield* Effect.promise(() => fs.readFile(secondTarget.canonical, "utf8"))).toBe("beta")
      }).pipe(Effect.provide(provide(directory))),
    ),
  )

  test("clears temp files on rename failure", async () => {
    const tmp = await tmpdir()
    try {
      const failingFs = Layer.effect(
        FSUtil.Service,
        Effect.gen(function* () {
          const fsUtil = yield* FSUtil.Service
          return FSUtil.Service.of({
            ...fsUtil,
            rename: () => Effect.fail(new Error("rename failed")) as never,
          })
        }),
      ).pipe(Layer.provide(FSUtil.defaultLayer))

      const target = await Effect.runPromise(
        Effect.gen(function* () {
          const mutation = yield* LocationMutation.Service
          return yield* mutation.resolve({ path: "rename-fail.md" })
        }).pipe(Effect.provide(provide(tmp.path))),
      )

      await Effect.runPromise(
        Effect.gen(function* () {
          const files = yield* FileMutation.Service
          yield* files.writeAtomic({ target, content: "will fail rename" })
        }).pipe(
          Effect.provide(provide(tmp.path, failingFs)),
          Effect.flip,
        ),
      )

      const dir = path.dirname(target.canonical)
      const entries = await fs.readdir(dir)
      const tmpFiles = entries.filter((e) => e.includes(".tmp."))
      expect(tmpFiles.length).toBe(0)

      const exists = await fs.stat(target.canonical).then(
        () => true,
        () => false,
      )
      expect(exists).toBe(false)
    } finally {
      await tmp[Symbol.asyncDispose]()
    }
  })
})
