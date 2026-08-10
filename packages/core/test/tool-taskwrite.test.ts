/**
 * Dual-track task ↔ todo linkage — the `task` built-in writes back to the
 * SessionTask list when a delegated child settles.
 *
 * 轨 A (explicit): a task created with taskwrite, linked via parent_task_id, is
 *   written back to completed with the child Session id in outputDigest.
 * 轨 B (auto): a fresh delegation creates an in_progress task (content =
 *   description) before spawning the child, then writes it back on settle.
 * Failure → failed (error summary in outputDigest); cancel → cancelled.
 *
 * @see packages/core/src/tool/task.ts
 * @see packages/core/src/tool/task-driver.ts
 * @see packages/core/src/session/task.ts
 */

import { describe, expect } from "bun:test"
import {
  LLMClient,
  LLMError,
  LLMEvent,
  Model,
  TransportReason,
  type LLMClientShape,
  type LLMRequest,
} from "@aigcfroge/llm"
import * as OpenAIChat from "@aigcfroge/llm/protocols/openai-chat"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { QuestionV2 } from "@aigcfroge/core/question"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { Prompt } from "@aigcfroge/core/session/prompt"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionRunCoordinator } from "@aigcfroge/core/session/run-coordinator"
import { SessionRunner } from "@aigcfroge/core/session/runner"
import * as SessionRunnerLLM from "@aigcfroge/core/session/runner/llm"
import { DoomLoop } from "@aigcfroge/core/session/doom-loop"
import { SessionRunnerModel } from "@aigcfroge/core/session/runner/model"
import { SessionTask } from "@aigcfroge/core/session/task"
import { TaskDriver } from "@aigcfroge/core/tool/task-driver"
import { TaskTool } from "@aigcfroge/core/tool/task"
import { Tools } from "@aigcfroge/core/tool/tools"
import { ToolRegistry } from "@aigcfroge/core/tool/registry"
import { ToolOutputStore } from "@aigcfroge/core/tool-output-store"
import { ApplicationTools } from "@aigcfroge/core/tool/application-tools"
import { AppProcess } from "@aigcfroge/core/process"
import { BackgroundJob } from "@aigcfroge/core/background-job"
import { SkillV2 } from "@aigcfroge/core/skill"
import { AgentV2 } from "@aigcfroge/core/agent"
import { Config } from "@aigcfroge/core/config"
import { ConfigCompaction } from "@aigcfroge/core/config/compaction"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SystemContext } from "@aigcfroge/core/system-context"
import { SystemContextRegistry } from "@aigcfroge/core/system-context/registry"
import { SkillGuidance } from "@aigcfroge/core/skill/guidance"
import { ReferenceGuidance } from "@aigcfroge/core/reference/guidance"
import { Location } from "@aigcfroge/core/location"
import { Deferred, Effect, Exit, Fiber, Layer, Schema, Stream } from "effect"
import { testEffect } from "./lib/effect"

const parentID = SessionV2.ID.make("ses_task_writeback")
const requests: LLMRequest[] = []
let taskCallsEmitted = 0
let maxTaskCalls = 1
// Track A: when set, the parent's task call carries parent_task_id.
let parentTaskID: string | undefined
// When > 0, child streams fail with a provider error (exercises failed writeback).
let childStreamFailures = 0
// When set, the parent's task call requests background delegation.
let backgroundMode = false
// When set, child streams signal `streamStarted` then block on `streamGate`.
let streamGate: Deferred.Deferred<void> | undefined
let streamStarted: Deferred.Deferred<void> | undefined

