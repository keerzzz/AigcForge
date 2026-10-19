import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Option, Schema } from "effect"
import { eq, sql } from "drizzle-orm"
import { Database } from "@aigcfroge/core/database/database"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { Hash } from "@aigcfroge/core/util/hash"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { FileMutation } from "@aigcfroge/core/file-mutation"
import { LocationMutation } from "@aigcfroge/core/location-mutation"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { Location } from "@aigcfroge/core/location"
import { EventV2 } from "@aigcfroge/core/event"
import { SessionV2 } from "@aigcfroge/core/session"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { WorkArtifact } from "../src/session/artifact"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { awaitWithTimeout, testEffect } from "./lib/effect"

const it = testEffect(FSUtil.defaultLayer)

const sessionID = SessionV2.ID.make("ses_artifact_apply")

function fixture(directory: string, filesystem = FSUtil.defaultLayer) {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
  )
  const database = Database.layerFromPath(path.join(directory, "artifact.sqlite"))
  const services = Layer.mergeAll(activeLocation, filesystem, database, EventV2.layer.pipe(Layer.provide(database)))
  const boundaries = Layer.mergeAll(
    LocationMutation.layer.pipe(Layer.provide(services)),
    FileMutation.layer.pipe(Layer.provide(filesystem)),
  )
  return Layer.mergeAll(
    services,
    boundaries,
    WorkArtifact.layer.pipe(Layer.provide(Layer.mergeAll(services, boundaries))),
  )
}

const seed = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  const current = yield* Location.Service
  yield* db
    .insert(ProjectTable)
    .values({
      id: current.project.id,
      worktree: current.directory,
      sandboxes: [],
    })
    .onConflictDoNothing()
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: current.project.id,
      directory: current.directory,
      mode: "work",
      slug: "artifact-fixture",
      title: "Artifact fixture",
      version: "test",
      metadata: { keep: { nested: "untouched" }, permissionSentinel: false },
    })
    .onConflictDoNothing()
})

function provide(directory: string) {
  return <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    seed.pipe(Effect.andThen(effect), Effect.provide(fixture(directory)))
}

const stored = Effect.gen(function* () {
  return yield* (yield* Database.Service).db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get()
})

const input = { sessionID, title: "Current artifact", relativePath: "current.md", content: "first" }
const revision = (content: string) => Schema.decodeUnknownSync(WorkflowAsset.Revision)(Hash.sha256(content))

function failure(exit: Exit.Exit<unknown, unknown>) {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isSuccess(exit)) throw new Error("Expected an artifact failure")
  expect(Cause.hasDies(exit.cause)).toBe(false)
  return Option.getOrThrow(Cause.findErrorOption(exit.cause))
}

function withTmp<A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) {
  return Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(tmp.path)))
}

