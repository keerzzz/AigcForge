/** @jsxImportSource @opentui/solid */
import { createTestRenderer } from "@opentui/core/testing"
import { spyOn } from "bun:test"
import type { CliRenderer } from "@opentui/core"
import { render } from "@opentui/solid"
import { Deferred, Effect, Exit, Fiber, Latch } from "effect"
import { Flock } from "@aigcfroge/util/flock"
import { TuiAppProvider, TuiPathsProvider, type TuiLifecycle } from "../../src/context/runtime"
import { StorageProvider, useStorage, type Storage } from "../../src/context/storage"
import type { LogLevel, LogSink, LogTags } from "../../src/context/log"
import { destroyRenderer } from "../../src/util/renderer"
import { awaitWithTimeout } from "../../../core/test/lib/effect"

export const holdLock = Effect.fn("Test.storage.holdLock")(function* (file: string, directory: string) {
  const scope = yield* Effect.scope
  const entered = yield* Deferred.make<void>()
  const release = yield* Deferred.make<void>()
  const fiber = yield* Effect.gen(function* () {
    yield* Effect.acquireRelease(
      Effect.promise((signal) => Flock.acquire(file, { dir: directory, signal })),
      (lease) => Effect.promise(() => lease.release()),
    )
    yield* Deferred.succeed(entered, undefined)
    yield* Deferred.await(release)
  }).pipe(Effect.scoped, Effect.forkIn(scope))
  yield* awaitWithTimeout(Deferred.await(entered), "storage lock was not acquired")
  return { release: Deferred.succeed(release, undefined), done: Fiber.join(fiber) }
})

export const create = Effect.fn("Test.storage.create")(function* (input: { state: string; log: LogSink }) {
  const scope = yield* Effect.scope
  const ready = Promise.withResolvers<{ storage: Storage; renderer: CliRenderer; lifecycle: TuiLifecycle }>()
  const done = yield* Deferred.make<Exit.Exit<void, never>>()
  const fiber = yield* Effect.gen(function* () {
    const setup = yield* Effect.acquireRelease(
      Effect.promise(() => createTestRenderer({ width: 80, height: 24, useThread: false, kittyKeyboard: true })),
      (value) => Effect.sync(() => destroyRenderer(value.renderer)),
    )
    setup.renderer.start()
    // Import the owning production function only for these Scope keepers.
    const { createTuiLifecycle } = yield* Effect.promise(() => import("../../src/context/runtime"))
    const lifecycle = yield* createTuiLifecycle(input.log)
    const shutdown = yield* Latch.make()
    setup.renderer.once("destroy", () => shutdown.openUnsafe())
    const captured = Promise.withResolvers<Storage>()
    function Probe() {
      captured.resolve(useStorage())
      return <box />
    }
    yield* Effect.promise(() =>
      render(
        () => (
          <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
            <TuiPathsProvider
              value={{ cwd: input.state, home: input.state, state: input.state, worktree: input.state }}
            >
              <StorageProvider lifecycle={lifecycle}>
                <Probe />
              </StorageProvider>
            </TuiPathsProvider>
          </TuiAppProvider>
        ),
        setup.renderer,
      ),
    )
    ready.resolve({ storage: yield* Effect.promise(() => captured.promise), renderer: setup.renderer, lifecycle })
    yield* shutdown.await
  }).pipe(
    Effect.scoped,
    Effect.onExit((exit) => Deferred.succeed(done, exit).pipe(Effect.asVoid)),
    Effect.exit,
    Effect.forkIn(scope),
  )
  return {
    ready: awaitWithTimeout(
      Effect.promise(() => ready.promise),
      "storage provider was not mounted",
    ),
    done: awaitWithTimeout(Deferred.await(done), "storage owner did not finish", "5 seconds"),
    isDone: Deferred.isDone(done),
    fiber,
  }
})

export function holdFlush(storage: Storage) {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const flush = storage.flush
  storage.flush = async () => {
    // Observe the actual flush; the original pending writes and Flock are not replaced.
    const completion = Promise.all([flush(), release.promise])
    entered.resolve()
    await completion
  }
  return {
    entered: awaitWithTimeout(
      Effect.promise(() => entered.promise),
      "shutdown did not enter storage.flush",
    ),
    release: Effect.sync(() => release.resolve()),
  }
}

export function captureLog(records: { level: LogLevel; message: string; tags: LogTags }[]): LogSink {
  return (level, message, tags) => {
    records.push({ level, message, tags })
    console[level](message, tags)
  }
}

export const captureOutput = Effect.fn("Test.storage.captureOutput")(function* () {
  const chunks: string[] = []
  const write = process.stdout.write.bind(process.stdout)
  const observe = (
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ) => {
    chunks.push(String(chunk))
    if (typeof encoding === "function") return write(chunk, encoding)
    return write(chunk, encoding, callback)
  }
  yield* Effect.acquireRelease(
    Effect.sync(() => spyOn(process.stdout, "write").mockImplementation(observe)),
    (probe) => Effect.sync(() => probe.mockRestore()),
  )
  return chunks
})

export * as StorageLifecycle from "./storage-lifecycle"
