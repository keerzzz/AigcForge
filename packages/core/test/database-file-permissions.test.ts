import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { chmod, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { Database } from "@aigcfroge/core/database/database"
import { testEffect } from "./lib/effect"
import { tmpdir } from "./fixture/tmpdir"

const it = testEffect(Layer.empty)
const skipOnWindows = process.platform === "win32"

const mode = async (file: string) => ((await stat(file)).mode & 0o777).toString(8)

describe("Database file permissions (ADR-21 §2.5 止血 1)", () => {
  it.effect("restricts the main database file to owner-only after initialization", () =>
    Effect.gen(function* () {
      if (skipOnWindows) return
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (t) => Effect.promise(() => t[Symbol.asyncDispose]()),
      )
      const filename = join(tmp.path, "perm.sqlite")
      yield* Effect.gen(function* () {
        yield* Database.Service
      }).pipe(Effect.provide(Database.layerFromPath(filename)))

      expect(existsSync(filename)).toBe(true)
      expect(yield* Effect.promise(() => mode(filename))).toBe("600")
    }),
  )

  it.effect("restricts the -wal / -shm sidecars that exist at initialization time", () =>
    Effect.gen(function* () {
      if (skipOnWindows) return
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (t) => Effect.promise(() => t[Symbol.asyncDispose]()),
      )
      const filename = join(tmp.path, "sidecar.sqlite")
      yield* Effect.gen(function* () {
        yield* Database.Service
      }).pipe(Effect.provide(Database.layerFromPath(filename)))

      // Migration writes, so WAL sidecars must exist by the time chmod runs.
      // If this ever regresses to "sidecars absent", the ordering guarantee in
      // `restrictDatabaseFiles` has been broken and the newest committed rows
      // would sit in a file left at the process umask (ADR-21 §2.5 v1.1).
      for (const sidecar of [`${filename}-wal`, `${filename}-shm`]) {
        expect(existsSync(sidecar)).toBe(true)
        expect(yield* Effect.promise(() => mode(sidecar))).toBe("600")
      }
    }),
  )

  it.effect("is idempotent: re-opening an already restricted database keeps 600", () =>
    Effect.gen(function* () {
      if (skipOnWindows) return
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (t) => Effect.promise(() => t[Symbol.asyncDispose]()),
      )
      const filename = join(tmp.path, "reopen.sqlite")
      const open = Effect.gen(function* () {
        yield* Database.Service
      }).pipe(Effect.provide(Database.layerFromPath(filename)))

      yield* open
      // Loosen it behind the layer's back, then reopen: the control must reapply.
      yield* Effect.promise(() => chmod(filename, 0o644))
      expect(yield* Effect.promise(() => mode(filename))).toBe("644")
      yield* open
      expect(yield* Effect.promise(() => mode(filename))).toBe("600")
    }),
  )

  it.effect("re-tightens a sidecar that was loosened behind the layer's back", () =>
    Effect.gen(function* () {
      if (skipOnWindows) return
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (t) => Effect.promise(() => t[Symbol.asyncDispose]()),
      )
      const filename = join(tmp.path, "remediate.sqlite")
      const open = Effect.gen(function* () {
        yield* Database.Service
      }).pipe(Effect.provide(Database.layerFromPath(filename)))

      yield* open
      // Simulate a database created by a build that shipped no chmod at all:
      // both the main file and its WAL sidecar sit at the process umask.
      yield* Effect.promise(() => chmod(filename, 0o644))
      yield* Effect.promise(() => chmod(`${filename}-wal`, 0o644))
      yield* open
      expect(yield* Effect.promise(() => mode(filename))).toBe("600")
      expect(yield* Effect.promise(() => mode(`${filename}-wal`))).toBe("600")
    }),
  )

  it.effect("in-memory databases are skipped without failing", () =>
    Effect.gen(function* () {
      const { db } = yield* Effect.gen(function* () {
        return yield* Database.Service
      }).pipe(Effect.provide(Database.layerFromPath(":memory:")))
      expect(db).toBeDefined()
    }),
  )
})
