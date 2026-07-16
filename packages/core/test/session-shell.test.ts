import { describe, expect } from "bun:test"
import { DateTime, Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { EventTable } from "@aigcfroge/core/event/sql"
import { SessionEvent } from "@aigcfroge/core/session/event"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionInput } from "@aigcfroge/core/session/input"
import { SessionInputTable, SessionTable } from "@aigcfroge/core/session/sql"
import { SessionStore } from "@aigcfroge/core/session/store"
import { testEffect } from "./lib/effect"

const wakeCalls: SessionV2.ID[] = []
const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    resume: () => Effect.void,
    interrupt: () => Effect.void,
    wake: (sessionID) =>
      Effect.sync(() => {
        wakeCalls.push(sessionID)
      }),
  }),
)
const sessions = SessionV2.layer.pipe(
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(SessionStore.defaultLayer),
  Layer.provide(Project.defaultLayer),
  Layer.provide(execution),
)
const it = testEffect(
  Layer.mergeAll(
    Database.defaultLayer,
    EventV2.defaultLayer,
    SessionProjector.defaultLayer,
    SessionStore.defaultLayer,
    execution,
    sessions,
  ),
)
const sessionID = SessionV2.ID.make("ses_shell_test")
const messageID = SessionMessage.ID.create()

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  wakeCalls.length = 0
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: sessionID,
      directory: "/project",
      title: "shell-test",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

describe("SessionV2.shell", () => {
  it.effect("admits a shell input to the durable inbox and schedules a wake", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service

      const admitted = yield* session.shell({
        id: messageID,
        sessionID,
        command: "echo hello",
        resume: true,
      })

      expect(admitted).toMatchObject({ kind: "shell", command: "echo hello", delivery: "queue", sessionID })
      expect(wakeCalls).toContain(sessionID)
    }),
  )

  it.effect("persists the shell input through the ShellAdmitted event projection", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service

      yield* session.shell({ sessionID, command: "pwd", resume: false })

      const row = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie)
      expect(row?.kind).toBe("shell")
      expect(row?.command).toBe("pwd")
      expect(row?.delivery).toBe("queue")
      expect(row?.prompt).toBeNull()
    }),
  )

  it.effect("admits without waking when resume is false", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service

      yield* session.shell({ sessionID, command: "ls", resume: false })

      expect(wakeCalls).not.toContain(sessionID)
    }),
  )

  it.effect("publishes a shell.admitted durable event", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service

      yield* session.shell({ id: messageID, sessionID, command: "git status", resume: false })

      const events = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .all()
        .pipe(Effect.orDie)
      expect(events.map((event) => event.type)).toContain("session.next.shell.admitted.1")
    }),
  )

  it.effect("marks the shell input promoted when Shell.Started is projected", () =>
    Effect.gen(function* () {
      yield* setup
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service

      yield* SessionInput.admitShell(db, events, { id: messageID, sessionID, command: "echo hi" }).pipe(
        Effect.provide(Layer.mergeAll(Database.defaultLayer, EventV2.defaultLayer, SessionProjector.defaultLayer)),
      )
      yield* events.publish(SessionEvent.Shell.Started, {
        sessionID,
        messageID,
        timestamp: DateTime.makeUnsafe(0),
        callID: "call-1",
        command: "echo hi",
      })

      const row = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.id, messageID))
        .get()
        .pipe(Effect.orDie)
      expect(row?.promoted_seq).not.toBeNull()
    }),
  )

  it.effect("rejects a shell admit for a missing Session", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const missing = SessionV2.ID.make("ses_missing_shell")

      expect(
        yield* session.shell({ sessionID: missing, command: "pwd" }).pipe(
          Effect.flip,
          Effect.map((error) => error._tag),
        ),
      ).toBe("Session.NotFoundError")
    }),
  )
})
