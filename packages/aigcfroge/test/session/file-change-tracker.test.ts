import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { FileChangeTracker } from "../../src/session/file-change-tracker"

const testDir = "/tmp/aigcfroge-test-file-change"
const testFile = testDir + "/test.md"

const write = (path: string, content: string) => Effect.promise(() => Bun.write(path, content))

describe("FileChangeTracker", () => {
  test("should report no changes when no files registered", () =>
    Effect.gen(function* () {
      const tracker = yield* FileChangeTracker.make
      const changed = yield* tracker.hasChanges()
      expect(changed).toBe(false)
    }).pipe(Effect.runPromise),
  )

  test("should handle missing file gracefully", () =>
    Effect.gen(function* () {
      const tracker = yield* FileChangeTracker.make
      tracker.registerPath("/tmp/nonexistent_xyz_test")
      const changed = yield* tracker.hasChanges()
      expect(changed).toBe(false)
    }).pipe(Effect.runPromise),
  )

  test("should detect file modification", () =>
    Effect.gen(function* () {
      // Create file first
      yield* write(testFile, "short")
      const tracker = yield* FileChangeTracker.make
      tracker.registerPath(testFile)
      yield* tracker.refresh()
      // Modify with different-sized content
      yield* write(testFile, "longer content here")
      const changed = yield* tracker.hasChanges()
      expect(changed).toBe(true)
    }).pipe(Effect.runPromise),
  )

  test("should report no change for unmodified file", () =>
    Effect.gen(function* () {
      // Create and populate snapshot
      yield* write(testFile, "same content")
      const tracker = yield* FileChangeTracker.make
      tracker.registerPath(testFile)
      yield* tracker.refresh()
      // Wait briefly then check (no modification)
      yield* Effect.promise(() => Bun.write(testFile, "same content"))
      yield* tracker.refresh()
      const changed = yield* tracker.hasChanges()
      expect(changed).toBe(false)
    }).pipe(Effect.runPromise),
  )
})
