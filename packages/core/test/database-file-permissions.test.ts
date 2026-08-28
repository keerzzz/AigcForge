import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { chmod, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { Database } from "@aigcfroge/core/database/database"
import { Global } from "@aigcfroge/core/global"
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

  it.effect("re-tightens a database and its sidecar that sat at the process umask", () =>
    Effect.gen(function* () {
      if (skipOnWindows) return
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (t) => Effect.promise(() => t[Symbol.asyncDispose]()),
      )
      const filename = join(tmp.path, "remediate.sqlite")
      // Both phases run their work *inside* the layer's scope on purpose. SQLite
      // deletes `-wal` / `-shm` when the last connection closes cleanly, so a
      // sidecar stat-ed after the scope ends is a file that no longer exists —
      // this test used to do exactly that and only passed when it won the race
      // against the close (CI caught it as ENOENT on `remediate.sqlite-wal`).
      const withOpen = <A, E>(body: Effect.Effect<A, E>) =>
        Effect.gen(function* () {
          yield* Database.Service
          return yield* body
        }).pipe(Effect.provide(Database.layerFromPath(filename)))

      // Simulate a database created by a build that shipped no chmod at all.
      // The main file keeps 0644 across the close; the sidecar is recreated at
      // the process umask by the reopen, so both reach the second phase loose.
      yield* withOpen(
        Effect.promise(async () => {
          await chmod(filename, 0o644)
          await chmod(`${filename}-wal`, 0o644)
        }),
      )
      expect(yield* Effect.promise(() => mode(filename))).toBe("644")

      yield* withOpen(
        Effect.gen(function* () {
          expect(yield* Effect.promise(() => mode(filename))).toBe("600")
          expect(yield* Effect.promise(() => mode(`${filename}-wal`))).toBe("600")
        }),
      )
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

  /**
   * Owner-only files inside a 0775 directory are half a control, and
   * `Global.Path.data` is created by a bare `mkdir` with no mode. But the scope
   * of the directory fix is the part worth pinning: `AIGCFROGE_DB` may point
   * anywhere, and tightening a directory this app neither created nor owns would
   * cost other accounts their access to it.
   *
   * Asserted through the exported predicate rather than by opening a database
   * inside the real data directory, which is the only other way to reach the
   * positive branch and is not something a test may do.
   */
  describe("data directory scope", () => {
    it.effect("restricts only the directory this app created", () =>
      Effect.gen(function* () {
        if (skipOnWindows) return
        expect(Database.restrictsDirectoryOf(join(Global.Path.data, "aigcfroge.db"))).toBe(true)
        expect(Database.restrictsDirectoryOf(join(Global.Path.data, "aigcfroge-local.db"))).toBe(true)
        expect(Database.restrictsDirectoryOf("/srv/shared/aigcfroge.db")).toBe(false)
        expect(Database.restrictsDirectoryOf(join(Global.Path.data, "nested", "aigcfroge.db"))).toBe(false)
        expect(Database.restrictsDirectoryOf(":memory:")).toBe(false)
      }),
    )

    it.effect("leaves an operator-supplied directory at its original mode", () =>
      Effect.gen(function* () {
        if (skipOnWindows) return
        const tmp = yield* Effect.acquireRelease(
          Effect.promise(() => tmpdir()),
          (t) => Effect.promise(() => t[Symbol.asyncDispose]()),
        )
        const filename = join(tmp.path, "outside.sqlite")
        yield* Effect.promise(() => chmod(tmp.path, 0o755))

        yield* Effect.gen(function* () {
          yield* Database.Service
        }).pipe(Effect.provide(Database.layerFromPath(filename)))

        expect(yield* Effect.promise(() => mode(tmp.path))).toBe("755")
        // The file itself is still tightened wherever it lives.
        expect(yield* Effect.promise(() => mode(filename))).toBe("600")
      }),
    )
  })
})
