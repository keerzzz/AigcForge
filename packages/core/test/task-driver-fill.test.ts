/**
 * External CLI execution through the real `TaskDriverFill` composition — R1–R5.
 *
 * Exercises the fill's `executeCLI` seam over a real in-memory `SessionV2` +
 * `BackgroundJob` + `Database.defaultLayer`, with a mocked `ChildProcessSpawner`
 * and a registered "test-cli" adapter (so no real CLI binary is needed).
 *
 * - R1  child Session ends up with prompt + output user messages
 * - R2  child Session title equals the task description
 * - R3  resume key: second same-parent delegation reuses the persisted
 *       external_session_id (mock spawner argv carries `--resume <id>`)
 * - R4  meta agent parent writes a `type:"external-cli"` step that settles
 *       `completed` on success / `failed` on failure
 * - R5  missing spawner surfaces a typed error, not a bare `Error`
 *
 * @see packages/core/src/session/task-driver-fill.ts
 */

import { beforeEach, describe, expect } from "bun:test"
import { and, eq } from "drizzle-orm"
import { Effect, Layer, Sink, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { BackgroundJob } from "@aigcfroge/core/background-job"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { Location } from "@aigcfroge/core/location"
import { MetaAgentService } from "@aigcfroge/core/meta-agent/service"
import { MetaAgentStepTable } from "@aigcfroge/core/meta-agent/sql"
import { ProjectV2 } from "@aigcfroge/core/project"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionStore } from "@aigcfroge/core/session/store"
import { TaskDriverFill } from "@aigcfroge/core/session/task-driver-fill"
import { TaskDriver } from "@aigcfroge/core/tool/task-driver"
import { ExternalCliSessionTable } from "@aigcfroge/core/tool/cli-session.sql"
import { registerCliAdapter, type CliAdapter } from "@aigcfroge/core/tool/cli-adapter"
import { testEffect } from "./lib/effect"

const encoder = new TextEncoder()
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const RESUME_ID = "ext_ses_resume_1"
const STDOUT = `${JSON.stringify({ type: "session.resume_hint", sessionID: RESUME_ID })}\nCLI task summary`

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)
const sessions = SessionV2.layer.pipe(
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(SessionStore.defaultLayer),
  Layer.provide(projects),
  Layer.provide(SessionExecution.noopLayer),
)
const metaAgent = MetaAgentService.layer.pipe(Layer.provide(Database.defaultLayer))

// Registered once at module load; the fill layer additionally registers the
// built-ins, which share the same module-level registry under distinct keys.
const testAdapter: CliAdapter = {
  name: "test-cli",
  command: "test-cli",
  description: "test CLI adapter",
  detect: () => Effect.succeed(true),
  buildArgs: ({ prompt, resumeId }) => Effect.succeed(resumeId ? ["--resume", resumeId] : ["run", prompt]),
  parseOutput: (stdout) =>
    Effect.succeed(
      stdout.includes("__FAILED__")
        ? { status: "failed" as const, summary: "CLI blew up", errors: ["boom"] }
        : { status: "success" as const, summary: "CLI task summary" },
    ),
  parseResumeHint: (stdout) => {
    const match = stdout.match(/"sessionID":"([^"]+)"/)
    return match?.[1]
  },
}
registerCliAdapter("test-cli", testAdapter)

const spawnCalls: Array<{ cmd: string; args: readonly string[] }> = []
const sinkStub = Sink.drain

function makeSpawner() {
  return ChildProcessSpawner.make((command) => {
    const std = ChildProcess.isStandardCommand(command) ? command : undefined
    spawnCalls.push({ cmd: std?.command ?? "", args: std?.args ?? [] })
    // A prompt carrying __FAILED__ steers the adapter to a failed parse, so the
    // failure settle path is exercised without a real CLI.
    const stdout = (std?.args ?? []).join(" ").includes("__FAILED__") ? "__FAILED__" : STDOUT
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(0),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: sinkStub,
        stdout: Stream.make(encoder.encode(stdout)),
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => sinkStub,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      }),
    )
  })
}
const spawnerLayer = Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, makeSpawner())

// TaskDriverFill must have its deps provided explicitly: Layer.mergeAll does not
// bubble requirements across Layer.provide boundaries, so a bare
// `TaskDriverFill.layer` in a mergeAll dies with "Service not found: v2/Session".
const makeFillLayer = (withSpawner: boolean) =>
  withSpawner
    ? TaskDriverFill.layer.pipe(
        Layer.provide(sessions),
        Layer.provide(BackgroundJob.defaultLayer),
        Layer.provide(EventV2.defaultLayer),
        Layer.provide(metaAgent),
        Layer.provide(spawnerLayer),
      )
    : TaskDriverFill.layer.pipe(
        Layer.provide(sessions),
        Layer.provide(BackgroundJob.defaultLayer),
        Layer.provide(EventV2.defaultLayer),
        Layer.provide(metaAgent),
      )

const makeTestLayer = (withSpawner: boolean) =>
  Layer.mergeAll(
    Database.defaultLayer,
    EventV2.defaultLayer,
    projects,
    SessionProjector.defaultLayer,
    SessionStore.defaultLayer,
    SessionExecution.noopLayer,
    sessions,
    BackgroundJob.defaultLayer,
    metaAgent,
    makeFillLayer(withSpawner),
  )

