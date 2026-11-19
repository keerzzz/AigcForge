/** @jsxImportSource @opentui/solid */
import { expect } from "bun:test"
import { Effect, Exit, Fiber, Runtime } from "effect"
import path from "node:path"
import { createStorage } from "../../src/context/storage"
import type { LogLevel, LogTags } from "../../src/context/log"
import { StorageLifecycle } from "../fixture/storage-lifecycle"
import { tmpdir } from "../fixture/fixture"
import { it } from "../../../core/test/lib/effect"

it.live("storage owner waits for the real pending write and flush before normal shutdown finishes", () =>
  Effect.gen(function* () {
    const temporary = yield* Effect.acquireRelease(Effect.promise(tmpdir), (value) =>
      Effect.promise(() => value[Symbol.asyncDispose]()),
    )
    const file = path.join(temporary.path, "test", "tui", "probe.json")
    const lock = yield* StorageLifecycle.holdLock(file, path.join(temporary.path, "test", "locks"))
    const logs: { level: LogLevel; message: string; tags: LogTags }[] = []
    const fixture = yield* StorageLifecycle.create({ state: temporary.path, log: StorageLifecycle.captureLog(logs) })
    const mounted = yield* fixture.ready
    const flush = StorageLifecycle.holdFlush(mounted.storage)
    const update = mounted.storage.store("probe", { initial: { count: 0 } })[1]
    const operation = update((draft) => {
      draft.count = 1
    })
    try {
      mounted.renderer.destroy()
      yield* flush.entered
      expect(yield* fixture.isDone).toBe(false)
      yield* lock.release
      yield* lock.done
      yield* Effect.promise(() => operation)
      const saved: unknown = yield* Effect.promise(() => Bun.file(file).json())
      expect(saved).toEqual({ count: 1 })
      expect(yield* fixture.isDone).toBe(false)
      yield* flush.release
      expect(Exit.isSuccess(yield* fixture.done)).toBe(true)
      expect(logs.filter((entry) => entry.level === "error")).toEqual([])
    } finally {
      yield* flush.release
      yield* lock.release
      yield* lock.done
      yield* Fiber.interrupt(fixture.fiber)
    }
  }),
)

it.live("storage owner drains admitted writes on interruption and rejects later admissions", () =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope
    const temporary = yield* Effect.acquireRelease(Effect.promise(tmpdir), (value) =>
      Effect.promise(() => value[Symbol.asyncDispose]()),
    )
    const file = path.join(temporary.path, "test", "tui", "probe.json")
    const lock = yield* StorageLifecycle.holdLock(file, path.join(temporary.path, "test", "locks"))
    const logs: { level: LogLevel; message: string; tags: LogTags }[] = []
    const fixture = yield* StorageLifecycle.create({ state: temporary.path, log: StorageLifecycle.captureLog(logs) })
    const mounted = yield* fixture.ready
    const flush = StorageLifecycle.holdFlush(mounted.storage)
    const update = mounted.storage.store("probe", { initial: { count: 0 } })[1]
    const operation = update((draft) => {
      draft.count = 1
    })
    try {
      const interrupted = yield* Fiber.interrupt(fixture.fiber).pipe(Effect.forkIn(scope))
      yield* flush.entered
      expect(yield* fixture.isDone).toBe(false)
      yield* Effect.promise(async () => {
        await expect(
          update((draft) => {
            draft.count = 99
          }),
        ).rejects.toThrow("Storage is closed")
      })
      yield* lock.release
      yield* lock.done
      yield* Effect.promise(() => operation)
      yield* flush.release
      const exit = yield* fixture.done
      expect(Exit.hasInterrupts(exit)).toBe(true)
      expect(Exit.hasDies(exit)).toBe(false)
      const codes: number[] = []
      Runtime.defaultTeardown(exit, (code) => codes.push(code))
      expect(codes).toEqual([130])
      yield* Fiber.join(interrupted)
      const saved: unknown = yield* Effect.promise(() => Bun.file(file).json())
      expect(saved).toEqual({ count: 1 })
    } finally {
      yield* flush.release
      yield* lock.release
      yield* lock.done
      yield* Fiber.interrupt(fixture.fiber)
    }
  }),
)

