export * as Database from "./database"

import { EffectDrizzleSqlite } from "@aigcfroge/effect-drizzle-sqlite"
import { layer as sqliteLayer } from "#sqlite"
import { Context, Effect, Layer } from "effect"
import { Global } from "../global"
import { Flag } from "../flag/flag"
import { isAbsolute, join } from "path"
import { DatabaseMigration } from "./migration"
import { InstallationChannel } from "../installation/version"
import { LayerNode } from "../effect/layer-node"

const makeDatabase = EffectDrizzleSqlite.makeWithDefaults()
type DatabaseShape = Effect.Success<typeof makeDatabase>

export interface Interface {
  db: DatabaseShape
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/storage/Database") {}

/**
 * ADR-21 §2.5 止血 1 — tighten the SQLite files to owner-only so the database
 * matches the protection `auth.json` / `mcp-auth.json` already have.
 *
 * Ordering matters: `-wal` / `-shm` do not exist at open time, and
 * `PRAGMA journal_mode = WAL` alone does not create them either — they appear on
 * the first write, inheriting the main file's mode. `layerFromPath` therefore
 * hangs this off the driver layer, so it runs after the driver has created the
 * file but before `layer` issues its first write: the sidecars of a fresh
 * database are then *born* 0600 with no umask window, and an existing database
 * whose files were left loose gets re-tightened on reopen. Measured on
 * bun:sqlite — a 0600 main file yields 0600 sidecars, a 0644 main file yields
 * 0644 ones. Moving this after the migration leaves identical final permissions,
 * so no assertion can catch that regression; this paragraph is the only guard.
 * A file that is still absent is skipped — ENOENT is expected here, not a failure.
 *
 * win32 `chmod` can only toggle the read-only bit and cannot express owner-only,
 * so it is skipped there entirely — same shape as `ripgrep/binary.ts:88`. This
 * control is NOT cross-platform equivalent.
 */
const errnoCode = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error ? error.code : undefined

const restrictDatabaseFiles = (filename: string) =>
  Effect.gen(function* () {
    if (process.platform === "win32") return
    if (filename.includes(":memory:")) return
    const { chmod } = yield* Effect.promise(() => import("node:fs/promises"))
    for (const file of [filename, `${filename}-wal`, `${filename}-shm`]) {
      yield* Effect.tryPromise({ try: () => chmod(file, 0o600), catch: (cause) => cause }).pipe(
        Effect.catch((error) => {
          const code = errnoCode(error)
          if (code === "ENOENT") return Effect.void
          return Effect.logWarning("failed to restrict database file permissions", { file, code })
        }),
      )
    }
  })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* makeDatabase

    yield* db.run("PRAGMA journal_mode = WAL")
    yield* db.run("PRAGMA synchronous = NORMAL")
    yield* db.run("PRAGMA busy_timeout = 5000")
    yield* db.run("PRAGMA cache_size = -64000")
    yield* db.run("PRAGMA foreign_keys = ON")
    yield* db.run("PRAGMA wal_checkpoint(PASSIVE)")
    yield* DatabaseMigration.apply(db)

    return { db }
  }).pipe(Effect.orDie),
)

/**
 * `layer` must stay ONE shared Layer object: the MemoMap keys on Layer object
 * identity, so every `layerFromPath` call has to wrap that same node or each
 * caller gets its own SQLite instance. Building a fresh `Layer.effect(Service,
 * …)` here instead produced a second in-memory database and 62 HttpApi failures
 * (`FOREIGN KEY constraint failed` on `insert into "session"`) — the same class
 * of regression as Phase D's `provideMerge`. Never inline the body here.
 *
 * The chmod hangs off the driver layer rather than off `layer` because it needs
 * the filename and must run after the file exists (driver open) but before the
 * first write (see `restrictDatabaseFiles`).
 */
export function layerFromPath(filename: string) {
  return layer.pipe(Layer.provide(sqliteLayer({ filename }).pipe(Layer.tap(() => restrictDatabaseFiles(filename)))))
}

export function path() {
  if (Flag.AIGCFROGE_DB) {
    if (Flag.AIGCFROGE_DB === ":memory:" || isAbsolute(Flag.AIGCFROGE_DB)) return Flag.AIGCFROGE_DB
    return join(Global.Path.data, Flag.AIGCFROGE_DB)
  }
  if (
    ["latest", "beta", "prod"].includes(InstallationChannel) ||
    process.env.AIGCFROGE_DISABLE_CHANNEL_DB === "1" ||
    process.env.AIGCFROGE_DISABLE_CHANNEL_DB === "true"
  )
    return join(Global.Path.data, "aigcfroge.db")
  return join(Global.Path.data, `aigcfroge-${InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
}

export const defaultLayer = Layer.unwrap(
  Effect.gen(function* () {
    return layerFromPath(path())
  }),
).pipe(Layer.provide(Global.defaultLayer))

export const node = LayerNode.make(layerFromPath(path()), [])
