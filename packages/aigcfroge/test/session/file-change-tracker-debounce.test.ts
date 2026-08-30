import { describe, expect } from "bun:test"
import { Duration, Effect } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { FileChangeTracker } from "../../src/session/file-change-tracker"
import { it } from "../lib/effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const withTmpFile = (fn: (path: string) => Effect.Effect<void>) =>
  Effect.gen(function* () {
    const dirpath = path.join(os.tmpdir(), "aigcfroge-fct-test-" + Math.random().toString(36).slice(2))
    yield* Effect.promise(() => fs.mkdir(dirpath, { recursive: true }))
    const dir = yield* Effect.promise(() => fs.realpath(dirpath))
    const filePath = path.join(dir, "file.txt")
    yield* Effect.promise(() => Bun.write(filePath, "v1"))

    yield* Effect.addFinalizer(() =>
      Effect.promise(() => fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)),
    )

    yield* fn(filePath)
  })

describe("FileChangeTracker debounce + cooldown", () => {
  it.effect("should report first change immediately, then debounce subsequent rapid changes", () =>
    withTmpFile((filePath) =>
      Effect.gen(function* () {
        const tracker = new FileChangeTracker({ debounceMs: 500, cooldownMs: 60_000 })
        tracker.registerPath(filePath)
        yield* tracker.refresh()

        // Mutate and check immediately — first detection returns true
        yield* Effect.promise(() => Bun.write(filePath, "version two"))
        expect(yield* tracker.hasChanges()).toBe(true)

        // A second write within the debounce window — suppressed
        yield* Effect.promise(() => Bun.write(filePath, "version three"))
        expect(yield* tracker.hasChanges()).toBe(false)

        // Advance just under debounce window
        yield* TestClock.adjust(Duration.millis(499))
        expect(yield* tracker.hasChanges()).toBe(false)

        // Cross the debounce threshold
        yield* TestClock.adjust(Duration.millis(2))
        expect(yield* tracker.hasChanges()).toBe(true)

        // Subsequent call is false until another change
        expect(yield* tracker.hasChanges()).toBe(false)
      }),
    ),
  )

  it.effect("should enforce cooldown between reports", () =>
    withTmpFile((filePath) =>
      Effect.gen(function* () {
        const tracker = new FileChangeTracker({ debounceMs: 0, cooldownMs: 60_000 })
        tracker.registerPath(filePath)
        yield* tracker.refresh()

        yield* Effect.promise(() => Bun.write(filePath, "version two"))
        expect(yield* tracker.hasChanges()).toBe(true)

        yield* Effect.promise(() => Bun.write(filePath, "version three"))
        expect(yield* tracker.hasChanges()).toBe(false)

        // Advance past cooldown
        yield* TestClock.adjust(Duration.minutes(1))
        expect(yield* tracker.hasChanges()).toBe(true)
      }),
    ),
  )

  it.effect("refresh should reset pending change state", () =>
    withTmpFile((filePath) =>
      Effect.gen(function* () {
        const tracker = new FileChangeTracker({ debounceMs: 500, cooldownMs: 60_000 })
        tracker.registerPath(filePath)
        yield* tracker.refresh()

        yield* Effect.promise(() => Bun.write(filePath, "version two"))
        // First detection returns true immediately
        expect(yield* tracker.hasChanges()).toBe(true)

        yield* tracker.refresh()
        expect(yield* tracker.hasChanges()).toBe(false)
      }),
    ),
  )
})
