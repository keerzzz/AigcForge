import { describe, expect } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { eq, sql } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { MoveSession } from "@aigcfroge/core/control-plane/move-session"
import { Database } from "@aigcfroge/core/database/database"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { Git } from "@aigcfroge/core/git"
import { EventV2 } from "@aigcfroge/core/event"
import { computeDigest } from "@aigcfroge/core/composition/digest"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { ProjectDirectories } from "@aigcfroge/core/project/directories"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionContextEpochTable, SessionTable } from "@aigcfroge/core/session/sql"
import { SessionStore } from "@aigcfroge/core/session/store"
import { Composition } from "@aigcfroge/schema/composition"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const project = Project.layer.pipe(
  Layer.provide(Database.defaultLayer),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(Git.defaultLayer),
  Layer.provide(ProjectDirectories.defaultLayer),
)
const sessions = SessionV2.layer.pipe(
  Layer.provide(Database.defaultLayer),
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(project),
  Layer.provide(SessionStore.defaultLayer),
  Layer.provide(SessionExecution.noopLayer),
)
const layer = MoveSession.layer.pipe(
  Layer.provide(Database.defaultLayer),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(Git.defaultLayer),
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(project),
  Layer.provide(SessionComposition.defaultLayer),
  Layer.provide(sessions),
)
const it = testEffect(
  Layer.mergeAll(
    layer,
    Database.defaultLayer,
    EventV2.defaultLayer,
    ProjectDirectories.defaultLayer,
    project,
    SessionComposition.defaultLayer,
    SessionProjector.defaultLayer,
    SessionStore.defaultLayer,
    SessionExecution.noopLayer,
    sessions,
  ),
)

function abs(input: string) {
  return AbsolutePath.make(input)
}

async function initRepo(directory: string) {
  await $`git init`.cwd(directory).quiet()
  await $`git config core.autocrlf false`.cwd(directory).quiet()
  await $`git config core.fsmonitor false`.cwd(directory).quiet()
  await $`git config commit.gpgsign false`.cwd(directory).quiet()
  await $`git config user.email test@aigcfroge.test`.cwd(directory).quiet()
  await $`git config user.name Test`.cwd(directory).quiet()
  await fs.writeFile(path.join(directory, "tracked.txt"), "initial\n")
  await $`git add tracked.txt`.cwd(directory).quiet()
  await $`git commit -m root`.cwd(directory).quiet()
}