it.live("storage shutdown preserves write and synchronous finalizer defects and logs both", () =>
  Effect.gen(function* () {
    const temporary = yield* Effect.acquireRelease(Effect.promise(tmpdir), (value) =>
      Effect.promise(() => value[Symbol.asyncDispose]()),
    )
    const file = path.join(temporary.path, "test", "tui", "probe.json")
    const lock = yield* StorageLifecycle.holdLock(file, path.join(temporary.path, "test", "locks"))
    const logs: { level: LogLevel; message: string; tags: LogTags }[] = []
    const fixture = yield* StorageLifecycle.create({ state: temporary.path, log: StorageLifecycle.captureLog(logs) })
    const mounted = yield* fixture.ready
    const flush = StorageLifecycle.holdFlush(mounted.storage)
    const failure = new Error("held storage mutation failed")
    const defect = new Error("synchronous TUI finalizer failed")
    mounted.lifecycle.add(() => {
      throw defect
    })
    const operation = mounted.storage.store("probe", { initial: { count: 0 } })[1](() => {
      throw failure
    })
    // Attach the actual update consumer before releasing the real lock.
    const failed = operation.then(
      () => undefined,
      (error: unknown) => error,
    )
    try {
      mounted.renderer.destroy()
      yield* flush.entered
      yield* lock.release
      yield* lock.done
      expect(yield* Effect.promise(() => failed)).toBe(failure)
      yield* flush.release
      const exit = yield* fixture.done
      expect(Exit.hasDies(exit)).toBe(true)
      if (Exit.isSuccess(exit)) return yield* Effect.die(new Error("Storage failure was reported as success"))
      const reason = exit.cause.reasons.find((item) => item._tag === "Die")
      if (reason?._tag !== "Die" || !(reason.defect instanceof AggregateError))
        return yield* Effect.die(new Error("Storage shutdown did not retain both original failures"))
      expect(reason.defect.errors).toHaveLength(2)
      expect(reason.defect.errors).toContain(failure)
      expect(reason.defect.errors).toContain(defect)
      const codes: number[] = []
      Runtime.defaultTeardown(exit, (code) => codes.push(code))
      expect(codes).toEqual([1])
      expect(logs.some((entry) => entry.level === "error" && entry.tags.error === failure)).toBe(true)
      expect(logs.some((entry) => entry.level === "error" && entry.tags.error === defect)).toBe(true)
    } finally {
      yield* flush.release
      yield* lock.release
      yield* lock.done
      yield* Fiber.interrupt(fixture.fiber)
    }
  }),
)

it.live("closed storage cannot rewrite its old profile or a replacement profile", () =>
  Effect.gen(function* () {
    const firstRoot = yield* Effect.acquireRelease(Effect.promise(tmpdir), (value) =>
      Effect.promise(() => value[Symbol.asyncDispose]()),
    )
    const nextRoot = yield* Effect.acquireRelease(Effect.promise(tmpdir), (value) =>
      Effect.promise(() => value[Symbol.asyncDispose]()),
    )
    const first = yield* Effect.acquireRelease(
      Effect.sync(() => createStorage(firstRoot.path, "test")),
      (value) => Effect.sync(value.close),
    )
    const next = yield* Effect.acquireRelease(
      Effect.sync(() => createStorage(nextRoot.path, "test")),
      (value) => Effect.sync(value.close),
    )
    const firstUpdate = first.storage.store("probe", { initial: { count: 0 } })[1]
    const nextUpdate = next.storage.store("probe", { initial: { count: 0 } })[1]
    yield* Effect.promise(() =>
      firstUpdate((draft) => {
        draft.count = 1
      }),
    )
    first.close()
    yield* Effect.promise(() =>
      nextUpdate((draft) => {
        draft.count = 2
      }),
    )
    yield* Effect.promise(async () => {
      await expect(
        firstUpdate((draft) => {
          draft.count = 99
        }),
      ).rejects.toThrow("Storage is closed")
    })
    const before: unknown = yield* Effect.promise(() =>
      Bun.file(path.join(firstRoot.path, "test", "tui", "probe.json")).json(),
    )
    const after: unknown = yield* Effect.promise(() =>
      Bun.file(path.join(nextRoot.path, "test", "tui", "probe.json")).json(),
    )
    expect(before).toEqual({ count: 1 })
    expect(after).toEqual({ count: 2 })
  }),
)
