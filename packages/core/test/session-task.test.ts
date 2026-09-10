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
import { DelegationExecution } from "@aigcfroge/core/delegation/execution"
import { DelegationService } from "@aigcfroge/core/delegation/service"
import { DelegationEvent } from "@aigcfroge/core/delegation/event"
import { DelegationProjector } from "@aigcfroge/core/delegation/projector"
import { EventV2 } from "@aigcfroge/core/event"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { QuestionV2 } from "@aigcfroge/core/question"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { Prompt } from "@aigcfroge/core/session/prompt"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionRunCoordinator } from "@aigcfroge/core/session/run-coordinator"
import { SessionRunner } from "@aigcfroge/core/session/runner"
import * as SessionRunnerLLM from "@aigcfroge/core/session/runner/llm"
import { DoomLoop } from "@aigcfroge/core/session/doom-loop"
import { CorrectionExtractor } from "@aigcfroge/core/session/correction-extractor"
import { CorrectionStore } from "@aigcfroge/core/session/correction-store"
import { ReferenceChecker } from "@aigcfroge/core/session/reference-checker"
import { Verifier } from "@aigcfroge/core/session/verifier"
import { VerificationRouter } from "@aigcfroge/core/session/verification-router"
import { Ripgrep } from "../src/ripgrep"
import { RipgrepBinary } from "../src/ripgrep/binary"
import { FSUtil } from "../src/fs-util"
import { SessionRunnerModel } from "@aigcfroge/core/session/runner/model"
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
import { ConfigMeta } from "../src/config/meta"
import { ConfigCompaction } from "@aigcfroge/core/config/compaction"
import { DelegationTable } from "@aigcfroge/core/delegation/sql"
import { SessionInputTable, SessionTable, TaskTable } from "@aigcfroge/core/session/sql"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionTask } from "@aigcfroge/core/session/task"
import { SystemContext } from "@aigcfroge/core/system-context"
import { SystemContextRegistry } from "@aigcfroge/core/system-context/registry"
import { SkillGuidance } from "@aigcfroge/core/skill/guidance"
import { ReferenceGuidance } from "@aigcfroge/core/reference/guidance"
import { Location } from "@aigcfroge/core/location"
import { Deferred, Effect, Exit, Fiber, Layer, Schema, Stream } from "effect"
import { eq } from "drizzle-orm"
import { testEffect, pollWithTimeout } from "./lib/effect"

const parentID = SessionV2.ID.make("ses_task_parent")
const requests: LLMRequest[] = []
// Parent emits up to `maxTaskCalls` task calls (resuming when `nextTaskID` is
// set), then a terminal text turn. `taskCallsEmitted` tracks calls within the
// current drain so a second prompt cycle can reset and emit another.
let taskCallsEmitted = 0
let maxTaskCalls = 1
let nextTaskID: string | undefined
// When > 0, the next child-directed stream fails with a provider error instead
// of emitting text — used to exercise the retry path.
let childStreamFailures = 0
// When set, child streams signal `streamStarted` then block on `streamGate`
// before emitting — used to exercise foreground abort mid-drain.
let streamGate: Deferred.Deferred<void> | undefined
let streamStarted: Deferred.Deferred<void> | undefined
// When true, the parent's task call requests background delegation.
let backgroundMode = false
// When set, the parent's task call passes attended: <value> in the tool input.
let attendedMode: boolean | undefined
// External-CLI mode: the parent's task call emits execution_type + cli_target,
// and the installed seam's CLI executor returns a canned result.
let cliMode = false
let cliMissingTarget = false
let cliTarget = "claude-code"
let cliResultText = "cli result text"
let cliResultStatus: "success" | "failed" = "success"
// When set, the installed CLI executor fails with this error (unavailable-CLI
// path); `cliGate`/`cliStarted` make it signal then block (parent-abort path).
let cliError: Error | undefined
let cliGate: Deferred.Deferred<void> | undefined
let cliStarted: Deferred.Deferred<void> | undefined
// Judge mode: the parent's task call emits execution_type "judge" (+ an
// optional track-A parent_task_id link).
let judgeMode = false
let judgeParentTaskID: string | undefined
const cliResultSessionID = SessionV2.ID.make("ses_cli_child")
const cliReceived: Array<{ cliTarget: string; prompt: string; sessionID: SessionV2.ID }> = []
// Permission assert inputs captured so tests can assert the CLI request shape.
const permissionCalls: unknown[] = []
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
const providerUnavailable = () =>
  new LLMError({ module: "test", method: "stream", reason: new TransportReason({ message: "Provider unavailable" }) })