describe("WorkArtifact.apply", () => {
  it.live("writes the candidate to the current location atomically and publishes the event", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const published: Array<{ type: string; data: unknown }> = []
        yield* (yield* EventV2.Service).listen((event) =>
          Effect.sync(() => {
            published.push({ type: event.type, data: event.data })
          }),
        )
        const service = yield* WorkArtifact.Service
        const result = yield* service.apply({
          sessionID,
          title: "视频分镜脚本",
          relativePath: "分镜脚本.md",
          content: "# 分镜脚本\n\n镜头一",
        })
        expect(result.artifact.status).toBe("available")
        expect(result.artifact.mediaType).toBe("text/markdown")
        expect(yield* Effect.promise(() => fs.readFile(path.join(directory, "分镜脚本.md"), "utf8"))).toBe(
          "# 分镜脚本\n\n镜头一",
        )
        expect(published).toEqual([
          { type: "work.artifact_applied", data: { sessionID, artifactID: result.artifact.id } },
        ])
      }).pipe(provide(directory)),
    ),
  )

  it.live("rejects a relative path escaping the location", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const service = yield* WorkArtifact.Service
        const failure = yield* service
          .apply({ sessionID, title: "x", relativePath: "../escape.md", content: "x" })
          .pipe(Effect.flip)
        expect(failure._tag).toBe("WorkArtifact.PathValidation")
      }).pipe(provide(directory)),
    ),
  )

  it.live("rejects an absolute path", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const service = yield* WorkArtifact.Service
        const failure = yield* service
          .apply({ sessionID, title: "x", relativePath: "/etc/escape.md", content: "x" })
          .pipe(Effect.flip)
        expect(failure._tag).toBe("WorkArtifact.PathValidation")
      }).pipe(provide(directory)),
    ),
  )

  it.live("rejects an existing target when overwrite is not confirmed", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "分镜脚本.md"), "existing"))
        const service = yield* WorkArtifact.Service
        const failure = yield* service
          .apply({ sessionID, title: "x", relativePath: "分镜脚本.md", content: "new" })
          .pipe(Effect.flip)
        expect(failure._tag).toBe("WorkArtifact.Conflict")
      }).pipe(provide(directory)),
    ),
  )

  it.live("overwrites an existing target when overwrite is confirmed", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "分镜脚本.md"), "existing"))
        const service = yield* WorkArtifact.Service
        const result = yield* service.apply({
          sessionID,
          title: "x",
          relativePath: "分镜脚本.md",
          content: "new",
          overwrite: true,
        })
        expect(result.existed).toBe(true)
        expect(yield* Effect.promise(() => fs.readFile(path.join(directory, "分镜脚本.md"), "utf8"))).toBe("new")
      }).pipe(provide(directory)),
    ),
  )

  it.live("second concurrent apply without overwrite fails with conflict, not silent overwrite", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const service = yield* WorkArtifact.Service
        const input = { sessionID, title: "x", relativePath: "concurrent.md", content: "first" }
        const input2 = { sessionID, title: "x", relativePath: "concurrent.md", content: "second" }
        const results = yield* Effect.all(
          [service.apply(input).pipe(Effect.exit), service.apply(input2).pipe(Effect.exit)],
          { concurrency: 2 },
        )
        const successes = results.filter((r) => r._tag === "Success")
        const failures = results.filter((r) => r._tag === "Failure")
        expect(successes).toHaveLength(1)
        expect(failures).toHaveLength(1)
        // The failure must be a Conflict, not a silent overwrite.
        const failureCause = (failures[0] as { cause: unknown }).cause
        // Check that the cause contains Conflict
        const pretty = String(failureCause)
        expect(pretty).toContain("WorkArtifact.Conflict")
        const content = yield* Effect.promise(() => fs.readFile(path.join(directory, "concurrent.md"), "utf8"))
        expect(["first", "second"]).toContain(content)
      }).pipe(provide(directory)),
    ),
  )
})