const stopWithText = (id: string, text: string): LLMEvent[] => [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.textStart({ id }),
  LLMEvent.textDelta({ id, text }),
  LLMEvent.textEnd({ id }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]
const providerUnavailable = () =>
  new LLMError({ module: "test", method: "stream", reason: new TransportReason({ message: "Provider unavailable" }) })
const client = Layer.mock(LLMClient.Service, {
  prepare: () => Effect.die("unused"),
  stream: ((request: LLMRequest) => {
    requests.push(request)
    const isParent = request.providerOptions?.openai?.promptCacheKey === parentID
    if (!isParent) {
      if (childStreamFailures > 0) {
        childStreamFailures--
        return Stream.fail(providerUnavailable())
      }
      const events = Stream.fromIterable(stopWithText("text-child", "child result payload"))
      if (!streamGate) return events
      return Stream.unwrap(
        (streamStarted ? Deferred.succeed(streamStarted, undefined) : Effect.void).pipe(
          Effect.andThen(Deferred.await(streamGate)),
          Effect.as(events),
        ),
      )
    }
    if (taskCallsEmitted >= maxTaskCalls) {
      return Stream.fromIterable(stopWithText("text-parent", "delegation complete"))
    }
    taskCallsEmitted++
    return Stream.fromIterable([
      LLMEvent.stepStart({ index: 0 }),
      LLMEvent.toolCall({
        id: "call-task",
        name: "task",
        input: {
          description: "do work",
          prompt: "Investigate the thing",
          subagent_type: "build",
          ...(parentTaskID ? { parent_task_id: parentTaskID } : {}),
          ...(backgroundMode ? { background: true } : {}),
        },
      }),
      LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
      LLMEvent.finish({ reason: "tool-calls" }),
    ])
  }) as LLMClientShape["stream"],
  generate: () => Effect.die("unused"),
})
const model = Model.make({ id: "task-model", provider: "task", route: OpenAIChat.route })

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: () => Effect.void,
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const applications = ApplicationTools.layer
const registry = ToolRegistry.layer.pipe(
  Layer.provide(permission),
  Layer.provide(applications),
  Layer.provide(ToolOutputStore.defaultLayer),
)
const agents = AgentV2.layer
const models = SessionRunnerModel.layerWith(() => Effect.succeed(model))
const questions = QuestionV2.layer.pipe(Layer.provide(EventV2.defaultLayer))

const systemContextKey = SystemContext.Key.make("task/writeback")
const systemContext = Layer.effectDiscard(
  SystemContextRegistry.Service.pipe(
    Effect.flatMap((reg) =>
      reg.register({
        key: systemContextKey,
        load: Effect.succeed(
          SystemContext.make({
            key: systemContextKey,
            codec: Schema.toCodecJson(Schema.String),
            load: Effect.succeed("Task writeback baseline"),
            baseline: (current) => current,
            update: (_previous, current) => current,
            removed: () => "System context source removed: task/writeback",
          }),
        ),
      }),
    ),
  ),
).pipe(Layer.provideMerge(SystemContextRegistry.layer))

const location = Location.layer({ directory: AbsolutePath.make("/project") }).pipe(Layer.provide(Project.defaultLayer))
const skillGuidance = Layer.mock(SkillGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const referenceGuidance = Layer.mock(ReferenceGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const config = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () =>
      Effect.succeed([
        new Config.Document({
          type: "document",
          info: new Config.Info({
            compaction: new ConfigCompaction.Info({
              buffer: 100_000,
              keep: new ConfigCompaction.Keep({ tokens: 50_000 }),
            }),
          }),
        }),
      ]),
  }),
)
const appProcess = Layer.mock(AppProcess.Service, { run: () => Effect.die("AppProcess unused") })
const skillV2 = Layer.mock(SkillV2.Service, { list: () => Effect.succeed([]) })
const toolsRegister = Layer.effect(
  Tools.Service,
  ToolRegistry.Service.use((reg) => Effect.succeed(Tools.Service.of({ register: reg.register }))),
).pipe(Layer.provide(registry))
const taskTool = TaskTool.layer.pipe(Layer.provide(toolsRegister), Layer.provide(config), Layer.provide(EventV2.defaultLayer))