const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
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
            ...(cliMode
              ? { execution_type: "external-cli", ...(cliMissingTarget ? {} : { cli_target: cliTarget }) }
              : {}),
            ...(judgeMode
              ? {
                  execution_type: "judge",
                  judge_models: ["task-model"],
                  ...(judgeParentTaskID ? { parent_task_id: judgeParentTaskID } : {}),
                }
              : {}),
            ...(nextTaskID ? { task_id: nextTaskID } : {}),
            ...(backgroundMode ? { background: true } : {}),
            ...(attendedMode !== undefined ? { attended: attendedMode } : {}),
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
    effectiveRules: () => Effect.succeed([]),
    assert: (input) =>
      Effect.sync(() => {
        permissionCalls.push(input)
      }),
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
            meta: ConfigMeta.Info.make({
              correction_store: ConfigMeta.CorrectionStore.make({ enabled: false }),
              verifier: ConfigMeta.Verifier.make({ enabled: false }),
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
  ToolRegistry.Service.use((reg) =>
    Effect.succeed(Tools.Service.of({ register: reg.register, registerSession: reg.registerSession })),
  ),
).pipe(Layer.provide(registry))
// Provide only taskTool-specific deps here; agents/permission stay as
// requirements satisfied once at the outer pipe so setup's AgentV2.transform and
// the tool's AgentV2.resolve share the same State instance.
const taskTool = TaskTool.layer.pipe(
  Layer.provide(toolsRegister),
  Layer.provide(config),
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(DelegationService.defaultLayer),
)

const sessionComposition = SessionComposition.layer.pipe(Layer.provide(Database.defaultLayer))
const runner = SessionRunnerLLM.layer
  .pipe(
    Layer.provide(sessionComposition),
    Layer.provide(appProcess),
    Layer.provide(skillV2),
    Layer.provide(Database.defaultLayer),
    Layer.provide(SessionStore.defaultLayer),
    Layer.provide(EventV2.defaultLayer),
    Layer.provide(client),
    Layer.provide(registry),
    Layer.provide(models),
    Layer.provide(systemContext),
  )
  .pipe(
    Layer.provide(location),
    Layer.provide(agents),
    Layer.provide(skillGuidance),
    Layer.provide(referenceGuidance),
    Layer.provide(DoomLoop.layer),
    Layer.provide(CorrectionExtractor.layer),
    Layer.provide(CorrectionStore.layer),
    Layer.provide(
      Verifier.layer.pipe(
        Layer.provide(VerificationRouter.layer.pipe(Layer.provide(config))),
        Layer.provide(CorrectionStore.layer.pipe(Layer.provide(config))),
        Layer.provide(EventV2.defaultLayer.pipe(Layer.provide(Database.defaultLayer))),
        Layer.provide(location),
        Layer.provide(appProcess),
        Layer.provide(config),
      ),
    ),
    Layer.provide(
      ReferenceChecker.layer.pipe(
        Layer.provide(CorrectionStore.layer.pipe(Layer.provide(config))),
        Layer.provide(location),
        Layer.provide(config),
        Layer.provide(Ripgrep.layer.pipe(Layer.provide(RipgrepBinary.defaultLayer), Layer.provide(appProcess))),
        Layer.provide(FSUtil.defaultLayer),
      ),
    ),
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
      isActive: coordinator.isActive,
    })
  }),
).pipe(Layer.provide(runner), Layer.provideMerge(TaskDriver.runtimeLayer))
const sessions = SessionV2.layer.pipe(
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(SessionStore.defaultLayer),
  Layer.provide(Project.defaultLayer),
  Layer.provide(sessionComposition),
  Layer.provide(execution),
)
const delegationExecution = DelegationExecution.layer.pipe(
  Layer.provide(DelegationService.defaultLayer),
  Layer.provide(sessions),
  Layer.provide(BackgroundJob.defaultLayer),
  Layer.provideMerge(TaskDriver.runtimeLayer),
)
const taskDriverInitializer = Layer.effectDiscard(
  Effect.gen(function* () {
    const sessions = yield* SessionV2.Service
    const background = yield* BackgroundJob.Service
    const delegation = yield* DelegationService.Service
    const delegationOwner = yield* DelegationExecution.Service
    yield* TaskDriver.initialize(
      yield* TaskDriver.installForTesting(
        {
          ...sessions,
          settleDelivery: (input) => delegation.recordDelivery(input),
        },
        {
          start: (sessionID, work) => background.start({ id: sessionID, type: "task", run: work.pipe(Effect.as("")) }),
          wait: (sessionID) =>
            background
              .wait({ id: sessionID })
              .pipe(
                Effect.map(({ info }) =>
                  info && info.status !== "running"
                    ? { status: info.status, ...(info.error ? { error: info.error } : {}) }
                    : undefined,
                ),
              ),
          cancel: (sessionID) => background.cancel(sessionID).pipe(Effect.asVoid),
          extend: (sessionID, work) => background.extend({ id: sessionID, run: work.pipe(Effect.as("")) }),
          isRunning: (sessionID) => background.get(sessionID).pipe(Effect.map((info) => info?.status === "running")),
        },
        {
          execute: (input) => {
            cliReceived.push(input)
            if (cliError) return Effect.fail(cliError)
            const done = Effect.succeed({ text: cliResultText, sessionID: cliResultSessionID, status: cliResultStatus })
            if (!cliGate) return done
            return (cliStarted ? Deferred.succeed(cliStarted, undefined) : Effect.void).pipe(
              Effect.andThen(Deferred.await(cliGate)),
              Effect.andThen(done),
            )
          },
        },
        delegationOwner.dispatch,
      ),
    )
  }),
)
const rootServices = Layer.mergeAll(
  TaskDriver.runtimeLayer,
  Database.defaultLayer,
  EventV2.defaultLayer,
  questions,
  SessionProjector.defaultLayer,
  SessionStore.defaultLayer,
  sessionComposition,
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
  delegationExecution,
  taskTool,
).pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      agents,
      permission,
      SessionTask.defaultLayer,
      BackgroundJob.defaultLayer,
      DelegationService.defaultLayer,
    ),
  ),
)