const it = testEffect(makeTestLayer(true))
const itNoSpawner = testEffect(makeTestLayer(false))

const seedParent = Effect.gen(function* () {
  const session = yield* SessionV2.Service
  return yield* session.create({ location })
})

const runCLI = (input: { parentID: string; description?: string; prompt?: string; cliTarget?: string }) =>
  TaskDriver.executeCLI({
    cliTarget: input.cliTarget ?? "test-cli",
    prompt: input.prompt ?? "run the cli task",
    description: input.description ?? "cli child title",
    sessionID: SessionV2.ID.make(input.parentID),
  })

const userMessageTexts = (messages: ReadonlyArray<SessionMessage.Message>) =>
  messages
    .filter((message): message is SessionMessage.User => message.type === "user")
    .map((message) => message.text)

describe("TaskDriverFill executeCLI", () => {
  beforeEach(() => {
    spawnCalls.length = 0
  })

  it.effect("R1+R2 creates a titled child Session with prompt and output messages", () =>
    Effect.gen(function* () {
      const parent = yield* seedParent
      const session = yield* SessionV2.Service

      const result = yield* runCLI({ parentID: parent.id })

      // R2: child Session title = task description
      const child = yield* session.get(result.sessionID)
      expect(child.title).toBe("cli child title")

      // R1: child carries two user messages — prompt with the project-directory
      // prefix, then the CLI summary.
      const messages = yield* session.messages({ sessionID: result.sessionID, order: "asc" })
      const texts = userMessageTexts(messages)
      expect(texts).toHaveLength(2)
      expect(texts[0]).toContain("[Project directory: /project]")
      expect(texts[0]).toContain("run the cli task")
      expect(texts[1]).toBe("CLI task summary")
    }),
  )

  it.effect("R3 resume key: a second same-parent delegation reuses the persisted external session id", () =>
    Effect.gen(function* () {
      const parent = yield* seedParent
      const { db } = yield* Database.Service

      // First delegation: no resumeId yet.
      yield* runCLI({ parentID: parent.id })
      expect(spawnCalls).toHaveLength(1)
      expect(spawnCalls[0].args).not.toContain("--resume")

      // The row is persisted keyed by the PARENT session id.
      const row = yield* db
        .select()
        .from(ExternalCliSessionTable)
        .where(and(eq(ExternalCliSessionTable.session_id, parent.id), eq(ExternalCliSessionTable.cli_target, "test-cli")))
        .get()
        .pipe(Effect.orDie)
      expect(row?.external_session_id).toBe(RESUME_ID)

      // Second delegation with the same parent reuses the persisted id.
      yield* runCLI({ parentID: parent.id })
      expect(spawnCalls).toHaveLength(2)
      expect(spawnCalls[1].args).toContain("--resume")
      expect(spawnCalls[1].args).toContain(RESUME_ID)
    }),
  )

  it.effect("R4 writes an external-cli step that settles completed on success", () =>
    Effect.gen(function* () {
      const parent = yield* seedParent
      const { db } = yield* Database.Service
      const meta = yield* MetaAgentService.Service
      const created = yield* meta.create({
        title: "Test Meta Agent",
        agent: "build",
        model: { id: "gpt-4", providerID: "openai" },
      })
      yield* meta.attach({ metaID: created.id, sessionID: parent.id, role: "orchestrator" })

      yield* runCLI({ parentID: parent.id })

      const steps = yield* db
        .select()
        .from(MetaAgentStepTable)
        .where(and(eq(MetaAgentStepTable.meta_agent_session_id, parent.id), eq(MetaAgentStepTable.type, "external-cli")))
        .all()
        .pipe(Effect.orDie)
      expect(steps).toHaveLength(1)
      expect(steps[0].engine).toBe("test-cli")
      expect(steps[0].status).toBe("completed")
    }),
  )

  it.effect("R4 settles an external-cli step as failed when the CLI fails", () =>
    Effect.gen(function* () {
      const parent = yield* seedParent
      const { db } = yield* Database.Service
      const meta = yield* MetaAgentService.Service
      const created = yield* meta.create({
        title: "Failing Meta",
        agent: "build",
        model: { id: "gpt-4", providerID: "openai" },
      })
      yield* meta.attach({ metaID: created.id, sessionID: parent.id, role: "orchestrator" })

      // Point the CLI at a failing output.
      yield* TaskDriver.executeCLI({
        cliTarget: "test-cli",
        prompt: "__FAILED__ run the cli task",
        description: "fail",
        sessionID: parent.id,
      })

      const steps = yield* db
        .select()
        .from(MetaAgentStepTable)
        .where(and(eq(MetaAgentStepTable.meta_agent_session_id, parent.id), eq(MetaAgentStepTable.type, "external-cli")))
        .all()
        .pipe(Effect.orDie)
      expect(steps[0].status).toBe("failed")
    }),
  )

  itNoSpawner.effect("R5 missing spawner surfaces a typed error, not a bare Error", () =>
    Effect.gen(function* () {
      const parent = yield* seedParent
      const error = yield* runCLI({ parentID: parent.id }).pipe(Effect.flip)
      expect(error instanceof TaskDriverFill.CliUnavailableError).toBe(true)
    }),
  )
})