const runner = SessionRunnerLLM.layer.pipe(
  Layer.provide(appProcess),
  Layer.provide(skillV2),
  Layer.provide(Database.defaultLayer),
  Layer.provide(SessionStore.defaultLayer),
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(client),
  Layer.provide(registry),
  Layer.provide(models),
  Layer.provide(systemContext),
  Layer.provide(location),
  Layer.provide(agents),
  Layer.provide(skillGuidance),
  Layer.provide(referenceGuidance),
  Layer.provide(DoomLoop.layer),
  Layer.provide(config),
)
const execution = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const sessionRunner = yield* SessionRunner.Service
    const coordinator = yield* SessionRunCoordinator.make<SessionV2.ID, SessionRunner.RunError>({
      drain: (sessionID, force) => sessionRunner.run({ sessionID, force }),
    })
    return SessionExecution.Service.of({
      resume: coordinator.run,
      wake: coordinator.wake,
      interrupt: coordinator.interrupt,
    })
  }),
).pipe(Layer.provide(runner))
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
    questions,
    SessionProjector.defaultLayer,
    SessionStore.defaultLayer,
    client,
    permission,
    applications,
    agents,
    registry,
    models,
    systemContext,
    location,
    skillGuidance,
    referenceGuidance,
    config,
    runner,
    execution,
    sessions,
    taskTool,
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(agents, permission, SessionTask.defaultLayer, BackgroundJob.defaultLayer),
    ),
  ),
)

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  requests.length = 0
  taskCallsEmitted = 0
  maxTaskCalls = 1
  parentTaskID = undefined
  childStreamFailures = 0
  backgroundMode = false
  streamGate = undefined
  streamStarted = undefined
  const sessions = yield* SessionV2.Service
  const background = yield* BackgroundJob.Service
  TaskDriver.install(sessions, {
    start: (sessionID, work) => background.start({ id: sessionID, type: "task", run: work.pipe(Effect.as("")) }),
    wait: (sessionID) =>
      background.wait({ id: sessionID }).pipe(
        Effect.map(({ info }) =>
          info && info.status !== "running"
            ? { status: info.status, ...(info.error ? { error: info.error } : {}) }
            : undefined,
        ),
      ),
    cancel: (sessionID) => background.cancel(sessionID).pipe(Effect.asVoid),
    extend: (sessionID, work) => background.extend({ id: sessionID, run: work.pipe(Effect.as("")) }),
  }, undefined)
  const agentsService = yield* AgentV2.Service
  yield* agentsService.transform((editor) => {
    editor.update(AgentV2.ID.make("build"), (draft) => {
      draft.mode = "primary"
    })
  })
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: parentID,
      project_id: Project.ID.global,
      slug: parentID,
      directory: "/project",
      title: "task-writeback",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

const runParent = Effect.gen(function* () {
  const session = yield* SessionV2.Service
  yield* session.prompt({ sessionID: parentID, prompt: Prompt.make({ text: "delegate this" }), resume: false })
  yield* session.resume(parentID)
})

const eventData = (published: EventV2.Payload[], index = -1) => {
  const event = index === -1 ? published.at(-1) : published[index]
  return event === undefined ? undefined : Schema.decodeUnknownSync(SessionTask.Event.Updated.data)(event.data)
}