const it = testEffect(taskDriverInitializer.pipe(Layer.provideMerge(rootServices)))

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  requests.length = 0
  taskCallsEmitted = 0
  maxTaskCalls = 1
  nextTaskID = undefined
  childStreamFailures = 0
  streamGate = undefined
  streamStarted = undefined
  backgroundMode = false
  attendedMode = undefined
  cliMode = false
  cliMissingTarget = false
  cliTarget = "claude-code"
  cliResultText = "cli result text"
  cliResultStatus = "success"
  cliError = undefined
  cliGate = undefined
  cliStarted = undefined
  judgeMode = false
  judgeParentTaskID = undefined
  cliReceived.length = 0
  permissionCalls.length = 0
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

// Find the `task` tool's terminal state on the parent's latest assistant turn so
// CLI tests can assert the structured result / error without re-implementing
// message traversal at every call site.
const readTaskToolState = (messages: ReadonlyArray<SessionMessage.Message>): SessionMessage.ToolState | undefined => {
  const assistant = messages.find((message): message is SessionMessage.Assistant => message.type === "assistant")
  const tool = assistant?.content.find(
    (part): part is SessionMessage.AssistantTool => part.type === "tool" && part.name === "task",
  )
  return tool?.state
}

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

      const { db } = yield* Database.Service
      const delegation = yield* DelegationService.Service
      const delegationRow = yield* db
        .select({ id: DelegationTable.id })
        .from(DelegationTable)
        .where(eq(DelegationTable.parent_session_id, parentID))
        .get()
        .pipe(Effect.orDie)
      expect(delegationRow).toBeDefined()
      if (!delegationRow) return
      const state = yield* delegation.foldState(delegationRow.id)
      const turn = state ? [...state.turns.values()][0] : undefined
      const participant = state ? [...state.participants.values()][0] : undefined
      expect(turn).toBeDefined()
      expect(participant).toBeDefined()
      if (!turn || !participant) return
      const inputRow = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.session_id, children[0].id))
        .get()
        .pipe(Effect.orDie)
      expect(inputRow?.delegation_origin).toEqual({
        turnID: turn.id,
        deliveryOrigin: "meta",
        senderParticipantID: participant.id,
      })
      const childUser = childMessages.find((message) => message.type === "user")
      expect(childUser?.type === "user" ? childUser.delegationOrigin : undefined).toEqual({
        turnID: turn.id,
        deliveryOrigin: "meta",
        senderParticipantID: participant.id,
      })
    }),
  )

  it.live("DelegationExecution.drain runs an internal Build through the real SessionRunner", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const service = yield* DelegationService.Service
      const background = yield* BackgroundJob.Service
      const execution = yield* DelegationExecution.Service
      const { db } = yield* Database.Service

      const delegation = yield* service.create({ parentSessionID: parentID, title: "real drain" })
      const participant = yield* service.addParticipant({
        delegationID: delegation.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
      })
      const turn = yield* service.appendTurn({
        delegationID: delegation.id,
        kind: "task",
        promptSummary: "Run the real child runner",
        participantIDs: [participant.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: participant.id },
      })

      yield* execution.drain(delegation.id)

      const admittedState = yield* service.foldState(delegation.id)
      const childSessionID = admittedState?.participants.get(participant.id)?.childSessionID
      expect(childSessionID).toBeDefined()
      if (childSessionID === undefined) return

      const job = yield* background.wait({ id: childSessionID })
      expect(job.info?.status).toBe("completed")

      const childMessages = yield* session.context(childSessionID)
      const childAssistant = childMessages.find((message) => message.type === "assistant")
      const childText =
        childAssistant?.type === "assistant"
          ? childAssistant.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("")
          : ""
      expect(childText).toBe("child result payload")

      const input = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.session_id, childSessionID))
        .get()
        .pipe(Effect.orDie)
      expect(input?.delegation_origin).toEqual({
        turnID: turn.id,
        deliveryOrigin: "meta",
        senderParticipantID: participant.id,
      })
      expect(input?.promoted_seq).toEqual(expect.any(Number))

      const finalState = yield* pollWithTimeout(
        service.foldState(delegation.id).pipe(
          Effect.map((state) => {
            const delivery = state === undefined ? undefined : [...state.deliveries.values()][0]
            return delivery?.status === "completed" ? state : undefined
          }),
        ),
        "real DelegationExecution.drain did not settle the delivery",
      )
      expect(finalState.turns.get(turn.id)?.status).toBe("completed")
      expect(finalState.deliveries.get(JSON.stringify([turn.id, participant.id, "meta", participant.id]))?.status).toBe(
        "completed",
      )
    }),
  )

  it.live("DelegationExecution external jobs report activity and cancel durably", () =>
    Effect.gen(function* () {
      yield* setup
      const gate = yield* Deferred.make<void>()
      const started = yield* Deferred.make<void>()
      cliGate = gate
      cliStarted = started
      const service = yield* DelegationService.Service
      const background = yield* BackgroundJob.Service
      const execution = yield* DelegationExecution.Service

      const delegation = yield* service.create({ parentSessionID: parentID, title: "external lifecycle" })
      const participant = yield* service.addParticipant({
        delegationID: delegation.id,
        provider: "external",
        target: "claude-code",
        role: "reviewer",
        context: "fresh",
      })
      const turn = yield* service.appendTurn({
        delegationID: delegation.id,
        kind: "review",
        promptSummary: "Review the change",
        participantIDs: [participant.id],
        delivery: "steer",
        origin: { deliveryOrigin: "meta", senderParticipantID: participant.id },
      })

      const result = yield* execution.dispatch({
        delegationID: delegation.id,
        participantID: participant.id,
        turnID: turn.id,
        parentID: parentID,
        prompt: "Review the change",
        description: "External review",
        background: true,
        queue: false,
        delivery: {
          delegationID: delegation.id,
          participantID: participant.id,
          turnID: turn.id,
          deliveryOrigin: "meta",
          senderParticipantID: participant.id,
          delivery: "steer",
          attempt: 1,
        },
        execution: "external",
        cliTarget: "claude-code",
      })
      expect(result.status).toBe("running")

      yield* Deferred.await(started)
      expect(yield* execution.isActive(delegation.id)).toBe(true)

      yield* execution.interrupt(delegation.id, participant.id)
      const job = yield* background.wait({ id: `cli_${delegation.id}_${participant.id}` })
      expect(job.info?.status).toBe("cancelled")

      const state = yield* pollWithTimeout(
        service.foldState(delegation.id).pipe(
          Effect.map((current) => {
            const delivery = current === undefined ? undefined : [...current.deliveries.values()][0]
            return delivery?.status === "cancelled" ? current : undefined
          }),
        ),
        "external DelegationExecution delivery did not settle cancelled",
      )
      expect(state.turns.get(turn.id)?.status).toBe("cancelled")
      expect(yield* execution.isActive(delegation.id)).toBe(false)
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
      const childID = children[0].id

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

  it.live("task_id resumes the prior child Session instead of creating a new one", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service

      // First delegation: no task_id → creates child A.
      yield* session.prompt({ sessionID: parentID, prompt: Prompt.make({ text: "delegate" }), resume: false })
      yield* session.resume(parentID)
      const childrenAfterFirst = yield* session.children(parentID)
      expect(childrenAfterFirst.length).toBe(1)
      const childID = childrenAfterFirst[0].id

      // Second delegation: task_id = childA → resumes child A, no new child.
      taskCallsEmitted = 0
      nextTaskID = childID
      yield* session.prompt({ sessionID: parentID, prompt: Prompt.make({ text: "delegate again" }), resume: false })
      yield* session.resume(parentID)
      const childrenAfterSecond = yield* session.children(parentID)
      expect(childrenAfterSecond.length).toBe(1)
      expect(childrenAfterSecond[0].id).toBe(childID)
    }),
  )

  it.live("retries once in the same child Session with a new delivery attempt", () =>
    Effect.gen(function* () {
      yield* setup
      childStreamFailures = 1
      const session = yield* SessionV2.Service
      const background = yield* BackgroundJob.Service

      yield* session.prompt({ sessionID: parentID, prompt: Prompt.make({ text: "delegate" }), resume: false })
      yield* session.resume(parentID)

      // The durable participant owns one child Session across retries. Attempt 1
      // fails, attempt 2 reuses that child and settles the same delivery.
      const children = yield* session.children(parentID)
      expect(children).toHaveLength(1)
      expect((yield* background.get(children[0].id))?.status).toBe("completed")

      const delegation = yield* DelegationService.Service
      const { db } = yield* Database.Service
      const row = yield* db
        .select({ id: DelegationTable.id, status: DelegationTable.status })
        .from(DelegationTable)
        .where(eq(DelegationTable.parent_session_id, parentID))
        .get()
        .pipe(Effect.orDie)
      expect(row).toBeDefined()
      if (!row) return
      const events = yield* DelegationProjector.readEvents(db, row.id)
      const startedAttempts = events
        .filter((event) => event.type === DelegationEvent.DeliveryStarted.type)
        .map((event) => Schema.decodeUnknownSync(DelegationEvent.DeliveryStartedData)(event.data).attempt)
      const completedAttempts = events
        .filter((event) => event.type === DelegationEvent.DeliveryCompleted.type)
        .map((event) => Schema.decodeUnknownSync(DelegationEvent.DeliveryCompletedData)(event.data).attempt)
      const failedAttempts = events
        .filter((event) => event.type === DelegationEvent.DeliveryFailed.type)
        .map((event) => Schema.decodeUnknownSync(DelegationEvent.DeliveryFailedData)(event.data).attempt)
      const childRequests = requests.filter((request) => request.providerOptions?.openai?.promptCacheKey !== parentID)
      expect(childRequests).toHaveLength(2)
      const childMessages = yield* session.context(children[0].id)
      const childTexts = childMessages
        .filter((message) => message.type === "assistant")
        .flatMap((message) => message.content)
        .filter((part) => part.type === "text")
        .map((part) => part.text)
      expect(childTexts).toEqual(["child result payload"])
      expect(startedAttempts).toEqual([1, 2])
      expect(failedAttempts).toEqual([1])
      expect(completedAttempts).toEqual([2])
      const state = yield* delegation.foldState(row.id)
      expect(state?.delegation.status).toBe("approved")
      const delivery = state ? [...state.deliveries.values()][0] : undefined
      expect(delivery?.attempt).toBe(2)
      expect(delivery?.status).toBe("completed")
      expect(state ? [...state.participants.values()][0]?.phase : undefined).toBe("active")
    }),
  )

  it.live("foreground abort cancels the in-flight child drain", () =>
    Effect.gen(function* () {
      yield* setup
      const gate = yield* Deferred.make<void>()
      const started = yield* Deferred.make<void>()
      streamGate = gate
      streamStarted = started
      const session = yield* SessionV2.Service

      // Fork the parent drain; the child's LLM stream blocks on `gate`.
      const fiber = yield* Effect.gen(function* () {
        yield* session.prompt({ sessionID: parentID, prompt: Prompt.make({ text: "delegate" }), resume: false })
        yield* session.resume(parentID)
      }).pipe(Effect.forkIn(yield* Effect.scope))

      // Wait until the child's stream is mid-flight, then abort the parent.
      yield* Deferred.await(started)
      yield* session.interrupt(parentID)
      yield* Deferred.succeed(gate, undefined)

      // The parent drain settles (interrupted).
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)

      // The child was interrupted; no completed assistant text.
      const children = yield* session.children(parentID)
      expect(children.length).toBe(1)
      const childMessages = yield* session.context(children[0].id)
      const childAssistant = childMessages.find((message) => message.type === "assistant")
      const childText =
        childAssistant?.type === "assistant"
          ? childAssistant.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("")
          : ""
      expect(childText).toBe("")
    }),
  )

  it.live("parent interrupt cascades to background child drain", () =>
    Effect.gen(function* () {
      process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS = "true"
      yield* setup
      const gate = yield* Deferred.make<void>()
      const started = yield* Deferred.make<void>()
      streamGate = gate
      streamStarted = started
      backgroundMode = true
      const session = yield* SessionV2.Service
      const background = yield* BackgroundJob.Service
      const delegation = yield* DelegationService.Service
      const { db } = yield* Database.Service

      // Start the parent drain which delegates to a background child.
      const fiber = yield* Effect.gen(function* () {
        yield* session.prompt({ sessionID: parentID, prompt: Prompt.make({ text: "delegate bg" }), resume: false })
        yield* session.resume(parentID)
      }).pipe(Effect.forkIn(yield* Effect.scope))

      // Wait until the child's stream is mid-flight, then interrupt the parent.
      yield* Deferred.await(started)
      const childrenBeforeInterrupt = yield* session.children(parentID)
      expect(childrenBeforeInterrupt).toHaveLength(1)
      const childID = childrenBeforeInterrupt[0].id
      const pending = yield* session.prompt({
        sessionID: childID,
        prompt: Prompt.make({ text: "queued after active delivery" }),
        delivery: "queue",
        resume: false,
      })
      const delegationRow = yield* db
        .select({ id: DelegationTable.id })
        .from(DelegationTable)
        .where(eq(DelegationTable.parent_session_id, parentID))
        .get()
        .pipe(Effect.orDie)
      expect(delegationRow).toBeDefined()
      if (!delegationRow) return
      yield* session.interrupt(parentID)
      yield* Deferred.succeed(gate, undefined)

      // Parent settles (interrupted).
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)

      // The child's background job was cancelled by the cascade.
      const job = yield* background.get(childID)
      expect(job?.status).toBe("cancelled")
      const pendingRows = yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.id, pending.id))
      expect(pendingRows).toHaveLength(1)
      expect(pendingRows[0]?.promoted_seq).toBeNull()

      const state = yield* delegation.foldState(delegationRow.id)
      expect(state?.delegation.status).not.toBe("completed")
      expect(state?.delegation.status).not.toBe("archived")
      expect(state ? [...state.deliveries.values()][0]?.status : undefined).toBe("cancelled")
      const linkedTasks = yield* db
        .select()
        .from(TaskTable)
        .where(eq(TaskTable.session_id, parentID))
        .all()
        .pipe(Effect.orDie)
      expect(linkedTasks.find((task) => task.content === "do work")?.status).toBe("cancelled")
    }),
  )

  it.live("background task_id resume extends a running background job", () =>
    Effect.gen(function* () {
      process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS = "true"
      yield* setup
      const session = yield* SessionV2.Service
      const background = yield* BackgroundJob.Service

      // Block the child's LLM stream so the first background job stays running
      // while the second task call arrives.
      const gate = yield* Deferred.make<void>()
      streamGate = gate

      // Cycle 1: launch a background task (no task_id).
      maxTaskCalls = 1
      backgroundMode = true
      yield* session.prompt({ sessionID: parentID, prompt: Prompt.make({ text: "delegate bg" }), resume: false })
      yield* session.resume(parentID)
      const children = yield* session.children(parentID)
      expect(children.length).toBe(1)
      const childID = children[0].id

      // The background job must still be running (blocked on gate).
      const jobBefore = yield* background.get(childID)
      expect(jobBefore?.status).toBe("running")

      // Cycle 2: resume with task_id → should extend the running job, not start new.
      taskCallsEmitted = 0
      nextTaskID = childID
      backgroundMode = true
      yield* session.prompt({ sessionID: parentID, prompt: Prompt.make({ text: "extend bg" }), resume: false })
      yield* session.resume(parentID)

      // Still one child (reused, not new).
      const childrenAfter = yield* session.children(parentID)
      expect(childrenAfter.length).toBe(1)
      expect(childrenAfter[0].id).toBe(childID)

      // Release the gate: first drain completes, then the extend's queued work
      // runs (admit second prompt, drain, inject). Awaiting the job is the
      // readiness signal that all queued work has settled.
      yield* Deferred.succeed(gate, undefined)
      yield* background.wait({ id: childID })

      // Both prompts were drained (extend queued the second behind the first);
      // a fallback `delegateBackground` would have admitted the second prompt
      // but never drained it (background.start on a running job is a no-op),
      // leaving only one assistant response.
      const childMessages = yield* session.context(childID)
      const assistantCount = childMessages.filter((message) => message.type === "assistant").length
      expect(assistantCount).toBe(2)

      const { db } = yield* Database.Service
      const delegation = yield* DelegationService.Service
      const delegationRow = yield* db
        .select({ id: DelegationTable.id })
        .from(DelegationTable)
        .where(eq(DelegationTable.parent_session_id, parentID))
        .get()
        .pipe(Effect.orDie)
      expect(delegationRow).toBeDefined()
      if (!delegationRow) return
      const state = yield* delegation.foldState(delegationRow.id)
      const turns = state ? [...state.turns.values()].sort((left, right) => left.seq - right.seq) : []
      expect(turns).toHaveLength(2)
      expect(turns[1]?.delivery).toBe("queue")
      const secondDeliveries = state
        ? [...state.deliveries.values()].filter((delivery) => delivery.turnID === turns[1]?.id)
        : []
      expect(secondDeliveries).toHaveLength(1)
      expect(secondDeliveries[0]?.status).toBe("completed")
      expect(
        state
          ? [...state.deliveries.values()].some((delivery) =>
              ["admitted", "queued", "running"].includes(delivery.status),
            )
          : true,
      ).toBe(false)

      const events = yield* DelegationProjector.readEvents(db, delegationRow.id)
      const startedTurnIDs = events
        .filter((event) => event.type === DelegationEvent.DeliveryStarted.type)
        .map((event) => Schema.decodeUnknownSync(DelegationEvent.DeliveryStartedData)(event.data).turnID)
      const completedTurnIDs = events
        .filter((event) => event.type === DelegationEvent.DeliveryCompleted.type)
        .map((event) => Schema.decodeUnknownSync(DelegationEvent.DeliveryCompletedData)(event.data).turnID)
      expect(startedTurnIDs).toContain(turns[1]?.id)
      expect(completedTurnIDs).toContain(turns[1]?.id)
    }),
  )

  it.live("parent interrupt cancels active and queued background deliveries", () =>
    Effect.gen(function* () {
      process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS = "true"
      yield* setup
      const session = yield* SessionV2.Service
      const background = yield* BackgroundJob.Service
      const delegation = yield* DelegationService.Service
      const { db } = yield* Database.Service
      const gate = yield* Deferred.make<void>()
      const started = yield* Deferred.make<void>()
      streamGate = gate
      streamStarted = started
      backgroundMode = true

      yield* session.prompt({ sessionID: parentID, prompt: Prompt.make({ text: "delegate bg" }), resume: false })
      yield* session.resume(parentID)
      yield* Deferred.await(started)
      const children = yield* session.children(parentID)
      expect(children).toHaveLength(1)
      const childID = children[0].id

      taskCallsEmitted = 0
      nextTaskID = childID
      backgroundMode = true
      yield* session.prompt({ sessionID: parentID, prompt: Prompt.make({ text: "queue bg" }), resume: false })
      yield* session.resume(parentID)

      const delegationRow = yield* db
        .select({ id: DelegationTable.id })
        .from(DelegationTable)
        .where(eq(DelegationTable.parent_session_id, parentID))
        .get()
        .pipe(Effect.orDie)
      expect(delegationRow).toBeDefined()
      if (!delegationRow) return
      const before = yield* delegation.foldState(delegationRow.id)
      expect(before ? [...before.deliveries.values()].map((delivery) => delivery.status).sort() : []).toEqual([
        "queued",
        "running",
      ])

      yield* session.interrupt(parentID)

      expect((yield* background.get(childID))?.status).toBe("cancelled")
      const after = yield* delegation.foldState(delegationRow.id)
      expect(after ? [...after.deliveries.values()].map((delivery) => delivery.status) : []).toEqual([
        "cancelled",
        "cancelled",
      ])
      const linkedTasks = yield* db
        .select()
        .from(TaskTable)
        .where(eq(TaskTable.session_id, parentID))
        .all()
        .pipe(Effect.orDie)
      expect(linkedTasks).toHaveLength(2)
      expect(linkedTasks.every((task) => task.status === "cancelled")).toBe(true)
    }),
  )

  it.live("attended=true propagates to the child Session", () =>
    Effect.gen(function* () {
      yield* setup
      attendedMode = true
      const session = yield* SessionV2.Service

      yield* session.prompt({ sessionID: parentID, prompt: Prompt.make({ text: "delegate attended" }), resume: false })
      yield* session.resume(parentID)

      const children = yield* session.children(parentID)
      expect(children.length).toBe(1)
      // The child Session carries attended=true so PermissionV2.configured
      // preserves ask rules (user will respond).
      expect(children[0]?.attended).toBe(true)
    }),
  )

  it.live("attended defaults to false when omitted (unattended child)", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service

      yield* session.prompt({
        sessionID: parentID,
        prompt: Prompt.make({ text: "delegate unattended" }),
        resume: false,
      })
      yield* session.resume(parentID)

      const children = yield* session.children(parentID)
      expect(children.length).toBe(1)
      // No attended passed → defaults to false → ask rules converted to deny.
      expect(children[0]?.attended).toBe(false)
    }),
  )

  it.live("isChildSession returns true for child Sessions and false for root", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service

      yield* session.prompt({ sessionID: parentID, prompt: Prompt.make({ text: "delegate" }), resume: false })
      yield* session.resume(parentID)

      const children = yield* session.children(parentID)
      expect(children.length).toBe(1)
      const childID = children[0].id

      // Parent (root) is not a child session.
      expect(yield* TaskDriver.isChildSession(parentID)).toBe(false)
      // Child session has a parentID → isChildSession returns true.
      expect(yield* TaskDriver.isChildSession(childID)).toBe(true)
    }),
  )

  it.live("R6 external-cli tool result carries sessionId/cli/execution_type/status metadata", () =>
    Effect.gen(function* () {
      yield* setup
      cliMode = true
      cliTarget = "claude-code"
      cliResultText = "cli output text"
      cliResultStatus = "success"
      const session = yield* SessionV2.Service

      yield* session.prompt({ sessionID: parentID, prompt: Prompt.make({ text: "delegate cli" }), resume: false })
      yield* session.resume(parentID)

      const state = yield* session.context(parentID).pipe(Effect.map(readTaskToolState))
      expect(state?.status).toBe("completed")
      // The tool's raw Output (with metadata) is persisted as the structured
      // result, not `state.result` (which is the model-facing ToolResultValue).
      const structured = state?.status === "completed" ? state.structured : undefined
      expect(structured?.["sessionID"]).toBe(cliResultSessionID)
      expect(structured?.["metadata"]).toMatchObject({
        sessionId: cliResultSessionID,
        parentSessionId: parentID,
        cli: "claude-code",
        execution_type: "external-cli",
        status: "success",
      })
    }),
  )

  it.live("R7 external-cli failure renders task_error instead of a fixed completed state", () =>
    Effect.gen(function* () {
      yield* setup
      cliMode = true
      cliResultStatus = "failed"
      cliResultText = "cli failed output"
      const session = yield* SessionV2.Service

      yield* session.prompt({
        sessionID: parentID,
        prompt: Prompt.make({ text: "delegate failing cli" }),
        resume: false,
      })
      yield* session.resume(parentID)

      const state = yield* session.context(parentID).pipe(Effect.map(readTaskToolState))
      expect(state?.status).toBe("completed")
      const structured = state?.status === "completed" ? state.structured : undefined
      expect(structured?.["output"]).toContain("task_error")
      expect(structured?.["output"]).toContain("cli failed output")
      expect(structured?.["metadata"]).toMatchObject({ status: "failed" })
    }),
  )

  it.live("R8 external-cli without cli_target fails with ToolFailure", () =>
    Effect.gen(function* () {
      yield* setup
      cliMode = true
      cliMissingTarget = true
      const session = yield* SessionV2.Service

      yield* session.prompt({
        sessionID: parentID,
        prompt: Prompt.make({ text: "delegate missing target" }),
        resume: false,
      })
      yield* session.resume(parentID)

      const state = yield* session.context(parentID).pipe(Effect.map(readTaskToolState))
      expect(state?.status).toBe("error")
      const error = state?.status === "error" ? state.error : undefined
      expect(error?.message).toContain("cli_target is required")
    }),
  )

  it.live("R9 external-cli permission assert carries resources:[cli_target] + metadata", () =>
    Effect.gen(function* () {
      yield* setup
      cliMode = true
      cliTarget = "gemini"
      const session = yield* SessionV2.Service

      yield* session.prompt({
        sessionID: parentID,
        prompt: Prompt.make({ text: "delegate with permission" }),
        resume: false,
      })
      yield* session.resume(parentID)

      const call = permissionCalls.at(-1)
      expect(call).toMatchObject({
        action: "task",
        resources: ["gemini"],
        metadata: { description: "do work", execution_type: "external-cli" },
      })
    }),
  )

  it.live("R10 external-cli creates a session_task record that settles completed", () =>
    Effect.gen(function* () {
      yield* setup
      cliMode = true
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service

      yield* session.prompt({
        sessionID: parentID,
        prompt: Prompt.make({ text: "delegate with task link" }),
        resume: false,
      })
      yield* session.resume(parentID)

      const rows = yield* db.select().from(TaskTable).where(eq(TaskTable.session_id, parentID)).all().pipe(Effect.orDie)
      const linked = rows.find((row) => row.content === "do work")
      expect(linked).toBeDefined()
      expect(linked?.status).toBe("completed")
    }),
  )

  it.live("external-cli executor failure still settles the linked task failed", () =>
    Effect.gen(function* () {
      yield* setup
      cliMode = true
      cliError = new Error("cli unavailable")
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service

      yield* session.prompt({
        sessionID: parentID,
        prompt: Prompt.make({ text: "delegate failing cli" }),
        resume: false,
      })
      yield* session.resume(parentID)

      // The tool call errored, but the auto-created track-B task settled
      // failed instead of leaking an in_progress row.
      const state = yield* session.context(parentID).pipe(Effect.map(readTaskToolState))
      expect(state?.status).toBe("error")
      const rows = yield* db.select().from(TaskTable).where(eq(TaskTable.session_id, parentID)).all().pipe(Effect.orDie)
      const linked = rows.find((row) => row.content === "do work")
      expect(linked?.status).toBe("failed")
    }),
  )

  it.live("parent abort during external-cli settles the linked task cancelled", () =>
    Effect.gen(function* () {
      yield* setup
      cliMode = true
      const gate = yield* Deferred.make<void>()
      const started = yield* Deferred.make<void>()
      cliGate = gate
      cliStarted = started
      const session = yield* SessionV2.Service
      const delegation = yield* DelegationService.Service
      const { db } = yield* Database.Service

      // Fork the parent drain; the CLI executor blocks on `gate` mid-dispatch.
      const fiber = yield* Effect.gen(function* () {
        yield* session.prompt({ sessionID: parentID, prompt: Prompt.make({ text: "delegate cli" }), resume: false })
        yield* session.resume(parentID)
      }).pipe(Effect.forkIn(yield* Effect.scope))

      // The dispatch is in flight once the executor signals; abort the parent.
      yield* Deferred.await(started)
      yield* session.interrupt(parentID)
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)

      // The interrupt-only exit settled the track-B task cancelled. The settle
      // runs on the drain fiber's interrupt continuation, so poll the row
      // until it leaves in_progress (readiness signal, never a bare sleep).
      const linked = yield* pollWithTimeout(
        db
          .select()
          .from(TaskTable)
          .where(eq(TaskTable.session_id, parentID))
          .all()
          .pipe(
            Effect.orDie,
            Effect.map((rows) => {
              const row = rows.find((item) => item.content === "do work")
              return row && row.status !== "in_progress" ? row : undefined
            }),
          ),
        "external-cli linked task did not settle after parent abort",
      )
      expect(linked.status).toBe("cancelled")

      const delegationRow = yield* db
        .select({ id: DelegationTable.id })
        .from(DelegationTable)
        .where(eq(DelegationTable.parent_session_id, parentID))
        .get()
        .pipe(Effect.orDie)
      expect(delegationRow).toBeDefined()
      if (delegationRow === undefined) return
      const state = yield* pollWithTimeout(
        delegation.foldState(delegationRow.id).pipe(
          Effect.map((folded) => {
            const delivery = folded === undefined ? undefined : [...folded.deliveries.values()][0]
            return delivery?.status === "cancelled" ? folded : undefined
          }),
        ),
        "external-cli delivery did not settle cancelled after parent abort",
      )
      expect([...state.deliveries.values()][0]?.status).toBe("cancelled")
    }),
  )

  it.live("judge delegation claims and settles the linked parent task failed when every delegate fails", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const tasks = yield* SessionTask.Service
      const [parentTask] = yield* tasks.append({
        sessionID: parentID,
        tasks: [{ content: "judge link", status: "pending", priority: "medium" }],
      })
      judgeMode = true
      judgeParentTaskID = parentTask.id
      // Every judge child's stream fails → DelegateError "All judge delegates failed".
      childStreamFailures = 10

      yield* session.prompt({ sessionID: parentID, prompt: Prompt.make({ text: "judge this" }), resume: false })
      yield* session.resume(parentID)

      const state = yield* session.context(parentID).pipe(Effect.map(readTaskToolState))
      expect(state?.status).toBe("error")
      // The track-A parent task was claimed (pending → in_progress) and then
      // settled failed by the dispatch exit.
      const after = (yield* tasks.get(parentID)).find((task) => task.id === parentTask.id)
      expect(after?.status).toBe("failed")
    }),
  )
})