describe("WorkArtifact durable authority", () => {
  it.live("AI-TDD-S06-R03/R06 persists only the binding before notification and preserves other metadata", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const observed: unknown[] = []
        const database = yield* Database.Service
        yield* (yield* EventV2.Service).listen(() =>
          stored.pipe(
            Effect.map((row) => {
              observed.push(row?.metadata?.workArtifact)
            }),
            Effect.provideService(Database.Service, database),
            Effect.orDie,
          ),
        )
        const result = yield* (yield* WorkArtifact.Service).apply(input)
        const binding = { artifact: result.artifact, revision: revision(input.content) }
        expect((yield* stored)?.metadata).toEqual({
          keep: { nested: "untouched" },
          permissionSentinel: false,
          workArtifact: binding,
        })
        expect(observed).toEqual([binding])
        expect(JSON.stringify(binding)).not.toContain('"content"')
      }).pipe(provide(directory)),
    ),
  )

  it.live("AI-TDD-S06-R07 reconstructs from the same SQLite and real file after closing the service scope", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const first = yield* Effect.gen(function* () {
          yield* seed
          return yield* (yield* WorkArtifact.Service).apply(input)
        }).pipe(Effect.provide(fixture(directory)), Effect.scoped)
        const restored = yield* Effect.gen(function* () {
          return yield* (yield* WorkArtifact.Service).get(sessionID)
        }).pipe(Effect.provide(fixture(directory)), Effect.scoped)
        expect(restored).toEqual({ artifact: first.artifact, revision: revision(input.content) })
      }),
    ),
  )

  it.live("AI-TDD-S06-R08 reads a changed file revision instead of the applied or persisted revision", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const artifacts = yield* WorkArtifact.Service
        const first = yield* artifacts.apply(input)
        yield* (yield* FSUtil.Service).writeFileString(path.join(directory, input.relativePath), "changed externally")
        expect(yield* artifacts.get(sessionID)).toEqual({
          artifact: first.artifact,
          revision: revision("changed externally"),
        })
        expect((yield* stored)?.metadata?.workArtifact).toEqual({
          artifact: first.artifact,
          revision: revision(input.content),
        })
      }).pipe(provide(directory)),
    ),
  )

  it.live("AI-TDD-S06-R08 a deleted bound file is unavailable, not an absent artifact", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const artifacts = yield* WorkArtifact.Service
        yield* artifacts.apply(input)
        yield* (yield* FSUtil.Service).remove(path.join(directory, input.relativePath))
        expect(failure(yield* artifacts.get(sessionID).pipe(Effect.exit))).toMatchObject({
          _tag: "WorkArtifact.Unavailable",
        })
      }).pipe(provide(directory)),
    ),
  )

  it.live("AI-TDD-S06-R08 rejects a bound symlink replaced with an out-of-scope target without leaking it", () =>
    withTmp((directory) =>
      withTmp((outside) =>
        Effect.gen(function* () {
          const artifacts = yield* WorkArtifact.Service
          const filesystem = yield* FSUtil.Service
          yield* artifacts.apply(input)
          yield* filesystem.writeFileString(path.join(outside, "private.md"), "private document body")
          yield* filesystem.remove(path.join(directory, input.relativePath))
          yield* filesystem.symlink(path.join(outside, "private.md"), path.join(directory, input.relativePath))
          const error = failure(yield* artifacts.get(sessionID).pipe(Effect.exit))
          expect(error).toMatchObject({ _tag: "WorkArtifact.Unavailable" })
          expect(String(error)).not.toContain(outside)
          expect(String(error)).not.toContain("private document body")
        }).pipe(provide(directory)),
      ),
    ),
  )

  it.live("AI-TDD-S06-R09 rejects missing Sessions before get or apply and leaves the filesystem untouched", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const artifacts = yield* WorkArtifact.Service
        const missing = SessionV2.ID.make("ses_artifact_missing")
        expect(failure(yield* artifacts.get(missing).pipe(Effect.exit))).toMatchObject({
          _tag: "WorkArtifact.NotFound",
        })
        expect(failure(yield* artifacts.apply({ ...input, sessionID: missing }).pipe(Effect.exit))).toMatchObject({
          _tag: "WorkArtifact.NotFound",
        })
        expect(yield* (yield* FSUtil.Service).exists(path.join(directory, input.relativePath))).toBe(false)
      }).pipe(provide(directory)),
    ),
  )
  ;[
    { name: "Mode", change: sql`mode = 'coding'` },
    { name: "directory", change: sql`directory = '/a-different-session-location'` },
    { name: "workspace", change: sql`workspace_id = 'wrk_other_artifact_workspace'` },
  ].forEach((scope) => {
    it.live(`AI-TDD-S06-R09 rejects an exact ${scope.name} scope mismatch for get and apply`, () =>
      withTmp((directory) =>
        Effect.gen(function* () {
          const artifacts = yield* WorkArtifact.Service
          yield* (yield* Database.Service).db.run(sql`UPDATE session SET ${scope.change} WHERE id = ${sessionID}`)
          expect(failure(yield* artifacts.get(sessionID).pipe(Effect.exit))).toMatchObject({
            _tag: "WorkArtifact.Scope",
          })
          expect(failure(yield* artifacts.apply(input).pipe(Effect.exit))).toMatchObject({
            _tag: "WorkArtifact.Scope",
          })
          expect(yield* (yield* FSUtil.Service).exists(path.join(directory, input.relativePath))).toBe(false)
        }).pipe(provide(directory)),
      ),
    )
  })
  ;[
    { name: "null", binding: null },
    { name: "partial", binding: { artifact: { id: "art_incomplete" } } },
    { name: "legacy body", binding: { relativePath: input.relativePath, content: input.content } },
  ].forEach((item) => {
    it.live(`AI-TDD-S06-R09 rejects a ${item.name} binding instead of synthesizing or returning none`, () =>
      withTmp((directory) =>
        Effect.gen(function* () {
          const artifacts = yield* WorkArtifact.Service
          yield* (yield* Database.Service).db
            .update(SessionTable)
            .set({
              metadata: { workArtifact: item.binding },
            })
            .where(eq(SessionTable.id, sessionID))
          expect(failure(yield* artifacts.get(sessionID).pipe(Effect.exit))).toMatchObject({
            _tag: "WorkArtifact.Unavailable",
          })
        }).pipe(provide(directory)),
      ),
    )
  })

  it.live("AI-TDD-S06-R09 refuses a binding owned by another Session even when its path exists", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const artifacts = yield* WorkArtifact.Service
        const first = yield* artifacts.apply(input)
        yield* (yield* Database.Service).db
          .update(SessionTable)
          .set({
            metadata: {
              workArtifact: {
                artifact: { ...first.artifact, sessionID: "ses_foreign_artifact" },
                revision: revision(input.content),
              },
            },
          })
          .where(eq(SessionTable.id, sessionID))
        expect(failure(yield* artifacts.get(sessionID).pipe(Effect.exit))).toMatchObject({
          _tag: "WorkArtifact.Unavailable",
        })
      }).pipe(provide(directory)),
    ),
  )

  it.live("AI-TDD-S06-R06 a DB bind failure leaves an explicit unbound file without publishing success", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const artifacts = yield* WorkArtifact.Service
        const notifications: string[] = []
        yield* (yield* EventV2.Service).listen((event) =>
          Effect.sync(() => {
            notifications.push(event.type)
          }),
        )
        yield* (yield* Database.Service).db.run(sql`
          CREATE TRIGGER fail_artifact_binding BEFORE UPDATE OF metadata ON session
          BEGIN SELECT RAISE(FAIL, 'private database diagnostic'); END
        `)
        const error = failure(yield* artifacts.apply(input).pipe(Effect.exit))
        expect(error).toMatchObject({ _tag: "WorkArtifact.Storage", phase: "bind" })
        expect(String(error)).not.toContain("private database diagnostic")
        expect(yield* (yield* FSUtil.Service).readFileString(path.join(directory, input.relativePath))).toBe(
          input.content,
        )
        expect((yield* stored)?.metadata?.workArtifact).toBeUndefined()
        expect(yield* artifacts.get(sessionID)).toBeUndefined()
        expect(notifications).toEqual([])
      }).pipe(provide(directory)),
    ),
  )

  it.live("AI-TDD-S06-R06 failed replacement binding still reads the real changed bytes under the old identity", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const artifacts = yield* WorkArtifact.Service
        const first = yield* artifacts.apply(input)
        yield* (yield* Database.Service).db.run(sql`
          CREATE TRIGGER fail_artifact_rebinding BEFORE UPDATE OF metadata ON session
          BEGIN SELECT RAISE(FAIL, 'reject rebinding'); END
        `)
        expect(
          failure(
            yield* artifacts.apply({ ...input, content: "unbound replacement", overwrite: true }).pipe(Effect.exit),
          ),
        ).toMatchObject({ _tag: "WorkArtifact.Storage", phase: "bind" })
        expect(yield* artifacts.get(sessionID)).toEqual({
          artifact: first.artifact,
          revision: revision("unbound replacement"),
        })
        expect((yield* stored)?.metadata?.workArtifact).toEqual({
          artifact: first.artifact,
          revision: revision(input.content),
        })
      }).pipe(provide(directory)),
    ),
  )

  it.live("AI-TDD-S06-R06 notification failure is typed and the committed binding remains recoverable", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const artifacts = yield* WorkArtifact.Service
        yield* (yield* EventV2.Service).listen(() => Effect.die(new Error("private notification payload")))
        const error = failure(yield* artifacts.apply(input).pipe(Effect.exit))
        expect(error).toMatchObject({ _tag: "WorkArtifact.Storage", phase: "publish" })
        expect(String(error)).not.toContain("private notification payload")
        expect(yield* artifacts.get(sessionID)).toEqual(
          Schema.decodeUnknownSync(WorkArtifact.ArtifactSnapshot)((yield* stored)?.metadata?.workArtifact),
        )
        expect((yield* artifacts.get(sessionID))?.revision).toBe(revision(input.content))
      }).pipe(provide(directory)),
    ),
  )

  it.live("AI-TDD-S06-R14 reapplying identical content persists a new identity, never just the old hash", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const artifacts = yield* WorkArtifact.Service
        const first = yield* artifacts.apply(input)
        const second = yield* artifacts.apply({ ...input, overwrite: true })
        expect(second.artifact.id).not.toBe(first.artifact.id)
        expect(yield* artifacts.get(sessionID)).toEqual({
          artifact: second.artifact,
          revision: revision(input.content),
        })
        expect((yield* stored)?.metadata?.workArtifact).toEqual({
          artifact: second.artifact,
          revision: revision(input.content),
        })
      }).pipe(provide(directory)),
    ),
  )
})