describe("task tool — dual-track todo writeback", () => {
  it.effect("轨 A: parent_task_id links an existing task and writes it back completed", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const events = yield* EventV2.Service
      const published = new Array<EventV2.Payload>()
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === SessionTask.Event.Updated.type) published.push(event)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)

      // The todo exists before delegation (minted by taskwrite).
      const [task] = yield* tasks.update({
        sessionID: parentID,
        tasks: [{ content: "安全审查", status: "in_progress", priority: "high" }],
      })
      parentTaskID = task.id

      yield* runParent

      const got = yield* tasks.get(parentID)
      expect(got).toHaveLength(1)
      expect(got[0]?.status).toBe("completed")
      expect(got[0]?.content).toBe("安全审查")
      expect(got[0]?.id).toBe(task.id)

      // childSessionID rides outputDigest on the published event (M0: not stored).
      const childID = (yield* (yield* SessionV2.Service).children(parentID))[0]?.id
      expect(childID).toBeDefined()
      const data = eventData(published)
      expect(data?.tasks[0]?.outputDigest).toBe(childID)
    }),
  )

  it.effect("轨 B: fresh delegation auto-creates an in_progress task and writes it back completed", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const events = yield* EventV2.Service
      const published = new Array<EventV2.Payload>()
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === SessionTask.Event.Updated.type) published.push(event)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)

      yield* runParent

      const got = yield* tasks.get(parentID)
      expect(got).toHaveLength(1)
      expect(got[0]?.status).toBe("completed")
      expect(got[0]?.content).toBe("do work")
      expect(got[0]?.id.startsWith("tsk_")).toBe(true)

      // The first event carries the auto-created in_progress entry.
      const initial = eventData(published, 0)
      expect(initial?.tasks[0]?.status).toBe("in_progress")
    }),
  )

  it.effect("failed child drain writes the task back as failed with an error digest", () =>
    Effect.gen(function* () {
      yield* setup
      childStreamFailures = 2
      const tasks = yield* SessionTask.Service
      const events = yield* EventV2.Service
      const published = new Array<EventV2.Payload>()
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === SessionTask.Event.Updated.type) published.push(event)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)

      yield* runParent

      const got = yield* tasks.get(parentID)
      expect(got).toHaveLength(1)
      expect(got[0]?.status).toBe("failed")

      const data = eventData(published)
      expect(data?.tasks[0]?.status).toBe("failed")
      expect(data?.tasks[0]?.outputDigest).toBeDefined()
    }),
  )

  it.live("cancelled child drain writes the task back as cancelled", () =>
    Effect.gen(function* () {
      yield* setup
      const gate = yield* Deferred.make<void>()
      const started = yield* Deferred.make<void>()
      streamGate = gate
      streamStarted = started
      const session = yield* SessionV2.Service

      const fiber = yield* runParent.pipe(Effect.forkIn(yield* Effect.scope))
      yield* Deferred.await(started)

      const children = yield* session.children(parentID)
      expect(children.length).toBe(1)
      yield* session.interrupt(children[0].id)
      yield* Deferred.succeed(gate, undefined)

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isSuccess(exit)).toBe(true)

      const tasks = yield* SessionTask.Service
      const got = yield* tasks.get(parentID)
      expect(got[0]?.status).toBe("cancelled")
    }),
  )

  it.live("background delegation settles the auto-created task as completed", () =>
    Effect.gen(function* () {
      process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS = "true"
      yield* setup
      backgroundMode = true
      const session = yield* SessionV2.Service
      const background = yield* BackgroundJob.Service

      yield* runParent
      const children = yield* session.children(parentID)
      expect(children.length).toBe(1)
      const childID = children[0].id
      yield* background.wait({ id: childID })

      const tasks = yield* SessionTask.Service
      const got = yield* tasks.get(parentID)
      expect(got[0]?.status).toBe("completed")
      expect(got[0]?.content).toBe("do work")
    }),
  )

  it.live("background delegation failure settles the task as failed", () =>
    Effect.gen(function* () {
      process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS = "true"
      yield* setup
      backgroundMode = true
      childStreamFailures = 1
      const session = yield* SessionV2.Service
      const background = yield* BackgroundJob.Service

      yield* runParent
      const children = yield* session.children(parentID)
      const childID = children[0].id
      yield* background.wait({ id: childID })

      const tasks = yield* SessionTask.Service
      const got = yield* tasks.get(parentID)
      expect(got[0]?.status).toBe("failed")
    }),
  )

  it.live("background delegation cancel settles the task as cancelled", () =>
    Effect.gen(function* () {
      process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS = "true"
      yield* setup
      backgroundMode = true
      const gate = yield* Deferred.make<void>()
      streamGate = gate
      const session = yield* SessionV2.Service
      const background = yield* BackgroundJob.Service

      yield* runParent
      const children = yield* session.children(parentID)
      const childID = children[0].id
      yield* session.interrupt(childID)
      yield* Deferred.succeed(gate, undefined)
      yield* background.wait({ id: childID })

      const tasks = yield* SessionTask.Service
      const got = yield* tasks.get(parentID)
      expect(got[0]?.status).toBe("cancelled")
    }),
  )
})
