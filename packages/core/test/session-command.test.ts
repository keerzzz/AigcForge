import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { eq } from "drizzle-orm"
import { Composition } from "@aigcfroge/schema/composition"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { EventTable } from "@aigcfroge/core/event/sql"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionInputTable, SessionMessageTable, SessionTable } from "@aigcfroge/core/session/sql"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { AgentAttachment, FileAttachment, Prompt } from "@aigcfroge/core/session/prompt"
import { testEffect } from "./lib/effect"
import { withCustomModeEnabled } from "./lib/product-mode"

withCustomModeEnabled()

const wakeCalls: SessionV2.ID[] = []
const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    resume: () => Effect.void,
    interrupt: () => Effect.void,
    isActive: () => Effect.succeed(false),
    wake: (sessionID) =>
      Effect.sync(() => {
        wakeCalls.push(sessionID)
      }),
  }),
)
const sessionComposition = SessionComposition.layer.pipe(Layer.provide(Database.defaultLayer))
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
    sessionComposition,
    execution,
    sessions,
  ),
)

const mockRevision = Schema.decodeUnknownSync(Composition.Revision)(
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
)
const mockDigest = Composition.Digest.make("a".repeat(64))
const mockCatalogDigest = Composition.Digest.make("b".repeat(64))

const sessionID = SessionV2.ID.make("ses_command_test")
const messageID = SessionMessage.ID.make("msg_command_test")

const makeSnapshot = (commands: Composition.CommandInfo[]) =>
  new Composition.SnapshotV2({
    version: 2,
    digest: mockDigest,
    sessionID,
    createdAt: Date.now(),
    data: new Composition.SnapshotDataV2({
      agents: [
        {
          id: "meta",
          name: "meta",
          description: "Meta",
          relativePath: "meta.md",
          revision: mockRevision,
          consumerKey: "orchestrator",
        },
      ],
      bindings: {
        orchestrator: new Composition.SnapshotBindingData({
          instructions: [],
          prompts: [],
          skills: [],
          commands,
        }),
      },
      instructions: [],
      prompts: [],
      skills: [],
      tools: new Composition.SnapshotToolInfo({
        fingerprints: [],
        catalogDigest: mockCatalogDigest,
        catalog: [],
      }),
    }),
  })

const boundCommand = new Composition.CommandInfo({
  name: "review",
  description: "Review the change",
  relativePath: "commands/review.md",
  revision: mockRevision,
  invocation: "/review $1",
  args: "$1: path",
})

const setup = (commands: Composition.CommandInfo[] = [boundCommand]) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const composition = yield* SessionComposition.Service
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
        title: "command-test",
        version: "test",
        mode: "custom",
        agent: "meta",
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* composition.attach(sessionID, makeSnapshot(commands))
  })

