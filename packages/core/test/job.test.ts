import { describe, expect } from "bun:test"
import { Job } from "@aigcfroge/core/job"
import { KV } from "@aigcfroge/core/kv"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { Integration } from "@aigcfroge/core/integration"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Cause, Deferred, Effect, Exit, Fiber, Scope } from "effect"
import { SessionSchema } from "@aigcfroge/core/session/schema"
import { awaitWithTimeout, testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Job.node, KV.node])))

describe("Job", () => {
  it.live("tracks process-local work through explicit observation", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const latch = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        id: "job_metadata",
        type: "test",
        metadata: { durable: false },
        run: Deferred.await(latch).pipe(Effect.as("done")),
      })

      expect(job).toMatchObject({ type: "test", status: "running", metadata: { durable: false } })
      expect(yield* jobs.wait({ id: job.id, timeout: 0 })).toMatchObject({
        timedOut: true,
        info: { status: "running" },
      })

      yield* Deferred.succeed(latch, undefined)
      expect(yield* jobs.wait({ id: job.id })).toMatchObject({
        timedOut: false,
        info: { status: "completed", output: "done" },
      })
    }),
  )

  it.live("publishes jobs before starting immediately settling work", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service

      yield* Effect.forEach(Array.from({ length: 100 }), (_, index) => {
        const id = `job_immediate_start_${index}`
        return Effect.gen(function* () {
          const job = yield* jobs.start({
            id,
            type: "test",
            run: jobs
              .get(id)
              .pipe(
                Effect.flatMap((info) =>
                  info?.status === "running"
                    ? Effect.succeed(`done-${index}`)
                    : Effect.fail("job started before publish"),
                ),
              ),
          })

          expect(yield* jobs.wait({ id: job.id })).toMatchObject({
            timedOut: false,
            info: { status: "completed", output: `done-${index}` },
          })
        })
      })
    }),
  )

  it.live("preserves authorization and complete failure details without stacks", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const job = yield* jobs.start({
        id: "job_failure",
        type: "test",
        run: Effect.failCause(
          Cause.combine(
            Cause.fail(
              new Integration.AuthorizationError({
                cause: new Error("authorization failed", { cause: new Error("token expired") }),
              }),
            ),
            Cause.die({ code: "cleanup_failed" }),
          ),
        ),
      })

      expect((yield* jobs.wait({ id: job.id })).info).toMatchObject({
        status: "error",
        error: 'authorization failed\nCaused by: token expired\n{"code":"cleanup_failed"}',
      })
    }),
  )

  it.live("reuses running work when started again with the same ID", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const output = yield* Deferred.make<string>()
      const job = yield* jobs.start({ id: "job_reused", type: "test", run: Deferred.await(output) })

      expect(
        yield* jobs.start({ id: job.id, type: "duplicate", run: Effect.die(new Error("Duplicate work must not run")) }),
      ).toEqual(job)

      yield* Deferred.succeed(output, "original output")
      expect((yield* jobs.wait({ id: job.id })).info).toMatchObject({
        type: "test",
        status: "completed",
        output: "original output",
      })
    }),
  )

  it.live("ignores an obsolete callback after a cancellation waiter starts a same-ID replacement", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const callback = yield* Deferred.make<() => void>()
      const output = yield* Deferred.make<string>()
      const finalized = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        id: "job_replaced",
        type: "test",
        run: Effect.callback<string>((resume) => {
          Deferred.doneUnsafe(
            callback,
            Effect.succeed(() => resume(Effect.succeed("obsolete output"))),
          )
        }),
      })
      const complete = yield* Deferred.await(callback)
      // Cancellation wakes waiters before closing the old scope, allowing the old callback to race replacement.
      const replacement = yield* jobs.wait({ id: job.id }).pipe(
        Effect.tap((result) => Effect.sync(() => expect(result.info?.status).toBe("cancelled"))),
        Effect.andThen(
          jobs.start({
            id: job.id,
            type: "replacement",
            run: Deferred.await(output).pipe(Effect.ensuring(Deferred.succeed(finalized, undefined))),
          }),
        ),
        Effect.andThen(Effect.sync(complete)),
        Effect.forkChild({ startImmediately: true }),
      )

      yield* jobs.cancel(job.id)
      yield* Fiber.join(replacement)
      expect(yield* jobs.get(job.id)).toMatchObject({ type: "replacement", status: "running" })
      expect(yield* Deferred.isDone(finalized)).toBe(false)

      yield* Deferred.succeed(output, "replacement output")
      expect((yield* jobs.wait({ id: job.id })).info).toMatchObject({
        type: "replacement",
        status: "completed",
        output: "replacement output",
      })
      expect(yield* Deferred.isDone(finalized)).toBe(true)
    }),
  )

  it.live("stops a session producer before rescanning steps created by its finalizer", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const parent = SessionSchema.ID.make("ses_remove_parent")
      const other = SessionSchema.ID.make("ses_remove_other")
      const ready = yield* Deferred.make<void>()
      const lateReady = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const stopped: string[] = []
      yield* jobs.start({
        id: "workflow_existing_step",
        type: "workflow_step",
        metadata: { sessionID: parent, childSessionID: "ses_existing_child" },
        run: Deferred.await(release).pipe(
          Effect.as("existing"),
          Effect.ensuring(Effect.sync(() => stopped.push("existing"))),
        ),
      })
      const unrelated = yield* jobs.start({
        id: "workflow_other_session",
        type: "workflow",
        metadata: { sessionID: other },
        run: Deferred.await(release).pipe(Effect.as("other")),
      })
      yield* jobs.start({
        id: "workflow_producer",
        type: "workflow",
        metadata: { sessionID: parent },
        run: Deferred.succeed(ready, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.as("producer"),
          Effect.ensuring(
            Effect.gen(function* () {
              yield* jobs.start({
                id: "workflow_late_step",
                type: "workflow_step",
                metadata: { sessionID: parent, childSessionID: "ses_late_child" },
                // The producer's finalizer is uninterruptible; the newly registered work must remain cancellable.
                run: Deferred.succeed(lateReady, undefined).pipe(
                  Effect.andThen(Deferred.await(release)),
                  Effect.as("late"),
                  Effect.interruptible,
                  Effect.ensuring(Effect.sync(() => stopped.push("late"))),
                ),
              })
              yield* Deferred.await(lateReady)
              stopped.push("producer")
            }),
          ),
        ),
      })
      yield* awaitWithTimeout(Deferred.await(ready), "Producer did not start")
      yield* awaitWithTimeout(jobs.cancelAllForSession(parent), "Session jobs did not stop after producer cleanup")
      expect(stopped).toEqual(["producer", "existing", "late"])
      expect((yield* jobs.get("workflow_producer"))?.status).toBe("cancelled")
      expect((yield* jobs.get("workflow_existing_step"))?.status).toBe("cancelled")
      expect((yield* jobs.get("workflow_late_step"))?.status).toBe("cancelled")
      expect((yield* jobs.get(unrelated.id))?.status).toBe("running")
      yield* Deferred.succeed(release, undefined)
      expect((yield* jobs.wait({ id: unrelated.id })).info?.output).toBe("other")
    }),
  )

  it.live("joins an already cancelling producer before rescanning its late steps", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const sessionID = SessionSchema.ID.make("ses_join_cleanup")
      const ready = yield* Deferred.make<void>()
      const cleanupStarted = yield* Deferred.make<void>()
      const cleanupRelease = yield* Deferred.make<void>()
      const lateReady = yield* Deferred.make<void>()
      const lateStopped = yield* Deferred.make<void>()
      const removalDone = yield* Deferred.make<void>()
      yield* Effect.gen(function* () {
        yield* jobs.start({
          id: "workflow_join_producer",
          type: "workflow",
          metadata: { sessionID },
          run: Deferred.succeed(ready, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(
              Effect.gen(function* () {
                yield* Deferred.succeed(cleanupStarted, undefined)
                yield* Deferred.await(cleanupRelease)
                yield* jobs.start({
                  id: "workflow_join_late_step",
                  type: "workflow_step",
                  metadata: { sessionID, childSessionID: "ses_join_late_child" },
                  run: Deferred.succeed(lateReady, undefined).pipe(
                    Effect.andThen(Effect.never),
                    Effect.interruptible,
                    Effect.ensuring(Deferred.succeed(lateStopped, undefined)),
                  ),
                })
                yield* Deferred.await(lateReady)
              }),
            ),
          ),
        })
        yield* awaitWithTimeout(Deferred.await(ready), "Producer did not start")
        const scope = yield* Effect.scope
        const cancelling = yield* jobs
          .cancel("workflow_join_producer")
          .pipe(Effect.forkIn(scope, { startImmediately: true }))
        yield* awaitWithTimeout(Deferred.await(cleanupStarted), "Producer cleanup did not start")
        const removing = yield* jobs
          .cancelAllForSession(sessionID)
          .pipe(
            Effect.andThen(Deferred.succeed(removalDone, undefined)),
            Effect.forkIn(scope, { startImmediately: true }),
          )
        const returnedBeforeCleanup = yield* Deferred.isDone(removalDone)
        yield* Deferred.succeed(cleanupRelease, undefined)
        yield* awaitWithTimeout(
          Effect.all([Fiber.join(cancelling), Fiber.join(removing)]),
          "Session deletion did not join the cancelling producer",
        )
        expect(returnedBeforeCleanup).toBe(false)
        expect(yield* Deferred.isDone(lateStopped)).toBe(true)
        expect((yield* jobs.get("workflow_join_late_step"))?.status).toBe("cancelled")
      }).pipe(Effect.ensuring(Deferred.succeed(cleanupRelease, undefined)))
    }),
  )

  it.live("cancels only the selected child metadata without adopting blocking or recovery ownership", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const parent = SessionSchema.ID.make("ses_child_parent")
      const child = SessionSchema.ID.make("ses_selected_child")
      const sibling = SessionSchema.ID.make("ses_sibling_child")
      const other = SessionSchema.ID.make("ses_unrelated_owner")
      const release = yield* Deferred.make<void>()
      const selectedStopped = yield* Deferred.make<void>()
      const blockDone = yield* Deferred.make<void>()
      yield* jobs.start({
        id: "workflow_child_parent",
        type: "workflow",
        metadata: { sessionID: parent },
        run: Deferred.await(release).pipe(Effect.as("parent")),
      })
      yield* jobs.start({
        id: "workflow_selected_child",
        type: "workflow_step",
        metadata: { sessionID: parent, childSessionID: child },
        run: Deferred.await(release).pipe(
          Effect.as("selected"),
          Effect.ensuring(Deferred.succeed(selectedStopped, undefined)),
        ),
      })
      yield* jobs.start({
        id: "workflow_sibling_child",
        type: "workflow_step",
        metadata: { sessionID: parent, childSessionID: sibling },
        run: Deferred.await(release).pipe(Effect.as("sibling")),
      })
      yield* jobs.start({
        id: "workflow_unrelated",
        type: "workflow",
        metadata: { sessionID: other },
        run: Deferred.await(release).pipe(Effect.as("other")),
      })
      const recoverable = yield* jobs.start({
        id: "workflow_recovery_only",
        type: "subagent",
        recovery: {
          kind: "subagent",
          parentSessionID: parent,
          childSessionID: child,
          agent: "build",
          description: "Legacy owner",
        },
        run: Deferred.await(release).pipe(Effect.as("recoverable")),
      })
      const blocked = yield* jobs.block({ id: recoverable.id, sessionID: child }).pipe(
        Effect.tap(() => Deferred.succeed(blockDone, undefined)),
        Effect.forkIn(yield* Effect.scope, { startImmediately: true }),
      )
      yield* awaitWithTimeout(jobs.cancelAllForSession(child), "Child job did not stop")
      expect(yield* Deferred.isDone(selectedStopped)).toBe(true)
      expect((yield* jobs.get("workflow_selected_child"))?.status).toBe("cancelled")
      expect((yield* jobs.get("workflow_child_parent"))?.status).toBe("running")
      expect((yield* jobs.get("workflow_sibling_child"))?.status).toBe("running")
      expect((yield* jobs.get("workflow_unrelated"))?.status).toBe("running")
      expect((yield* jobs.get(recoverable.id))?.status).toBe("running")
      expect(yield* Deferred.isDone(blockDone)).toBe(false)
      yield* Deferred.succeed(release, undefined)
      expect(yield* Fiber.join(blocked)).toMatchObject({ type: "finished", info: { status: "completed" } })
    }),
  )

  it.live("preserves a foreign same-ID replacement encountered by an owned cancellation snapshot", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const parent = SessionSchema.ID.make("ses_snapshot_owner")
      const other = SessionSchema.ID.make("ses_replacement_owner")
      const release = yield* Deferred.make<void>()
      const replacementReady = yield* Deferred.make<void>()
      const replacementStopped = yield* Deferred.make<void>()
      const originalStopped = yield* Deferred.make<void>()
      yield* jobs.start({
        id: "snapshot_first",
        type: "workflow_step",
        metadata: { sessionID: parent, childSessionID: "ses_snapshot_first" },
        run: Deferred.await(release).pipe(
          Effect.as("first"),
          Effect.ensuring(
            Effect.gen(function* () {
              yield* jobs.cancel("snapshot_replaced")
              yield* jobs.start({
                id: "snapshot_replaced",
                type: "workflow_step",
                metadata: { sessionID: other, childSessionID: "ses_foreign_replacement" },
                run: Deferred.succeed(replacementReady, undefined).pipe(
                  Effect.andThen(Deferred.await(release)),
                  Effect.as("foreign"),
                  Effect.interruptible,
                  Effect.ensuring(Deferred.succeed(replacementStopped, undefined)),
                ),
              })
              yield* Deferred.await(replacementReady)
            }),
          ),
        ),
      })
      yield* jobs.start({
        id: "snapshot_replaced",
        type: "workflow_step",
        metadata: { sessionID: parent, childSessionID: "ses_snapshot_second" },
        run: Deferred.await(release).pipe(
          Effect.as("original"),
          Effect.ensuring(Deferred.succeed(originalStopped, undefined)),
        ),
      })
      yield* awaitWithTimeout(jobs.cancelAllForSession(parent), "Snapshot cancellation did not finish")
      expect(yield* Deferred.isDone(originalStopped)).toBe(true)
      expect(yield* Deferred.isDone(replacementStopped)).toBe(false)
      expect(yield* jobs.get("snapshot_replaced")).toMatchObject({
        status: "running",
        metadata: { sessionID: other },
      })
      yield* Deferred.succeed(release, undefined)
      expect((yield* jobs.wait({ id: "snapshot_replaced" })).info?.output).toBe("foreign")
    }),
  )

  it.live("rejects owned starts during a deletion lease without replacing existing running work", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const sessionID = SessionSchema.ID.make("ses_delete_fence")
      const other = SessionSchema.ID.make("ses_delete_fence_other")
      const ready = yield* Deferred.make<void>()
      const originalStopped = yield* Deferred.make<void>()
      const ran: string[] = []
      yield* jobs.start({
        id: "deletion_existing",
        type: "original",
        metadata: { sessionID },
        run: Deferred.succeed(ready, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(Deferred.succeed(originalStopped, undefined)),
        ),
      })
      yield* awaitWithTimeout(Deferred.await(ready), "Existing producer did not start")
      expect(
        yield* jobs.withSessionDeletion(
          sessionID,
          Effect.gen(function* () {
            expect(yield* jobs.isDeletingSession(sessionID)).toBe(true)
            const duplicate = yield* jobs.start({
              id: "deletion_existing",
              type: "replacement",
              metadata: { sessionID },
              run: Effect.sync(() => {
                ran.push("duplicate")
                return "duplicate"
              }),
            })
            expect(duplicate).toMatchObject({ status: "cancelled", error: "Session deletion in progress" })
            expect(yield* jobs.get(duplicate.id)).toMatchObject({ status: "running", type: "original" })
            const root = yield* jobs.start({
              id: "deletion_new_root",
              type: "workflow",
              metadata: { sessionID },
              run: Effect.sync(() => {
                ran.push("root")
                return "root"
              }),
            })
            const child = yield* jobs.start({
              id: "deletion_child_owner",
              type: "workflow_step",
              metadata: { sessionID: other, childSessionID: sessionID },
              run: Effect.sync(() => {
                ran.push("child")
                return "child"
              }),
            })
            expect(root.status).toBe("cancelled")
            expect(child.status).toBe("cancelled")
            expect((yield* jobs.wait({ id: child.id })).info?.status).toBe("cancelled")
            expect((yield* jobs.wait({ id: root.id })).info?.status).toBe("cancelled")
            const unowned = yield* jobs.start({
              id: "deletion_other_owner",
              type: "workflow",
              metadata: { sessionID: other },
              run: Effect.succeed("other"),
            })
            expect((yield* jobs.wait({ id: unowned.id })).info?.output).toBe("other")
            yield* awaitWithTimeout(jobs.cancelAllForSession(sessionID), "Deletion cancelled its own lease")
            expect(yield* jobs.isDeletingSession(sessionID)).toBe(true)
            expect(yield* Deferred.isDone(originalStopped)).toBe(true)
            expect(ran).toEqual([])
            return "deleted"
          }),
        ),
      ).toBe("deleted")
      expect(yield* jobs.isDeletingSession(sessionID)).toBe(false)
      const resumed = yield* jobs.start({
        id: "deletion_after_release",
        type: "workflow",
        metadata: { sessionID },
        run: Effect.succeed("available"),
      })
      expect((yield* jobs.wait({ id: resumed.id })).info?.output).toBe("available")
    }),
  )

  it.live("refuses finalizer-created steps immediately while a deletion lease is held", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const sessionID = SessionSchema.ID.make("ses_delete_finalizer")
      const ready = yield* Deferred.make<void>()
      const finalized = yield* Deferred.make<void>()
      const ran = yield* Deferred.make<void>()
      yield* jobs.start({
        id: "deletion_finalizer_producer",
        type: "workflow",
        metadata: { sessionID },
        run: Deferred.succeed(ready, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(
            Effect.gen(function* () {
              const refused = yield* jobs.start({
                id: "deletion_finalizer_step",
                type: "workflow_step",
                metadata: { sessionID, childSessionID: "ses_delete_late_child" },
                run: Deferred.succeed(ran, undefined).pipe(Effect.as("must not run")),
              })
              expect(refused.status).toBe("cancelled")
              expect((yield* jobs.wait({ id: refused.id })).info?.status).toBe("cancelled")
              yield* Deferred.succeed(finalized, undefined)
            }),
          ),
        ),
      })
      yield* awaitWithTimeout(Deferred.await(ready), "Producer did not reach its active boundary")
      yield* awaitWithTimeout(
        jobs.withSessionDeletion(sessionID, jobs.cancelAllForSession(sessionID)),
        "The deletion lease blocked its producer finalizer",
      )
      expect(yield* Deferred.isDone(finalized)).toBe(true)
      expect(yield* Deferred.isDone(ran)).toBe(false)
      expect(yield* jobs.isDeletingSession(sessionID)).toBe(false)
    }),
  )

  it.live("keeps concurrent deletion references fenced until the last caller exits", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const sessionID = SessionSchema.ID.make("ses_delete_shared")
      const firstReady = yield* Deferred.make<void>()
      const secondReady = yield* Deferred.make<void>()
      const firstRelease = yield* Deferred.make<void>()
      const secondRelease = yield* Deferred.make<void>()
      const ran = yield* Deferred.make<void>()
      yield* Effect.gen(function* () {
        const scope = yield* Effect.scope
        const first = yield* jobs
          .withSessionDeletion(
            sessionID,
            Deferred.succeed(firstReady, undefined).pipe(
              Effect.andThen(Deferred.await(firstRelease)),
              Effect.as("first"),
            ),
          )
          .pipe(Effect.forkIn(scope, { startImmediately: true }))
        yield* awaitWithTimeout(Deferred.await(firstReady), "First deletion lease did not open")
        const second = yield* jobs
          .withSessionDeletion(
            sessionID,
            Deferred.succeed(secondReady, undefined).pipe(
              Effect.andThen(Deferred.await(secondRelease)),
              Effect.as("second"),
            ),
          )
          .pipe(Effect.forkIn(scope, { startImmediately: true }))
        yield* awaitWithTimeout(Deferred.await(secondReady), "Second deletion lease did not open")
        yield* Deferred.succeed(firstRelease, undefined)
        expect(yield* Fiber.join(first)).toBe("first")
        expect(yield* jobs.isDeletingSession(sessionID)).toBe(true)
        const rejected = yield* jobs.start({
          id: "deletion_reference_guard",
          type: "workflow",
          metadata: { sessionID },
          run: Deferred.succeed(ran, undefined).pipe(Effect.as("must not run")),
        })
        expect(rejected.status).toBe("cancelled")
        expect(yield* Deferred.isDone(ran)).toBe(false)
        yield* Deferred.succeed(secondRelease, undefined)
        expect(yield* Fiber.join(second)).toBe("second")
        expect(yield* jobs.isDeletingSession(sessionID)).toBe(false)
      }).pipe(
        Effect.ensuring(
          Deferred.succeed(firstRelease, undefined).pipe(Effect.andThen(Deferred.succeed(secondRelease, undefined))),
        ),
      )
    }),
  )

  it.live("releases deletion leases after failure and interruption", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const sessionID = SessionSchema.ID.make("ses_delete_exit")
      const failed = yield* jobs.withSessionDeletion(sessionID, Effect.fail("delete failed")).pipe(Effect.exit)
      expect(Exit.isFailure(failed)).toBe(true)
      expect(yield* jobs.isDeletingSession(sessionID)).toBe(false)
      const ready = yield* Deferred.make<void>()
      const removing = yield* jobs
        .withSessionDeletion(sessionID, Deferred.succeed(ready, undefined).pipe(Effect.andThen(Effect.never)))
        .pipe(Effect.forkIn(yield* Effect.scope, { startImmediately: true }))
      yield* awaitWithTimeout(Deferred.await(ready), "Interrupted deletion lease did not open")
      yield* Fiber.interrupt(removing)
      expect(yield* jobs.isDeletingSession(sessionID)).toBe(false)
    }),
  )

  it.live("rejects starts in an already closed registry without hanging on the stopped signal", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const jobs = yield* Job.make.pipe(Scope.provide(scope))
      const sessionID = SessionSchema.ID.make("ses_closed_registry")
      const ran = yield* Deferred.make<void>()
      yield* Scope.close(scope, Exit.void)
      const rejected = yield* jobs.start({
        id: "closed_registry_start",
        type: "workflow",
        metadata: { sessionID },
        run: Deferred.succeed(ran, undefined).pipe(Effect.as("must not run")),
      })
      expect(rejected).toMatchObject({ status: "cancelled", error: "Job registry scope is closed" })
      yield* awaitWithTimeout(jobs.cancelAllForSession(sessionID), "Closed-scope stopped signal was never settled")
      expect(yield* Deferred.isDone(ran)).toBe(false)
      expect((yield* jobs.wait({ id: rejected.id })).info?.status).toBe("cancelled")
    }),
  )

  it.live("returns finished from a blocking wait when completion wins", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const latch = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        id: "job_finished",
        type: "test",
        run: Deferred.await(latch).pipe(Effect.as("done")),
      })
      const waiting = yield* jobs
        .block({ id: job.id, sessionID: SessionSchema.ID.make("ses_parent") })
        .pipe(Effect.forkIn(yield* Scope.Scope, { startImmediately: true }))

      yield* Deferred.succeed(latch, undefined)

      expect(yield* Fiber.join(waiting)).toMatchObject({
        type: "finished",
        info: { status: "completed", output: "done" },
      })
      expect(yield* jobs.background(job.id)).toBeUndefined()
    }),
  )

  it.live("returns backgrounded from a blocking wait when background wins", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const latch = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        id: "job_backgrounded",
        type: "test",
        run: Deferred.await(latch).pipe(Effect.as("done")),
      })
      const waiting = yield* jobs
        .block({ id: job.id, sessionID: SessionSchema.ID.make("ses_parent") })
        .pipe(Effect.forkIn(yield* Scope.Scope, { startImmediately: true }))

      expect(yield* jobs.background(job.id)).toMatchObject({ id: job.id, status: "running" })
      expect(yield* Fiber.join(waiting)).toMatchObject({
        type: "backgrounded",
        info: { id: job.id, status: "running" },
      })

      yield* Deferred.succeed(latch, undefined)
      expect(yield* jobs.wait({ id: job.id })).toMatchObject({
        timedOut: false,
        info: { status: "completed", output: "done" },
      })
    }),
  )

  it.live("backgrounds only jobs actively blocking a session", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const parent = SessionSchema.ID.make("ses_parent")
      const other = SessionSchema.ID.make("ses_other")
      const latch = yield* Deferred.make<void>()
      const first = yield* jobs.start({
        id: "job_first",
        type: "test",
        run: Deferred.await(latch).pipe(Effect.as("first")),
      })
      const second = yield* jobs.start({
        id: "job_second",
        type: "test",
        run: Deferred.await(latch).pipe(Effect.as("second")),
      })
      const third = yield* jobs.start({
        id: "job_third",
        type: "other",
        run: Deferred.await(latch).pipe(Effect.as("third")),
      })
      const scope = yield* Scope.Scope
      const firstWait = yield* jobs
        .block({ id: first.id, sessionID: parent })
        .pipe(Effect.forkIn(scope, { startImmediately: true }))
      const secondWait = yield* jobs
        .block({ id: second.id, sessionID: other })
        .pipe(Effect.forkIn(scope, { startImmediately: true }))
      const thirdWait = yield* jobs
        .block({ id: third.id, sessionID: parent })
        .pipe(Effect.forkIn(scope, { startImmediately: true }))

      expect(yield* jobs.backgroundAll({ sessionID: parent, type: "test" })).toMatchObject([{ id: first.id }])
      expect(yield* Fiber.join(firstWait)).toMatchObject({ type: "backgrounded", info: { id: first.id } })

      yield* Deferred.succeed(latch, undefined)
      expect(yield* Fiber.join(secondWait)).toMatchObject({ type: "finished", info: { id: second.id } })
      expect(yield* Fiber.join(thirdWait)).toMatchObject({ type: "finished", info: { id: third.id } })
    }),
  )

  it.live("retains background ownership and terminal output until notification acknowledgment", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const latch = yield* Deferred.make<void>()
      const recovery = {
        kind: "shell" as const,
        sessionID: SessionSchema.ID.make("ses_background_shell"),
        shellID: "shell_background",
        command: "echo done",
      }
      const job = yield* jobs.start({
        id: recovery.shellID,
        type: "shell",
        recovery,
        run: Deferred.await(latch).pipe(Effect.as("done")),
      })

      expect((yield* jobs.pendingBackground).find((item) => item.id === job.id)).toBeUndefined()
      const background = yield* jobs.background(job.id)

      const running = (yield* jobs.pendingBackground).find((item) => item.id === job.id)
      expect(running).toMatchObject({ id: job.id, recovery, status: "running" })
      expect(running?.notificationID).toStartWith("msg_")
      expect(background?.notificationID).toBe(running?.notificationID)

      yield* Deferred.succeed(latch, undefined)
      yield* jobs.wait({ id: job.id })

      const completed = (yield* jobs.pendingBackground).find((item) => item.id === job.id)
      expect(completed).toMatchObject({
        id: job.id,
        notificationID: running?.notificationID,
        recovery,
        status: "completed",
        output: "done",
      })
      if (!completed) return yield* Effect.die(new Error("background marker missing"))

      yield* jobs.completeBackground(completed.notificationID)
      expect((yield* jobs.pendingBackground).find((item) => item.id === job.id)).toBeUndefined()
    }),
  )

  it.live("persists backgroundAll ownership before releasing a blocked subagent", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const parentSessionID = SessionSchema.ID.make("ses_background_parent")
      const latch = yield* Deferred.make<void>()
      const recovery = {
        kind: "subagent" as const,
        parentSessionID,
        childSessionID: SessionSchema.ID.make("ses_background_child"),
        agent: "explore",
        description: "Explore background recovery",
      }
      const job = yield* jobs.start({
        id: recovery.childSessionID,
        type: "subagent",
        recovery,
        run: Deferred.await(latch).pipe(Effect.as("done")),
      })
      const waiting = yield* jobs
        .block({ id: job.id, sessionID: parentSessionID })
        .pipe(Effect.forkIn(yield* Scope.Scope, { startImmediately: true }))

      yield* jobs.backgroundAll({ sessionID: parentSessionID })
      expect(yield* Fiber.join(waiting)).toMatchObject({ type: "backgrounded", info: { id: job.id } })

      const marker = (yield* jobs.pendingBackground).find((item) => item.id === job.id)
      expect(marker).toMatchObject({ id: job.id, recovery, status: "running" })
      if (!marker) return yield* Effect.die(new Error("background marker missing"))

      yield* jobs.cancel(job.id)
      expect((yield* jobs.pendingBackground).find((item) => item.id === job.id)).toMatchObject({
        notificationID: marker.notificationID,
        status: "cancelled",
      })
      yield* jobs.completeBackground(marker.notificationID)
    }),
  )

  it.live("retains terminal errors for recovery until notification acknowledgment", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const latch = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        id: "shell_error",
        type: "shell",
        recovery: {
          kind: "shell",
          sessionID: SessionSchema.ID.make("ses_background_error"),
          shellID: "shell_error",
          command: "exit 1",
        },
        run: Deferred.await(latch).pipe(Effect.andThen(Effect.fail(new Error("shell failed")))),
      })

      yield* jobs.background(job.id)
      yield* Deferred.succeed(latch, undefined)
      yield* jobs.wait({ id: job.id })

      const marker = (yield* jobs.pendingBackground).find((item) => item.id === job.id)
      expect(marker).toMatchObject({ id: job.id, status: "error", error: "shell failed" })
      if (!marker) return yield* Effect.die(new Error("background marker missing"))
      yield* jobs.completeBackground(marker.notificationID)
    }),
  )

  it.live("durably backgrounds recoverable work that has already failed", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const job = yield* jobs.start({
        id: "shell_immediate_error",
        type: "shell",
        recovery: {
          kind: "shell",
          sessionID: SessionSchema.ID.make("ses_immediate_error"),
          shellID: "shell_immediate_error",
          command: "exit 1",
        },
        run: Effect.fail(new Error("shell failed")),
      })
      expect((yield* jobs.wait({ id: job.id })).info?.status).toBe("error")

      const background = yield* jobs.background(job.id)
      expect(background?.notificationID).toStartWith("msg_")
      expect(yield* jobs.pendingBackground).toMatchObject([
        { id: job.id, notificationID: background?.notificationID, status: "error", error: "shell failed" },
      ])
    }),
  )

  it.live("recovers a background marker after its process-local registry closes", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const previous = yield* Job.make.pipe(Scope.provide(scope))
      const job = yield* previous.start({
        id: "shell_restart",
        type: "shell",
        recovery: {
          kind: "shell",
          sessionID: SessionSchema.ID.make("ses_background_restart"),
          shellID: "shell_restart",
          command: "sleep 60",
        },
        run: Effect.never,
      })
      yield* previous.background(job.id)
      yield* Scope.close(scope, Exit.void)

      const current = yield* Job.make
      const marker = (yield* current.pendingBackground).find((item) => item.id === job.id)
      expect(marker).toMatchObject({ id: job.id, status: "running" })
      if (!marker) return yield* Effect.die(new Error("background marker missing"))
      yield* current.completeBackground(marker.notificationID)
    }),
  )

  it.live("preserves running background ownership when its work is interrupted", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const interrupted = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        id: "ses_interrupted_child",
        type: "subagent",
        recovery: {
          kind: "subagent",
          parentSessionID: SessionSchema.ID.make("ses_interrupted_parent"),
          childSessionID: SessionSchema.ID.make("ses_interrupted_child"),
          agent: "explore",
          description: "Continue after shutdown",
        },
        run: Deferred.await(interrupted).pipe(Effect.andThen(Effect.interrupt)),
      })
      yield* jobs.background(job.id)
      yield* Deferred.succeed(interrupted, undefined)
      yield* jobs.wait({ id: job.id })

      const marker = (yield* jobs.pendingBackground).find((item) => item.id === job.id)
      expect(marker).toMatchObject({ id: job.id, status: "running" })
      if (!marker) return yield* Effect.die(new Error("background marker missing"))
      yield* jobs.completeBackground(marker.notificationID)
    }),
  )

  it.live("interrupts live work without promising settlement after the owning process-local scope closes", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const interrupted = yield* Deferred.make<void>()
      const jobs = yield* Job.make.pipe(Scope.provide(scope))
      const job = yield* jobs.start({
        id: "job_abandoned",
        type: "test",
        run: Effect.never.pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined))),
      })

      yield* Scope.close(scope, Exit.void)

      yield* Deferred.await(interrupted).pipe(Effect.timeout("1 second"))
      // The abandoned in-memory registry is not a durable observation channel.
      expect((yield* jobs.get(job.id))?.status).toBe("running")
    }),
  )
})