describe("MoveSession", () => {
  it.live("moves session changes to another project directory", () =>
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(root.path))
      const source = abs(yield* Effect.promise(() => fs.realpath(root.path)))
      const destination = abs(`${root.path}-move-destination`)
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => fs.rm(destination, { recursive: true, force: true })).pipe(Effect.ignore),
      )
      yield* Effect.promise(() => $`git worktree add --detach ${destination} HEAD`.cwd(root.path).quiet())
      const moved = abs(yield* Effect.promise(() => fs.realpath(destination)))
      yield* Effect.promise(() => fs.writeFile(path.join(source, "tracked.txt"), "changed\n"))
      yield* Effect.promise(() => fs.writeFile(path.join(source, "untracked.txt"), "new\n"))

      const projectID = (yield* Project.Service.use((service) => service.resolve(source))).id
      const sessionID = SessionV2.ID.make("ses_move")
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: projectID, worktree: source, sandboxes: [], time_created: 1, time_updated: 1 })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: projectID,
          slug: "move",
          directory: source,
          title: "move",
          version: "test",
          time_created: 1,
          time_updated: 1,
        })
        .run()
        .pipe(Effect.orDie)

      yield* MoveSession.Service.use((service) =>
        service.moveSession({ sessionID, destination: { directory: moved }, moveChanges: true }),
      )

      expect(yield* Effect.promise(() => fs.readFile(path.join(moved, "tracked.txt"), "utf8"))).toBe("changed\n")
      expect(yield* Effect.promise(() => fs.readFile(path.join(moved, "untracked.txt"), "utf8"))).toBe("new\n")
      expect(yield* Effect.promise(() => fs.readFile(path.join(source, "tracked.txt"), "utf8"))).toBe("initial\n")
      expect(yield* Effect.promise(() => Bun.file(path.join(source, "untracked.txt")).exists())).toBe(false)
      expect(
        yield* db
          .select({ directory: SessionTable.directory, path: SessionTable.path })
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get(),
      ).toEqual({ directory: moved, path: "" })
    }),
  )

  it.live("moves within a checkout without transferring existing changes", () =>
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(root.path))
      const source = abs(yield* Effect.promise(() => fs.realpath(root.path)))
      const destination = abs(path.join(source, "packages"))
      yield* Effect.promise(() => fs.mkdir(destination))
      yield* Effect.promise(() => fs.writeFile(path.join(source, "tracked.txt"), "changed\n"))
      yield* Effect.promise(() => fs.writeFile(path.join(source, "untracked.txt"), "new\n"))

      const projectID = (yield* Project.Service.use((service) => service.resolve(source))).id
      const sessionID = SessionV2.ID.make("ses_move_nested")
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: projectID, worktree: source, sandboxes: [], time_created: 1, time_updated: 1 })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: projectID,
          slug: "move-nested",
          directory: source,
          title: "move nested",
          version: "test",
          time_created: 1,
          time_updated: 1,
        })
        .run()
        .pipe(Effect.orDie)

      yield* MoveSession.Service.use((service) =>
        service.moveSession({ sessionID, destination: { directory: destination }, moveChanges: true }),
      )

      expect(yield* Effect.promise(() => fs.readFile(path.join(source, "tracked.txt"), "utf8"))).toBe("changed\n")
      expect(yield* Effect.promise(() => fs.readFile(path.join(source, "untracked.txt"), "utf8"))).toBe("new\n")
      expect(
        yield* db
          .select({ directory: SessionTable.directory, path: SessionTable.path })
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get(),
      ).toEqual({ directory: destination, path: "packages" })
    }),
  )

  it.live("moves nested session changes without cleaning unrelated files", () =>
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(root.path))
      const source = abs(yield* Effect.promise(() => fs.realpath(root.path)))
      const sourceDirectory = abs(path.join(source, "packages"))
      yield* Effect.promise(() => fs.mkdir(sourceDirectory))
      yield* Effect.promise(() => fs.writeFile(path.join(sourceDirectory, "tracked.txt"), "initial\n"))
      yield* Effect.promise(() => fs.writeFile(path.join(sourceDirectory, "staged.txt"), "initial\n"))
      yield* Effect.promise(() => $`git add packages/tracked.txt packages/staged.txt`.cwd(source).quiet())
      yield* Effect.promise(() => $`git commit -m packages`.cwd(source).quiet())
      const destination = abs(`${root.path}-move-nested-destination`)
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => fs.rm(destination, { recursive: true, force: true })).pipe(Effect.ignore),
      )
      yield* Effect.promise(() => $`git worktree add --detach ${destination} HEAD`.cwd(source).quiet())
      const moved = abs(path.join(yield* Effect.promise(() => fs.realpath(destination)), "packages"))
      yield* Effect.promise(() => fs.writeFile(path.join(sourceDirectory, "tracked.txt"), "changed\n"))
      yield* Effect.promise(() => fs.writeFile(path.join(sourceDirectory, "staged.txt"), "staged\n"))
      yield* Effect.promise(() => $`git add packages/staged.txt`.cwd(source).quiet())
      yield* Effect.promise(() => fs.writeFile(path.join(sourceDirectory, "untracked.txt"), "new\n"))
      yield* Effect.promise(() => fs.writeFile(path.join(source, "tracked.txt"), "unrelated\n"))
      yield* Effect.promise(() => fs.writeFile(path.join(source, "untracked.txt"), "unrelated\n"))

      const projectID = (yield* Project.Service.use((service) => service.resolve(source))).id
      const sessionID = SessionV2.ID.make("ses_move_nested_checkout")
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: projectID, worktree: source, sandboxes: [], time_created: 1, time_updated: 1 })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: projectID,
          slug: "move-nested-checkout",
          directory: sourceDirectory,
          title: "move nested checkout",
          version: "test",
          time_created: 1,
          time_updated: 1,
        })
        .run()
        .pipe(Effect.orDie)

      yield* MoveSession.Service.use((service) =>
        service.moveSession({ sessionID, destination: { directory: moved }, moveChanges: true }),
      )

      expect(yield* Effect.promise(() => fs.readFile(path.join(moved, "tracked.txt"), "utf8"))).toBe("changed\n")
      expect(yield* Effect.promise(() => fs.readFile(path.join(moved, "staged.txt"), "utf8"))).toBe("staged\n")
      expect(yield* Effect.promise(() => fs.readFile(path.join(moved, "untracked.txt"), "utf8"))).toBe("new\n")
      expect(yield* Effect.promise(() => fs.readFile(path.join(sourceDirectory, "tracked.txt"), "utf8"))).toBe(
        "initial\n",
      )
      expect(yield* Effect.promise(() => Bun.file(path.join(sourceDirectory, "untracked.txt")).exists())).toBe(false)
      expect(yield* Effect.promise(() => fs.readFile(path.join(sourceDirectory, "staged.txt"), "utf8"))).toBe(
        "staged\n",
      )
      expect(yield* Effect.promise(() => $`git status --porcelain -- packages/staged.txt`.cwd(source).text())).toBe(
        "M  packages/staged.txt\n",
      )
      expect(yield* Effect.promise(() => fs.readFile(path.join(source, "tracked.txt"), "utf8"))).toBe("unrelated\n")
      expect(yield* Effect.promise(() => fs.readFile(path.join(source, "untracked.txt"), "utf8"))).toBe("unrelated\n")
    }),
  )

  describe("custom mode", () => {
    const customDigest = Composition.Digest.make("1".repeat(64))

    // Internally consistent snapshot: catalogDigest recomputed over the
    // fingerprints array, catalog equal to the sorted fingerprint names.
    function makeCustomSnapshot(sessionID: SessionV2.ID, options?: { catalog?: string[] }): Composition.Snapshot {
      const fingerprints = [
        { placement: "/project", name: "glob", digest: customDigest, installationVersion: "0.1.0" },
        { placement: "/project", name: "read", digest: customDigest, installationVersion: "0.1.0" },
      ]
      return new Composition.Snapshot({
        version: 1,
        digest: customDigest,
        sessionID,
        createdAt: 1000,
        data: new Composition.SnapshotData({
          agentID: "custom-coder",
          instructions: [],
          prompts: [],
          skills: [],
          tools: new Composition.SnapshotToolInfo({
            fingerprints,
            catalogDigest: computeDigest(fingerprints),
            catalog: options?.catalog ?? fingerprints.map((fingerprint) => fingerprint.name),
          }),
        }),
      })
    }

    const setupCustomMove = Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(root.path))
      const source = abs(yield* Effect.promise(() => fs.realpath(root.path)))
      const destination = abs(path.join(source, "packages"))
      yield* Effect.promise(() => fs.mkdir(destination))

      const projectID = (yield* Project.Service.use((service) => service.resolve(source))).id
      const sessionID = SessionV2.ID.create()
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: projectID, worktree: source, sandboxes: [], time_created: 1, time_updated: 1 })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: projectID,
          slug: "move-custom",
          mode: "custom",
          directory: source,
          title: "move custom",
          version: "test",
          time_created: 1,
          time_updated: 1,
        })
        .run()
        .pipe(Effect.orDie)
      return { source, destination, sessionID }
    })

    const directoryOf = Effect.fnUntraced(function* (sessionID: SessionV2.ID) {
      const { db } = yield* Database.Service
      const row = yield* db
        .select({ directory: SessionTable.directory })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
        .pipe(Effect.orDie)
      return row?.directory
    })

    it.live("fails closed when moving a custom session whose composition snapshot is missing", () =>
      Effect.gen(function* () {
        const { source, destination, sessionID } = yield* setupCustomMove

        const err = yield* MoveSession.Service.use((service) =>
          service.moveSession({ sessionID, destination: { directory: destination } }),
        ).pipe(Effect.flip)
        expect(err).toBeInstanceOf(SessionComposition.SnapshotNotFoundError)

        // The Moved event was never published: the session stays put.
        expect(yield* directoryOf(sessionID)).toBe(source)
      }),
    )

    it.live("fails closed when moving a custom session whose snapshot breaks internal consistency", () =>
      Effect.gen(function* () {
        const { source, destination, sessionID } = yield* setupCustomMove
        const composition = yield* SessionComposition.Service
        yield* composition.attach(sessionID, makeCustomSnapshot(sessionID, { catalog: [] }))

        const err = yield* MoveSession.Service.use((service) =>
          service.moveSession({ sessionID, destination: { directory: destination } }),
        ).pipe(Effect.flip)
        expect(err).toBeInstanceOf(SessionComposition.DependencyMissingError)
        if (err instanceof SessionComposition.DependencyMissingError) {
          expect(err.reason).toBe("empty_tool_catalog")
        }

        expect(yield* directoryOf(sessionID)).toBe(source)
      }),
    )

    it.live("moves a custom session with its frozen snapshot intact and resets the context epoch", () =>
      Effect.gen(function* () {
        const { destination, sessionID } = yield* setupCustomMove
        const composition = yield* SessionComposition.Service
        const { db } = yield* Database.Service
        const snapshot = makeCustomSnapshot(sessionID)
        yield* composition.attach(sessionID, snapshot)
        yield* db.run(
          sql`INSERT INTO session_context_epoch (session_id, baseline, snapshot, baseline_seq) VALUES (${sessionID}, 'baseline', '{}', 0)`,
        )

        yield* MoveSession.Service.use((service) =>
          service.moveSession({ sessionID, destination: { directory: destination } }),
        )

        expect(yield* directoryOf(sessionID)).toBe(destination)

        // Snapshot rows are keyed by sessionID: the frozen composition survives
        // the move byte-for-byte and still passes internal consistency checks.
        const moved = yield* composition.get(sessionID)
        expect(moved.digest).toBe(snapshot.digest)
        expect(moved.data.agentID).toBe(snapshot.data.agentID)
        expect(moved.data.tools).toEqual(snapshot.data.tools)
        yield* composition.assertDependency(sessionID)

        // System context embeds directory paths, so the Moved projection
        // (session/projector.ts) discards the now-stale cached epoch.
        const epoch = yield* db
          .select({ sessionID: SessionContextEpochTable.session_id })
          .from(SessionContextEpochTable)
          .where(eq(SessionContextEpochTable.session_id, sessionID))
          .get()
          .pipe(Effect.orDie)
        expect(epoch).toBeUndefined()
      }),
    )
  })
})
