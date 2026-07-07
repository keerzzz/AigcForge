/**
 * Task tool end-to-end — the `task` built-in drives a child Session.
 *
 * Exercises the full seam: a parent Session's LLM turn emits a `task` tool call,
 * the tool creates a child Session (parented + Location-inherited), prompts it,
 * runs it to settlement, and returns the child's final assistant text back to the
 * parent as the tool result. The mock LLM routes by promptCacheKey (= sessionID):
 * the parent emits the tool call, the child emits plain text.
 *
 * @see packages/core/src/tool/task.ts
 * @see packages/core/src/tool/task-driver.ts
 */

import { describe, expect } from "bun:test"
import { LLMClient, LLMEvent, Model, type LLMClientShape, type LLMRequest } from "@aigcfroge/llm"
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
import { SessionRunnerModel } from "@aigcfroge/core/session/runner/model"
import { TaskDriver } from "@aigcfroge/core/tool/task-driver"
import { TaskTool } from "@aigcfroge/core/tool/task"
import { TaskDriverFill } from "@aigcfroge/core/session/task-driver-fill"
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
import { Duration, Effect, Layer, Schedule, Schema, Stream } from "effect"
import { testEffect } from "./lib/effect"

const parentID = SessionV2.ID.make("ses_task_parent")
const requests: LLMRequest[] = []
// The parent emits the task tool call exactly once; its follow-up turn (after the
// tool result) must stop, or the runner would re-emit the call and loop forever.
let parentEmittedTask = false
// When true, the parent's task call requests background delegation.
let backgroundMode = false
// Route by promptCacheKey (= sessionID): the parent emits a task tool call, any
// other Session (the dynamically-created child) emits plain text.
const stopWithText = (id: string, text: string): LLMEvent[] => [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.textStart({ id }),
  LLMEvent.textDelta({ id, text }),
  LLMEvent.textEnd({ id }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]
const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: ((request: LLMRequest) => {
      requests.push(request)
      const isParent = request.providerOptions?.openai?.promptCacheKey === parentID
      if (!isParent) return Stream.fromIterable(stopWithText("text-child", "child result payload"))
      if (parentEmittedTask) return Stream.fromIterable(stopWithText("text-parent", "delegation complete"))
      parentEmittedTask = true
      return Stream.fromIterable([
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.toolCall({
          id: "call-task",
          name: "task",
          input: {
            description: "do work",
            prompt: "Investigate the thing",
            subagent_type: "build",
            ...(backgroundMode ? { background: true } : {}),
          },
        }),
        LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
        LLMEvent.finish({ reason: "tool-calls" }),
      ])
    }) as unknown as LLMClientShape["stream"],
    generate: () => Effect.die("unused"),
  }),
)
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

const systemContextKey = SystemContext.Key.make("task/test")
const systemContext = Layer.effectDiscard(
  SystemContextRegistry.Service.pipe(
    Effect.flatMap((reg) =>
      reg.register({
        key: systemContextKey,
        load: Effect.succeed(
          SystemContext.make({
            key: systemContextKey,
            codec: Schema.toCodecJson(Schema.String),
            load: Effect.succeed("Task test baseline"),
            baseline: (current) => current,
            update: (_previous, current) => current,
            removed: () => "System context source removed: task/test",
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
const appProcess = Layer.succeed(
  AppProcess.Service,
  AppProcess.Service.of({ run: () => Effect.die("AppProcess unused") } as unknown as AppProcess.Interface),
)
const skillV2 = Layer.succeed(
  SkillV2.Service,
  SkillV2.Service.of({ list: () => Effect.succeed([]) } as unknown as SkillV2.Interface),
)
// The `task` built-in is registered through BuiltInTools in production; here we
// register it directly against the shared ToolRegistry (via Tools.Service) so the
// runner materializes it. The tool reaches child Sessions through the TaskDriver
// module bridge (installed in setup), not a Layer, so it carries no seam deps.
const toolsRegister = Layer.effect(
  Tools.Service,
  ToolRegistry.Service.use((reg) => Effect.succeed(Tools.Service.of({ register: reg.register }))),
).pipe(Layer.provide(registry))
// Provide only taskTool-specific deps here; agents/permission stay as
// requirements satisfied once at the outer pipe so setup's AgentV2.transform and
// the tool's AgentV2.resolve share the same State instance.
const taskTool = TaskTool.layer.pipe(Layer.provide(toolsRegister))

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
    Layer.provideMerge(Layer.mergeAll(agents, permission, BackgroundJob.defaultLayer)),
  ),
)

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  requests.length = 0
  parentEmittedTask = false
  backgroundMode = false
  // Install the seam with the test's own SessionV2 so the tool's child Session
  // lands in the same in-memory db the test body reads. Register the default
  // agent so the tool can resolve subagent_type "build". Mirrors TaskDriverFill.
  const sessions = yield* SessionV2.Service
  const background = yield* BackgroundJob.Service
  TaskDriver.install(sessions, {
    start: (sessionID, work) => background.start({ id: sessionID, type: "task", run: work.pipe(Effect.as("")) }),
    wait: (sessionID) => background.wait({ id: sessionID }),
  })
  const agents = yield* AgentV2.Service
  yield* agents.transform((editor) => {
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
      title: "task-parent",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

describe("task tool — child Session delegation", () => {
  it.effect("forks a child Session, runs it, and returns its final text", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service

      yield* session.prompt({ sessionID: parentID, prompt: Prompt.make({ text: "delegate this" }), resume: false })
      yield* session.resume(parentID)

      // Parent's assistant message should carry the completed task tool call.
      const parentMessages = yield* session.context(parentID)
      const assistant = parentMessages.find((message) => message.type === "assistant")
      expect(assistant?.type).toBe("assistant")

      // A child Session parented to the parent must now exist.
      const children = yield* session.children(parentID)
      expect(children.length).toBe(1)
      expect(children[0]?.parentID).toBe(parentID)

      // The child ran and produced the expected text.
      const childMessages = yield* session.context(children[0].id)
      const childAssistant = childMessages.find((message) => message.type === "assistant")
      const childText =
        childAssistant?.type === "assistant"
          ? childAssistant.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("")
          : ""
      expect(childText).toBe("child result payload")
    }),
  )

  it.live("background delegation returns immediately and injects the result into the parent", () =>
    Effect.gen(function* () {
      process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS = "true"
      yield* setup
      // setup resets backgroundMode; enable it after so the mock LLM emits the
      // `background: true` tool-call input when the parent's turn runs.
      backgroundMode = true
      const session = yield* SessionV2.Service

      const background = yield* BackgroundJob.Service

      yield* session.prompt({
        sessionID: parentID,
        prompt: Prompt.make({ text: "delegate in background" }),
        resume: false,
      })
      yield* session.resume(parentID)

      // Background delegation returns immediately, so a child Session exists while
      // its drain is still scheduled on the BackgroundJob fiber.
      const children = yield* session.children(parentID)
      expect(children.length).toBe(1)
      const childID = children[0]!.id

      // Awaiting the job is the readiness signal (never a sleep): when it completes,
      // the seam has driven the child and injected the synthetic result into the
      // parent. The injection also wakes the parent to run a turn over the result.
      yield* background.wait({ id: childID })

      const synthetic = (yield* session.context(parentID)).find((message) => message.type === "synthetic")
      expect(synthetic?.type).toBe("synthetic")
      const syntheticText = synthetic?.type === "synthetic" ? synthetic.text : ""
      expect(syntheticText).toContain("Background task completed")
      expect(syntheticText).toContain("child result payload")
      expect(syntheticText).toContain(childID)
    }),
  )
})