describe("WorkArtifact.withCurrent coordination", () => {
  it.live("AI-TDD-S06-R16 rejects changed bytes after use instead of returning a successful approval", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const artifacts = yield* WorkArtifact.Service
        yield* artifacts.apply(input)
        const filesystem = yield* FSUtil.Service
        const result = yield* artifacts
          .withCurrent(sessionID, () =>
            filesystem
              .writeFileString(path.join(directory, input.relativePath), "changed during use")
              .pipe(Effect.as("approved")),
          )
          .pipe(Effect.exit)
        expect(failure(result)).toMatchObject({ _tag: "WorkArtifact.Conflict" })
        expect((yield* artifacts.get(sessionID))?.revision).toBe(revision("changed during use"))
      }).pipe(provide(directory)),
    ),
  )

  it.live("AI-TDD-S06-R16 rejects a same-content identity change made during use", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const artifacts = yield* WorkArtifact.Service
        const first = yield* artifacts.apply(input)
        const db = (yield* Database.Service).db
        const result = yield* artifacts
          .withCurrent(sessionID, () =>
            db
              .update(SessionTable)
              .set({
                metadata: {
                  workArtifact: {
                    artifact: { ...first.artifact, id: "art_changed_during_use" },
                    revision: revision(input.content),
                  },
                },
              })
              .where(eq(SessionTable.id, sessionID))
              .pipe(Effect.as("approved")),
          )
          .pipe(Effect.exit)
        expect(failure(result)).toMatchObject({ _tag: "WorkArtifact.Conflict" })
        expect((yield* artifacts.get(sessionID))?.artifact.id).toBe("art_changed_during_use")
      }).pipe(provide(directory)),
    ),
  )

  it.live("AI-TDD-S06-R16 a file disappearing after use propagates Unavailable", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const artifacts = yield* WorkArtifact.Service
        yield* artifacts.apply(input)
        const filesystem = yield* FSUtil.Service
        expect(
          failure(
            yield* artifacts
              .withCurrent(sessionID, () =>
                filesystem.remove(path.join(directory, input.relativePath)).pipe(Effect.as("approved")),
              )
              .pipe(Effect.exit),
          ),
        ).toMatchObject({ _tag: "WorkArtifact.Unavailable" })
      }).pipe(provide(directory)),
    ),
  )

  it.live("AI-TDD-S06-R16 corrupting the binding after use cannot be reported as success", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const artifacts = yield* WorkArtifact.Service
        yield* artifacts.apply(input)
        const db = (yield* Database.Service).db
        expect(
          failure(
            yield* artifacts
              .withCurrent(sessionID, () =>
                db
                  .update(SessionTable)
                  .set({ metadata: { workArtifact: null } })
                  .where(eq(SessionTable.id, sessionID))
                  .pipe(Effect.as("approved")),
              )
              .pipe(Effect.exit),
          ),
        ).toMatchObject({ _tag: "WorkArtifact.Unavailable" })
      }).pipe(provide(directory)),
    ),
  )

  it.live("AI-TDD-S06-R16 propagates callback errors and releases coordination for the next apply", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const artifacts = yield* WorkArtifact.Service
        yield* artifacts.apply(input)
        expect(
          failure(yield* artifacts.withCurrent(sessionID, () => Effect.fail("callback rejected")).pipe(Effect.exit)),
        ).toBe("callback rejected")
        const next = yield* awaitWithTimeout(
          artifacts.apply({ ...input, content: "after failed use", overwrite: true }),
          "Artifact coordination was not released after a failed callback",
        )
        expect((yield* artifacts.get(sessionID))?.artifact.id).toBe(next.artifact.id)
      }).pipe(provide(directory)),
    ),
  )

  it.live("AI-TDD-S06-R16 another service cannot approve the old pointer while apply has written but not bound", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const filesystem = yield* FSUtil.Service
        const written = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const attempted = yield* Deferred.make<void>()
        const heldFilesystem = Layer.succeed(FSUtil.Service, {
          ...filesystem,
          rename: (from, to) =>
            filesystem
              .rename(from, to)
              .pipe(
                Effect.andThen(
                  to === path.join(directory, input.relativePath)
                    ? Deferred.succeed(written, undefined).pipe(Effect.andThen(Deferred.await(release)))
                    : Effect.void,
                ),
              ),
        })
        return yield* Effect.gen(function* () {
          yield* seed
          const artifacts = yield* WorkArtifact.Service
          yield* artifacts.apply(input)
          const context = yield* Effect.context<
            | Database.Service
            | Location.Service
            | LocationMutation.Service
            | FileMutation.Service
            | FSUtil.Service
            | EventV2.Service
          >()
          const other = Context.get(
            yield* Layer.build(Layer.fresh(WorkArtifact.layer)).pipe(Effect.provide(context)),
            WorkArtifact.Service,
          )
          const scope = yield* Effect.scope
          const applying = yield* artifacts
            .apply({ ...input, content: "replacement", overwrite: true })
            .pipe(Effect.exit, Effect.forkIn(scope))
          const reviewing = yield* Effect.gen(function* () {
            yield* awaitWithTimeout(Deferred.await(written), "Replacement file was not written")
            const reviewing = yield* Deferred.succeed(attempted, undefined).pipe(
              Effect.andThen(other.withCurrent(sessionID, Effect.succeed)),
              Effect.exit,
              Effect.forkIn(scope),
            )
            yield* awaitWithTimeout(Deferred.await(attempted), "Review did not start")
            return reviewing
          }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)))
          const applied = yield* Fiber.join(applying)
          const reviewed = yield* Fiber.join(reviewing)
          expect(Exit.isSuccess(applied)).toBe(true)
          if (Exit.isFailure(applied)) throw failure(applied)
          if (Exit.isFailure(reviewed)) {
            expect(failure(reviewed)).toMatchObject({ _tag: "WorkArtifact.Conflict" })
            return
          }
          expect(reviewed.value?.artifact.id).toBe(applied.value.artifact.id)
          expect(reviewed.value?.revision).toBe(revision("replacement"))
        }).pipe(Effect.provide(fixture(directory, heldFilesystem)))
      }),
    ),
  )
})