describe("SessionV2.command", () => {
  it.effect("admits a frozen command to the durable inbox and schedules a wake", () =>
    Effect.gen(function* () {
      yield* setup()
      const session = yield* SessionV2.Service

      const admitted = yield* session.command({
        id: messageID,
        sessionID,
        command: "review",
        arguments: "src/main.ts",
        resume: true,
      })

      expect(admitted).toMatchObject({
        kind: "command",
        command: "review",
        relativePath: "commands/review.md",
        revision: mockRevision,
        consumer: "orchestrator",
        arguments: "src/main.ts",
        delivery: "steer",
      })
      expect(wakeCalls).toContain(sessionID)
    }),
  )

  it.effect("persists the command input through the CommandAdmitted event projection", () =>
    Effect.gen(function* () {
      yield* setup()
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service

      yield* session.command({
        sessionID,
        command: "review",
        arguments: "src",
        resume: false,
      })

      const row = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie)
      expect(row?.kind).toBe("command")
      expect(row?.command).toBe("review")
      expect(row?.delivery).toBe("steer")
      expect(row?.command_payload).toMatchObject({
        relativePath: "commands/review.md",
        consumer: "orchestrator",
        arguments: "src",
        snapshotDigest: mockDigest,
      })
    }),
  )

  it.effect("publishes a command.admitted durable event", () =>
    Effect.gen(function* () {
      yield* setup()
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service

      yield* session.command({ id: messageID, sessionID, command: "review", arguments: "src", resume: false })

      const events = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .all()
        .pipe(Effect.orDie)
      expect(events.map((event) => event.type)).toContain("session.next.command.admitted.1")
    }),
  )

  it.effect("exact retry with the same message ID is idempotent: one inbox row and one wake", () =>
    Effect.gen(function* () {
      yield* setup()
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service

      yield* session.command({ id: messageID, sessionID, command: "review", arguments: "src", resume: true })
      yield* session.command({ id: messageID, sessionID, command: "review", arguments: "src", resume: true })

      const rows = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.id, messageID))
        .all()
        .pipe(Effect.orDie)
      expect(rows).toHaveLength(1)
      expect(wakeCalls.filter((id) => id === sessionID)).toHaveLength(1)
    }),
  )

  it.effect("same message ID with changed arguments is a typed 409", () =>
    Effect.gen(function* () {
      yield* setup()
      const session = yield* SessionV2.Service

      yield* session.command({ id: messageID, sessionID, command: "review", arguments: "a", resume: false })

      const error = yield* session
        .command({ id: messageID, sessionID, command: "review", arguments: "b", resume: false })
        .pipe(Effect.flip)
      expect(error._tag).toBe("Session.PromptConflictError")
    }),
  )

  it.effect("same message ID with a changed command name is a typed 409", () =>
    Effect.gen(function* () {
      yield* setup([
        boundCommand,
        new Composition.CommandInfo({
          name: "other",
          description: "Other",
          relativePath: "commands/other.md",
          revision: mockRevision,
          invocation: "/other",
        }),
      ])
      const session = yield* SessionV2.Service

      yield* session.command({ id: messageID, sessionID, command: "review", arguments: "src", resume: false })

      const error = yield* session
        .command({ id: messageID, sessionID, command: "other", arguments: "src", resume: false })
        .pipe(Effect.flip)
      expect(error._tag).toBe("Session.PromptConflictError")
    }),
  )

  it.effect("an unbound command name fails closed with a typed error", () =>
    Effect.gen(function* () {
      yield* setup([boundCommand])
      const session = yield* SessionV2.Service

      const error = yield* session.command({ sessionID, command: "outside-command", resume: false }).pipe(Effect.flip)
      expect(error._tag).toBe("Session.CommandUnavailableError")
      if (error._tag === "Session.CommandUnavailableError") expect(error.reason).toBe("unbound")
    }),
  )

  it.effect("an ambiguous command name fails closed with a typed error", () =>
    Effect.gen(function* () {
      yield* setup([
        boundCommand,
        new Composition.CommandInfo({
          name: "review",
          description: "Second review",
          relativePath: "commands/review-other.md",
          revision: mockRevision,
          invocation: "/review",
        }),
      ])
      const session = yield* SessionV2.Service

      const error = yield* session.command({ sessionID, command: "review", resume: false }).pipe(Effect.flip)
      expect(error._tag).toBe("Session.CommandUnavailableError")
      if (error._tag === "Session.CommandUnavailableError") expect(error.reason).toBe("ambiguous")
    }),
  )

  it.effect('a legacy snapshot command (invocation "") fails closed', () =>
    Effect.gen(function* () {
      yield* setup([
        new Composition.CommandInfo({
          name: "review",
          description: "Legacy",
          relativePath: "commands/review.md",
          revision: mockRevision,
          invocation: "",
        }),
      ])
      const session = yield* SessionV2.Service

      const error = yield* session.command({ sessionID, command: "review", resume: false }).pipe(Effect.flip)
      expect(error._tag).toBe("Session.CommandUnavailableError")
      if (error._tag === "Session.CommandUnavailableError") expect(error.reason).toBe("legacy")
    }),
  )

  it.effect("a non-custom session rejects command admission", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
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
          title: "command-test",
          version: "test",
          mode: "coding",
          agent: "build",
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      const session = yield* SessionV2.Service

      const error = yield* session.command({ sessionID, command: "review", resume: false }).pipe(Effect.flip)
      expect(error._tag).toBe("Session.CommandUnavailableError")
      if (error._tag === "Session.CommandUnavailableError") expect(error.reason).toBe("not-custom")
    }),
  )

  it.effect("command admission creates no session message row (no Tool surface)", () =>
    Effect.gen(function* () {
      yield* setup()
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service

      yield* session.command({ id: messageID, sessionID, command: "review", arguments: "src", resume: false })

      const message = yield* db
        .select({ id: SessionMessageTable.id })
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.id, messageID))
        .get()
        .pipe(Effect.orDie)
      expect(message).toBeUndefined()
    }),
  )

  it.effect("command admission keeps the canonical context Prompt with files and agents", () =>
    Effect.gen(function* () {
      yield* setup()
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const context = Prompt.make({
        text: "",
        files: [FileAttachment.make({ uri: "file:///project/src/main.ts", mime: "text/plain" })],
        agents: [AgentAttachment.make({ name: "coder" })],
      })

      yield* session.command({
        id: messageID,
        sessionID,
        command: "review",
        arguments: "src",
        context,
        resume: false,
      })

      const row = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.id, messageID))
        .get()
        .pipe(Effect.orDie)
      expect(row?.prompt).toMatchObject({
        text: "",
        files: [{ uri: "file:///project/src/main.ts", mime: "text/plain" }],
        agents: [{ name: "coder" }],
      })
    }),
  )
})
