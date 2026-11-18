export * as Session from "./session.js"
export * from "./session/schema.js"

import { Cause, Effect, Layer, Schema, Context, Stream, Option } from "effect"
import { LLMClient } from "@aigcfroge/ai"
import { ListAnchor } from "@aigcfroge/schema/session"
import { and, desc, eq } from "drizzle-orm"
import { Project } from "./project.js"
import { Model } from "./model.js"
import { ModelGroup } from "./model-group.js"
import { ModelResolver } from "./model-resolver.js"
import { MetaAgent } from "@aigcfroge/schema/meta-agent"
import { MetaAgentService } from "./meta-agent/service.js"
import { Location } from "./location.js"
import type { FileSystem } from "./filesystem.js"
import { SessionMessage } from "./session/message.js"
import { PromptInput } from "@aigcfroge/schema/prompt-input"
import { Bus } from "./bus.js"
import { Instance } from "./instance/service.js"
import { Database } from "./database/database.js"
import { SessionProjector } from "./session/projector.js"
import { SessionMessageTable } from "./session/sql.js"
import { SessionSchema } from "./session/schema.js"
import { RelativePath } from "./schema.js"
import { Agent } from "./agent.js"
import { Permission } from "./permission.js"
import { App } from "./app.js"
import { Slug } from "./util/slug.js"
import path from "path"
import { SessionRunner } from "./session/runner/index.js"
import { SessionStore } from "./session/store.js"
import { SessionExecution } from "./session/execution.js"
import {
  AttachmentError,
  BusyError,
  ControllerConflictError,
  bindingMatches,
  sameExecutor,
  sameModel,
  CompactionConflictError,
  ForkConflictError,
  ForkEmptyError,
  InboxConflictError,
  MessageDecodeError,
  MessageNotFoundError,
  NotFoundError,
  PromptConflictError,
  SkillNotFoundError,
  SyntheticConflictError,
} from "./session/error.js"
import { Node } from "@aigcfroge/util/effect/app-node"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { SessionEvent } from "./session/event.js"
import { SessionTaskEvent } from "@aigcfroge/schema/session-task-event"
import { SessionCommunication } from "@aigcfroge/schema/session-communication"
import { CommunicationRecord } from "./session/communication-record.js"
import { SessionInbox } from "./session/inbox.js"
import { SessionConsultation } from "@aigcfroge/schema/session-consultation"
import { Consultation, ConsultationConflictError, InvalidConsultationError } from "./session/consultation.js"
import { SessionConsultationReference } from "./session/consultation-reference.js"
import { SessionPrompt } from "./session/prompt.js"
import { InstructionState } from "./session/instruction-state.js"
import { SessionGenerate } from "./session/generate.js"
import { SessionCommand } from "./session/command.js"
import {
  SessionMove,
  DestinationNotFoundError,
  DestinationNotDirectoryError,
  DestinationUnavailableError,
} from "./session/move.js"
import { SessionModelTransport } from "./session/model-transport.js"
import { llmClient } from "./effect/app-node-platform.js"
import { Snapshot } from "./snapshot.js"
import { Session } from "./session/session.js"
import { SessionDiff, TurnRangeError } from "./session/diff.js"
import { LocationServiceMap } from "./location-service-map.js"
import { FSUtil } from "@aigcfroge/util/fs-util"
import type { EventLog } from "@aigcfroge/schema/event-log"
import type { FileDiff } from "@aigcfroge/schema/file-diff"
import { Job } from "./job.js"
import type { Command } from "./command.js"
import { SessionEnvironment } from "./session/environment.js"
import { InstructionEntry } from "./session/instruction-entry.js"
import { Composition } from "@aigcfroge/schema/composition"
import { ProductMode } from "@aigcfroge/schema/product-mode"
import { CompositionResolver } from "./composition-resolver.js"
import { CompositionDigest } from "./composition/digest.js"
import { SessionComposition } from "./session/composition.js"
import { WorkflowRun } from "./workflow/workflow-run.js"
import { ProductModePolicy } from "./product-mode-policy.js"
import { Plugin } from "./plugin/service.js"
import { SessionTask } from "./session/task.js"
import { TaskOperation, OperationConflictError } from "./session/task-operation.js"
import { SessionIdentity } from "@aigcfroge/schema/session-identity"
import { Event } from "@aigcfroge/schema/event"
import { SessionInputResult } from "./session/input-result.js"
import { SubagentCompletion } from "./session/subagent-completion.js"
import { SessionNotification } from "./session/notification.js"
import { SessionGoal } from "./session/goal.js"
import { KeyedMutex } from "./effect/keyed-mutex.js"
import { ScheduleService } from "./session/schedule-service.js"
import { Schedule } from "@aigcfroge/schema/schedule"

// get project -> project.locations
//
// get all sessions
//

// - by project
//   - by subpath
// - by workspace (home is special)

export { ListAnchor }

export const ListInput = SessionStore.ListInput
export type ListInput = SessionStore.ListInput

/** Resolve a new dispatch once; adopted children and participants retain their original binding. */
export const resolveExecutor = Effect.fn("Session.resolveExecutor")(function* (
  parent: SessionSchema.Info,
  agent: Agent.Info,
  requested?: Model.Selection,
) {
  if (parent.controller?.kind !== "root")
    return yield* new ControllerConflictError({
      sessionID: parent.id,
      field: "controller",
      kind: "meta_dispatch_unsupported",
      message: "New Meta dispatch requires a root owner",
    })
  yield* Plugin.awaitActivation
  const preference = parent.executorPreference?.agent === agent.id ? parent.executorPreference.model : undefined
  const model = requested ?? preference ?? agent.model ?? parent.model
  if (!model)
    return yield* new ControllerConflictError({
      sessionID: parent.id,
      field: "model",
      kind: "executor_model_missing",
      message: "No executor model is available",
    })
  const source = requested ? "tool" : preference ? "preference" : agent.model ? "agent" : "session"
  if (Model.Selection.isGroup(model)) {
    const live = yield* ModelGroup.behavior(model.groupID).pipe(Effect.mapError((error) => new ControllerConflictError({
      sessionID: parent.id, field: "model", kind: "executor_model_unavailable", message: error.message,
    })))
    const frozen = parent.mode === "custom"
      ? yield* Effect.gen(function* () {
          const compositions = yield* SessionComposition.Service
          return yield* compositions.get(parent.id)
        }).pipe(Effect.mapError((error) => new ControllerConflictError({
          sessionID: parent.id, field: "executor", kind: "executor_snapshot_unavailable", message: error.message,
        })))
      : undefined
    const inherited = frozen?.version === 2
      ? source === "agent" ? frozen.data.executors?.find((executor) => executor.id === agent.id)?.groupBehavior
        : source === "session" ? frozen.data.groupBehavior : undefined
      : undefined
    if (frozen && (source === "agent" || source === "session") && inherited?.groupID !== model.groupID)
      return yield* new ControllerConflictError({
        sessionID: parent.id, field: "model", kind: "executor_group_behavior_missing", message: "The frozen executor does not contain this model group's behavior",
      })
    return new SessionSchema.ExecutorBinding({ agent: agent.id, model, groupBehavior: inherited ?? live, source })
  }
  const catalog = yield* Model.Service
  const resolver = yield* ModelResolver.Service
  const selected = (yield* catalog.available()).find(
    (item) => item.id === model.id && item.providerID === model.providerID,
  )
  if (!selected)
    return yield* new ControllerConflictError({
      sessionID: parent.id,
      field: "model",
      kind: "executor_model_unavailable",
      message: "Executor model is unavailable",
    })
  const resolved = yield* resolver.resolveModel(selected, model.variant).pipe(
    Effect.mapError(
      (error) =>
        new ControllerConflictError({
          sessionID: parent.id,
          field: "model",
          kind: "executor_model_invalid",
          message: error.message,
        }),
    ),
  )
  return new SessionSchema.ExecutorBinding({
    agent: agent.id,
    model: resolved.ref,
    source,
  })
})

type CreateBaseInput = {
  id?: SessionSchema.ID
  mode?: ProductMode.ID
  title?: string
  agent?: Agent.ID
  model?: Model.Selection
  metadata?: SessionSchema.Metadata
  permissions?: Permission.Ruleset
  control?: "meta"
  executorPreference?: SessionSchema.ExecutorPreference
  consultation?: NonNullable<SessionEvent.Created["data"]["consultation"]>
}
type CreateInput = CreateBaseInput &
  (
    | { location: Location.Ref; parentID?: never; executor?: never; source?: never; frozenSnapshot?: never }
    | {
        parentID: SessionSchema.ID
        location?: never
        executor?: SessionSchema.ExecutorBinding
        source?: SessionSchema.ControllerSource
        frozenSnapshot?: Composition.SnapshotV2
      }
  )

type CompactInput = Parameters<Session.Handle["compact"]>[0] & { sessionID: SessionSchema.ID }

type ForkInput = {
  sessionID: SessionSchema.ID
  before?: SessionMessage.ID
  through?: SessionMessage.ID
  id?: SessionSchema.ID
  child?: boolean
  agent?: Agent.ID
  control?: "meta"
  model?: Model.Selection
  executorPreference?: SessionSchema.ExecutorPreference
  expectedSource?: SessionSchema.ForkExpectedSource
  executor?: SessionSchema.ExecutorBinding
  source?: SessionSchema.ControllerSource
}

type CreateCustomInput = {
  id?: SessionSchema.ID
  location: Location.Ref
  composition: Composition.CompositionInput
  expectedPlanDigest?: Composition.Digest
  title?: string
  model?: Model.Selection
  executorPreference?: SessionSchema.ExecutorPreference
}

type UpgradeCustomInput = {
  sessionID: SessionSchema.ID
  composition: Composition.CompositionInput
  expectedPlanDigest?: Composition.Digest
  title?: string
  model?: Model.Selection
  executorPreference?: SessionSchema.ExecutorPreference
}

export class CompositionConflictError extends Schema.TaggedError<CompositionConflictError>()(
  "Session.CompositionConflictError",
  {
    sessionID: SessionSchema.ID,
    reason: Schema.String,
  },
) {}

export class UpgradeSourceModeError extends Schema.TaggedError<UpgradeSourceModeError>()(
  "Session.UpgradeSourceModeError",
  {
    sessionID: SessionSchema.ID,
    mode: ProductMode.ID,
  },
) {}

export class UpgradeSourceMovedError extends Schema.TaggedError<UpgradeSourceMovedError>()(
  "Session.UpgradeSourceMovedError",
  {
    sessionID: SessionSchema.ID,
    expected: Location.Ref,
    actual: Location.Ref,
  },
) {}

type CreateError =
  | NotFoundError
  | Agent.AgentNotAllowedError
  | CompositionConflictError
  | SessionComposition.Error
  | ProductModePolicy.UnsupportedProductModeError
  | ControllerConflictError
  | FileSystem.DirectoryNotFoundError
type CreateCustomError = CreateError | Composition.ResolveError | FileSystem.DirectoryNotFoundError
type UpgradeCustomError = CreateCustomError | UpgradeSourceModeError | UpgradeSourceMovedError | BusyError
type ForkError = CreateError | MessageNotFoundError | ForkEmptyError | ForkConflictError
type ConsultationError =
  | CreateError
  | Effect.Error<ReturnType<typeof SessionConsultationReference.freeze>>
  | Effect.Error<ReturnType<typeof SessionPrompt.prepare>>
  | ConsultationConflictError
  | InvalidConsultationError
  | BusyError

export { ConsultationConflictError, InvalidConsultationError }

export {
  AttachmentError,
  BusyError,
  CompactionConflictError,
  ForkConflictError,
  InboxConflictError,
  MessageDecodeError,
  MessageNotFoundError,
  NotFoundError,
  PromptConflictError,
  SkillNotFoundError,
  SyntheticConflictError,
}
type InboxItemRef = { readonly sessionID: SessionSchema.ID; readonly inboxID: SessionMessage.ID }
type TaskDispatchError = NotFoundError | ControllerConflictError | SessionTask.TaskWriteError | OperationConflictError
const taskResultLocks = KeyedMutex.makeUnsafe<string>()

export { DestinationNotFoundError, DestinationNotDirectoryError, DestinationUnavailableError }
export { TurnRangeError }

export interface Interface {
  readonly dispatchTask: (
    input: { readonly sessionID: SessionSchema.ID; readonly request: SessionTask.OperationRequest },
    options?: { readonly source?: SessionTask.OperationSource; readonly targetSessionID?: SessionSchema.ID },
  ) => Effect.Effect<SessionTask.OperationInfo, TaskDispatchError>
  readonly cancelTaskOperation: (
    input: TaskOperation.Ref,
  ) => Effect.Effect<SessionTask.OperationInfo, NotFoundError | OperationConflictError>
  readonly reconcileTaskOperation: (input: TaskOperation.Ref) => Effect.Effect<SessionTask.OperationInfo | undefined>
  readonly waitTaskOperation: (
    input: TaskOperation.Ref,
  ) => Effect.Effect<SessionTask.OperationInfo, OperationConflictError>
  readonly recoverTaskOperations: Effect.Effect<void>
  readonly list: (input?: ListInput) => Effect.Effect<{
    readonly data: SessionSchema.Info[]
  }>
  readonly create: (input: CreateInput) => Effect.Effect<SessionSchema.Info, CreateError>
  readonly createConsultation: (
    input: SessionConsultation.Input & { readonly sourceSessionID: SessionSchema.ID },
  ) => Effect.Effect<SessionConsultation.Data, ConsultationError>
  readonly getConsultation: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<SessionConsultation.Read, NotFoundError | ConsultationConflictError>
  readonly createCustom: (input: CreateCustomInput) => Effect.Effect<Composition.StartResponse, CreateCustomError>
  readonly upgradeCustom: (input: UpgradeCustomInput) => Effect.Effect<Composition.StartResponse, UpgradeCustomError>
  readonly fork: (input: ForkInput) => Effect.Effect<SessionSchema.Info, ForkError>
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<SessionSchema.Info, NotFoundError>
  readonly environment: (input: {
    readonly sessionID: SessionSchema.ID
    readonly variables?: SessionEnvironment.Variables
  }) => Effect.Effect<SessionEnvironment.Variables | undefined, NotFoundError>
  readonly view: (input: { sessionID: SessionSchema.ID; idle: number }) => Effect.Effect<void, NotFoundError>
  readonly remove: (sessionID: SessionSchema.ID) => Effect.Effect<void, NotFoundError>
  readonly messages: (
    input: SessionStore.MessagesInput,
  ) => Effect.Effect<SessionMessage.Info[], NotFoundError | MessageDecodeError>
  readonly message: (input: {
    sessionID: SessionSchema.ID
    messageID: SessionMessage.ID
  }) => Effect.Effect<SessionMessage.Info | undefined>
  readonly context: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<SessionMessage.Info[], NotFoundError | MessageDecodeError>
  /** Structured diffs of the files changed by a turn or range of turns; see `SessionDiff.turn`. */
  readonly diff: (input: {
    readonly sessionID: SessionSchema.ID
    readonly from?: SessionMessage.ID
    readonly to?: SessionMessage.ID
    readonly context?: number
  }) => Effect.Effect<
    readonly FileDiff.Info[],
    NotFoundError | MessageNotFoundError | TurnRangeError | Snapshot.Error | FileSystem.DirectoryNotFoundError
  >
  /**
   * Durable admitted session work not yet visible in projected history,
   * ordered by admission. Includes unpromoted user and synthetic inputs and
   * unhandled compaction barriers.
   */
  readonly inbox: (sessionID: SessionSchema.ID) => Effect.Effect<SessionInbox.Info[], NotFoundError>
  readonly cancelInbox: (input: InboxItemRef) => Effect.Effect<void, NotFoundError | InboxConflictError>
  readonly steerInbox: (input: InboxItemRef) => Effect.Effect<void, NotFoundError | InboxConflictError>
  readonly queueInbox: (input: InboxItemRef) => Effect.Effect<void, NotFoundError | InboxConflictError>
  /**
   * Durable, ordered session log read. Replays durable session bus after
   * the exclusive `after` cursor, emits a `Synced` marker at the captured
   * replay watermark, then continues live when `follow` is set.
   * The marker's seq may exceed the last emitted event because other durable
   * bus share the aggregate's sequence space.
   */
  readonly log: (input: {
    sessionID: SessionSchema.ID
    after?: number
    follow?: boolean
  }) => Stream.Stream<SessionEvent.DurableEvent | SessionTaskEvent.DurableEvent | EventLog.Synced, NotFoundError>
  readonly switchAgent: (input: {
    sessionID: SessionSchema.ID
    agent: Agent.ID
    model?: Model.Selection
  }) => Effect.Effect<
    void,
    | NotFoundError
    | Agent.AgentNotAllowedError
    | ProductModePolicy.UnsupportedProductModeError
    | SessionComposition.Error
    | ControllerConflictError
    | FileSystem.DirectoryNotFoundError
  >
  readonly switchModel: (input: {
    sessionID: SessionSchema.ID
    model: Model.Selection
  }) => Effect.Effect<
    void,
    | NotFoundError
    | ProductModePolicy.UnsupportedProductModeError
    | SessionComposition.Error
    | ControllerConflictError
    | FileSystem.DirectoryNotFoundError
  >
  readonly selectExecutor: (input: {
    sessionID: SessionSchema.ID
    executorPreference: SessionSchema.ExecutorPreference
  }) => Effect.Effect<SessionSchema.Info, NotFoundError | ControllerConflictError | FileSystem.DirectoryNotFoundError>
  readonly rename: (input: { sessionID: SessionSchema.ID; title: string }) => Effect.Effect<void, NotFoundError>
  readonly setMetadata: (input: {
    sessionID: SessionSchema.ID
    metadata: SessionSchema.Metadata
  }) => Effect.Effect<void, NotFoundError>
  readonly setPermissions: (input: {
    sessionID: SessionSchema.ID
    permissions: Permission.Ruleset
  }) => Effect.Effect<void, NotFoundError>
  readonly move: SessionMove.Interface["move"]
  readonly prompt: (
    input: Parameters<Session.Handle["prompt"]>[0] & { sessionID: SessionSchema.ID },
  ) => ReturnType<Session.Handle["prompt"]>
  /** Generates text from current Session context without admitting input or mutating history. */
  readonly generate: (input: {
    sessionID: SessionSchema.ID
    prompt: string
  }) => Effect.Effect<string, NotFoundError | SessionGenerate.Error>
  readonly command: (input: {
    sessionID: SessionSchema.ID
    command: string
    text: string
    files?: PromptInput.Prompt["files"]
    agents?: PromptInput.Prompt["agents"]
    skills?: PromptInput.Prompt["skills"]
    delivery?: SessionInbox.Delivery
  }) => Effect.Effect<
    void,
    | NotFoundError
    | Command.NotFoundError
    | Command.ExecutionError
    | FileSystem.DirectoryNotFoundError
    | ProductModePolicy.UnsupportedProductModeError
  >
  readonly shell: (
    input: Parameters<Session.Handle["shell"]>[0] & { sessionID: SessionSchema.ID },
  ) => ReturnType<Session.Handle["shell"]>
  readonly skill: (
    input: Parameters<Session.Handle["skill"]>[0] & { sessionID: SessionSchema.ID },
  ) => ReturnType<Session.Handle["skill"]>
  readonly compact: (
    input: CompactInput,
  ) => Effect.Effect<
    SessionInbox.Compaction,
    NotFoundError | CompactionConflictError | ProductModePolicy.UnsupportedProductModeError
  >
  readonly wait: (id: SessionSchema.ID) => Effect.Effect<void, NotFoundError>
  readonly active: Effect.Effect<ReadonlySet<SessionSchema.ID>>
  readonly background: (sessionID: SessionSchema.ID) => Effect.Effect<void, NotFoundError>
  readonly resume: (sessionID: SessionSchema.ID) => Effect.Effect<void, NotFoundError | SessionRunner.RunError>
  readonly interrupt: (sessionID: SessionSchema.ID, options?: { readonly resume?: boolean }) => Effect.Effect<boolean>
  readonly synthetic: (
    input: Parameters<Session.Handle["synthetic"]>[0] & { sessionID: SessionSchema.ID },
    options?: Parameters<Session.Handle["synthetic"]>[1],
  ) => ReturnType<Session.Handle["synthetic"]>
  readonly revert: {
    readonly stage: (input: {
      sessionID: SessionSchema.ID
      messageID: SessionMessage.ID
      files?: boolean
    }) => Effect.Effect<
      SessionSchema.Revert,
      NotFoundError | MessageNotFoundError | BusyError | Snapshot.Error | FileSystem.DirectoryNotFoundError
    >
    readonly clear: (
      sessionID: SessionSchema.ID,
    ) => Effect.Effect<void, NotFoundError | BusyError | Snapshot.Error | FileSystem.DirectoryNotFoundError>
    readonly commit: (sessionID: SessionSchema.ID) => Effect.Effect<void, NotFoundError | BusyError>
  }
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/Session") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const app = yield* App.Metadata
    const database = yield* Database.Service
    const db = database.db
    const bus = yield* Bus.Service
    const projects = yield* Project.Service
    const execution = yield* SessionExecution.Service
    const llm = yield* LLMClient.Service
    const transport = yield* SessionModelTransport.Service
    const store = yield* SessionStore.Service
    const instances = yield* Instance.Service
    const admission = yield* SessionInbox.Service
    const fs = yield* FSUtil.Service
    const moves = yield* SessionMove.Service
    const jobs = yield* Job.Service
    const environments = yield* SessionEnvironment.Service
    const locations = yield* LocationServiceMap.Service
    const compositions = yield* SessionComposition.Service
    const workflowRuns = yield* WorkflowRun.Service
    const metas = yield* MetaAgentService.Service
    const tasks = yield* SessionTask.Service
    const goals = yield* SessionGoal.Service
    const schedules = yield* ScheduleService.Service
    const sessions = yield* Session.make()
    const isDurableSessionEvent = Schema.is(Schema.Union([SessionEvent.Durable, SessionTaskEvent.Durable]))

    const operationJobID = (operation: TaskOperation.Ref) =>
      `task.operation.prepare:${operation.sessionID}:${operation.operationID}`
    const operationSelection = (operation: SessionTask.OperationInfo): SessionIdentity.CoordinationSelection => ({
      agent: operation.selection.agent,
      ...(operation.selection.eventID
        ? { event: { id: operation.selection.eventID, seq: operation.selection.seq } }
        : {}),
      ...(operation.selection.compositionDigest ? { compositionDigest: operation.selection.compositionDigest } : {}),
    })
    const reconcileTaskOperation: Interface["reconcileTaskOperation"] = Effect.fn("Session.reconcileTaskOperation")(
      (ref: TaskOperation.Ref) =>
        taskResultLocks.withLock(JSON.stringify([ref.sessionID, ref.operationID]))(
          Effect.gen(function* () {
            const saved = yield* tasks.operation(ref)
            if (!saved || !saved.targetSessionID) return saved
            const targetSessionID = saved.targetSessionID
            const target = yield* store.get(targetSessionID)
            const current =
              !target &&
              saved.admission &&
              !["settled", "failed", "cancelled", "blocked", "superseded"].includes(saved.phase)
                ? yield* tasks
                    .advanceOperation({
                      ...ref,
                      change: new SessionTask.OperationChange({
                        phase: "failed",
                        error: new SessionTask.OperationError({
                          code: "target_unavailable",
                          message: "The target Session was deleted",
                        }),
                      }),
                    })
                    .pipe(Effect.orDie)
                : saved
            const completion = ["admitted", "running"].includes(current.phase)
              ? yield* SessionInputResult.read(db, { sessionID: targetSessionID, inputID: current.inputID }).pipe(
                  Effect.orDie,
                )
              : undefined
            const completed =
              completion?.status === "completed" ||
              completion?.status === "failed" ||
              completion?.status === "interrupted"
            const text =
              completion?.status === "completed"
                ? SubagentCompletion.text(completion.assistant)
                : completion?.status === "failed"
                  ? (completion.error?.message ?? "Task execution failed")
                  : completion?.status === "interrupted"
                    ? "Task execution was interrupted"
                    : undefined
            const observed =
              completed && text !== undefined
                ? yield* tasks
                    .advanceOperation({
                      ...ref,
                      change: new SessionTask.OperationChange({
                        phase:
                          completion.status === "completed"
                            ? "settled"
                            : completion.status === "interrupted"
                              ? "cancelled"
                              : "failed",
                        result: new SessionTask.OperationResultRef({
                          sessionID: targetSessionID,
                          inputID: current.inputID,
                          messageIDs: completion.status === "completed" ? [completion.assistant.id] : undefined,
                          sharedInputs: completion.sharedInputs,
                          resultEventID: completion.resultEventID,
                          text,
                          digest: SessionTask.OperationDigest.make(
                            CompositionDigest.computeDigest({
                              text,
                              inputID: current.inputID,
                              resultEventID: completion.resultEventID,
                            }),
                          ),
                        }),
                        error:
                          completion.status === "failed"
                            ? new SessionTask.OperationError({ code: "session_failed", message: text })
                            : undefined,
                      }),
                    })
                    .pipe(Effect.orDie)
                : current
            const failureText = observed.error?.message ?? `Task operation ${observed.operationID}: ${observed.phase}`
            const operation =
              observed.result === undefined && ["failed", "cancelled", "blocked", "superseded"].includes(observed.phase)
                ? yield* tasks
                    .advanceOperation({
                      ...ref,
                      change: new SessionTask.OperationChange({
                        result: new SessionTask.OperationResultRef({
                          sessionID: saved.targetSessionID,
                          inputID: observed.inputID,
                          text: failureText,
                          digest: SessionTask.OperationDigest.make(
                            CompositionDigest.computeDigest({
                              text: failureText,
                              inputID: observed.inputID,
                              phase: observed.phase,
                            }),
                          ),
                        }),
                      }),
                    })
                    .pipe(Effect.orDie)
                : observed
            if (
              ["settled", "failed", "cancelled", "blocked", "superseded"].includes(operation.phase) &&
              operation.taskID
            ) {
              const waiting = (yield* tasks.operations({
                sessionID: operation.sourceSessionID,
                taskID: operation.taskID,
              })).find((entry) => entry.phase === "waiting")
              if (waiting)
                yield* jobs.start({
                  id: `task.operation.followup:${waiting.sourceSessionID}:${waiting.operationID}`,
                  type: "task-operation-followup",
                  metadata: { sessionID: waiting.sourceSessionID },
                  run: Effect.gen(function* () {
                    const next = yield* Session.serializedSelection(
                      waiting.sourceSessionID,
                      Effect.gen(function* () {
                        yield* assertOperation(waiting)
                        return yield* tasks.claimWaitingOperation({
                          sessionID: waiting.sourceSessionID,
                          operationID: waiting.operationID,
                        })
                      }),
                    )
                    if (next.phase === "reserved") yield* prepareTaskOperation(next)
                    return "Task followup admitted"
                  }).pipe(Effect.orDie),
                })
            }
            if (
              operation.result?.text === undefined ||
              (operation.source.type === "model_tool" && !operation.request.background)
            )
              return operation
            const notice = { sessionID: operation.sourceSessionID, inboxID: TaskOperation.notificationID(ref) }
            if (!(yield* store.get(notice.sessionID))) return operation
            const decision = yield* SessionNotification.inspect(db, bus, store, notice)
            if (decision.admit) {
              const text = `<task operation="${operation.operationID}" state="${operation.phase}">\n${operation.result.text}\n</task>`
              const communication = yield* CommunicationRecord.prepareSystem(db, {
                inputID: notice.inboxID,
                targetSessionID: notice.sessionID,
                text,
                actor: new SessionCommunication.SystemActor({
                  type: "system",
                  sessionID: saved.targetSessionID,
                  origin: new SessionCommunication.TaskOrigin({
                    type: "task_operation",
                    operation: new SessionTask.OperationReadonlyRef({
                      sourceSessionID: operation.sourceSessionID,
                      operationID: operation.operationID,
                    }),
                  }),
                }),
                contentSource: new SessionCommunication.ContentSource({
                  sessionID: saved.targetSessionID,
                  scope: "result",
                }),
                delivery: "steer",
                trigger: true,
                createdAt: operation.updatedAt,
              }).pipe(Effect.orDie)
              yield* result
                .synthetic(
                  {
                    id: notice.inboxID,
                    sessionID: notice.sessionID,
                    text,
                    description: operation.request.description,
                    metadata: {
                      source: "task",
                      inputID: operation.inputID,
                      parentTaskID: operation.taskID,
                      communication: Schema.encodeSync(SessionCommunication.Record)(communication.record),
                      coordination: new SessionTask.TaskCoordination({
                        kind: "task",
                        operationRef: new SessionTask.OperationReadonlyRef({
                          sourceSessionID: operation.sourceSessionID,
                          operationID: operation.operationID,
                        }),
                        actorSessionID: operation.sourceSessionID,
                        actorAgent: operation.source.agent,
                        targetSessionID: saved.targetSessionID,
                      }),
                    },
                    resume: false,
                  },
                  { communication: communication.record },
                )
                .pipe(
                  Effect.catchTag("Session.NotFoundError", () => Effect.void),
                  Effect.orDie,
                )
            }
            if (decision.wake) yield* execution.wake(operation.sourceSessionID)
            return operation
          }),
        ),
    )
    const observeTaskOperation: (operation: SessionTask.OperationInfo) => Effect.Effect<void> = Effect.fn(
      "Session.observeTaskOperation",
    )(function* (operation: SessionTask.OperationInfo) {
      if (!operation.targetSessionID) return
      yield* jobs.start({
        id: `task.operation.result:${operation.sourceSessionID}:${operation.operationID}`,
        type: "task-operation-result",
        metadata: { sessionID: operation.sourceSessionID, childSessionID: operation.targetSessionID },
        run: bus.log({ aggregateID: operation.targetSessionID, follow: true }).pipe(
          Stream.mapEffect(() =>
            reconcileTaskOperation({ sessionID: operation.sourceSessionID, operationID: operation.operationID }),
          ),
          Stream.filter(
            (current) =>
              current !== undefined &&
              ["settled", "failed", "cancelled", "blocked", "superseded", "recovery_required"].includes(current.phase),
          ),
          Stream.runHead,
          Effect.map((current) =>
            Option.isSome(current) ? (current.value?.result?.text ?? "Task operation settled") : "Session log closed",
          ),
        ),
      })
    })
    const assertOperation = Effect.fn("Session.assertTaskOperation")(function* (operation: SessionTask.OperationInfo) {
      const current = yield* tasks.operation({
        sessionID: operation.sourceSessionID,
        operationID: operation.operationID,
      })
      if (
        !current ||
        current.cancelIntent ||
        ["blocked", "failed", "cancelled", "superseded", "settled"].includes(current.phase)
      )
        return yield* new OperationConflictError({
          sessionID: operation.sourceSessionID,
          operationID: operation.operationID,
          reason: "phase_changed",
        })
      yield* metas.assertCoordination(operation.sourceSessionID, {
        agent: operation.source.agent,
        selection: operationSelection(operation),
        tool: "task",
      })
      if (operation.source.type === "schedule_occurrence") {
        const occurrence = yield* schedules.occurrence(Schedule.OccurrenceID.make(operation.source.occurrenceID))
        if (
          !occurrence ||
          occurrence.cancelRequested ||
          occurrence.sessionID !== operation.sourceSessionID ||
          occurrence.operationID !== operation.operationID ||
          occurrence.ruleRevision !== operation.source.revision ||
          ["cancelled", "blocked", "failed", "skipped"].includes(occurrence.status)
        )
          return yield* new OperationConflictError({
            sessionID: operation.sourceSessionID,
            operationID: operation.operationID,
            reason: "source_changed",
          })
      }
      return current
    })

    const cancelTaskOperation = Effect.fn("Session.cancelTaskOperation")(function* (
      input: TaskOperation.Ref,
      replacement?: SessionTask.OperationInfo,
    ) {
      yield* result.get(input.sessionID)
      const stopped = yield* Session.serializedSelection(
        input.sessionID,
        Effect.gen(function* () {
          const next = replacement ? yield* assertOperation(replacement).pipe(Effect.orDie) : undefined
          const current = replacement ? yield* reconcileTaskOperation(input) : yield* tasks.operation(input)
          if (!current) return yield* new OperationConflictError({ ...input, reason: "operation_missing" })
          const outcome = ["settled", "failed", "cancelled", "blocked", "superseded"].includes(current.phase)
            ? { operation: current, active: false }
            : yield* Effect.gen(function* () {
                const pending = current.targetSessionID
                  ? yield* admission
                      .reconcile({
                        id: current.inputID,
                        sessionID: current.targetSessionID,
                        type: "user",
                        delivery: current.prepared?.delivery ?? current.request.delivery,
                        operation: new SessionTask.OperationReadonlyRef({
                          sourceSessionID: current.sourceSessionID,
                          operationID: current.operationID,
                        }),
                      })
                      .pipe(Effect.catchTag("SessionInbox.LifecycleConflict", () => Effect.succeed(undefined)))
                  : undefined
                const removed =
                  pending && current.targetSessionID
                    ? yield* admission.cancel({ id: current.inputID, sessionID: current.targetSessionID }).pipe(
                        Effect.as(true),
                        Effect.catchTag("SessionInbox.LifecycleConflict", () => Effect.succeed(false)),
                      )
                    : false
                return {
                  operation: yield* tasks.advanceOperation({
                    ...input,
                    change: new SessionTask.OperationChange({
                      cancelIntent: true,
                      phase: replacement
                        ? "superseded"
                        : removed || !["admitted", "running"].includes(current.phase)
                          ? "cancelled"
                          : current.phase,
                    }),
                  }),
                  active: !removed && ["admitted", "running"].includes(current.phase),
                }
              })
          if (next?.taskID !== undefined && next.taskRevision === undefined) {
            const ref = { sessionID: next.sourceSessionID, operationID: next.operationID }
            // Keep the authorized replacement out of the followup observer until its claim is ready.
            yield* tasks.advanceOperation({
              ...ref,
              change: new SessionTask.OperationChange({ phase: "waiting" }),
              expect: ["permission_pending"],
            })
            const claimed = yield* tasks.claimWaitingOperation(ref)
            if (claimed.phase === "reserved")
              yield* tasks.advanceOperation({
                ...ref,
                change: new SessionTask.OperationChange({ phase: "permission_pending" }),
                expect: ["reserved"],
              })
          }
          return outcome
        }),
      )
      if (["cancelled", "superseded"].includes(stopped.operation.phase)) yield* jobs.cancel(operationJobID(input))
      if (stopped.active && stopped.operation.targetSessionID) {
        const targetID = stopped.operation.targetSessionID
        yield* SessionInbox.serialized(
          targetID,
          Effect.gen(function* () {
            const membership = yield* SessionInputResult.current(db, targetID)
            if (membership?.inputs.length === 1 && membership.inputs[0].inputID === stopped.operation.inputID) {
              yield* execution.interrupt(targetID)
              return
            }
            if (membership?.inputs.some((entry) => entry.inputID === stopped.operation.inputID))
              yield* tasks
                .advanceOperation({
                  ...input,
                  change: new SessionTask.OperationChange({
                    error: new SessionTask.OperationError({
                      code: "shared_input_ownership",
                      message:
                        "The target is executing shared inputs; stop the target Session explicitly to interrupt all work",
                    }),
                  }),
                })
                .pipe(Effect.orDie)
          }),
        )
      }
      if (replacement && stopped.operation.phase === "superseded") {
        yield* reconcileTaskOperation(input)
        yield* jobs.cancel(`task.operation.result:${input.sessionID}:${input.operationID}`)
      }
      return (yield* tasks.operation(input)) ?? stopped.operation
    })

    const prepareTaskOperation: (reservation: SessionTask.OperationInfo) => Effect.Effect<void, unknown> = Effect.fn(
      "Session.prepareTaskOperation",
    )((reservation: SessionTask.OperationInfo) =>
      Effect.gen(function* () {
        const ref = { sessionID: reservation.sourceSessionID, operationID: reservation.operationID }
        const current = yield* tasks.operation(ref)
        if (!current || current.cancelIntent) return
        yield* tasks.advanceOperation({
          ...ref,
          change: new SessionTask.OperationChange({ phase: "permission_pending" }),
          expect: reservation.request.replacesOperationID === undefined ? ["reserved"] : ["reserved", "waiting"],
        })
        const permission = yield* Permission.Service.pipe(Effect.provide(locations.get(reservation.sourceLocation)))
        yield* permission.assert({
          id: TaskOperation.permissionID(ref),
          sessionID: reservation.sourceSessionID,
          agent: reservation.source.agent,
          action: "task",
          resources: [
            reservation.request.target.type === "existing_root"
              ? reservation.request.target.sessionID
              : (reservation.request.target.agent ?? reservation.request.target.mode),
          ],
          source: TaskOperation.permissionSource(reservation),
          metadata: {
            operationID: reservation.operationID,
            replacesOperationID: reservation.request.replacesOperationID,
            target: Schema.encodeSync(SessionTask.OperationRequest)(reservation.request).target,
          },
        })
        if (reservation.request.replacesOperationID !== undefined) {
          yield* cancelTaskOperation(
            { sessionID: reservation.sourceSessionID, operationID: reservation.request.replacesOperationID },
            reservation,
          )
          if ((yield* tasks.operation(ref))?.phase === "waiting") return
        }
        const operation = yield* Session.serializedSelection(
          reservation.sourceSessionID,
          Effect.gen(function* () {
            yield* assertOperation(reservation)
            const bound = yield* tasks.attachOperationTask(ref)
            const targetID = bound.targetSessionID
            if (!targetID) return yield* new OperationConflictError({ ...ref, reason: "phase_changed" })
            if (bound.request.target.type === "existing_root") {
              const target = yield* result.get(targetID)
              if (target.parentID !== undefined || target.controller?.kind === "child")
                return yield* new ControllerConflictError({
                  sessionID: target.id,
                  field: "target",
                  kind: "coordination_root_required",
                  message: "Task target must be an independent root Session",
                })
              return bound
            }
            const target = bound.request.target
            if (target.mode === "custom") {
              if (!target.composition)
                return yield* new CompositionConflictError({
                  sessionID: targetID,
                  reason: "custom_root_requires_composition",
                })
              const adopted = yield* result.createCustom({
                id: targetID,
                location: target.location ?? bound.sourceLocation,
                composition: target.composition,
                expectedPlanDigest: target.expectedPlanDigest,
                title: target.title ?? bound.request.description,
                model: target.model,
                executorPreference: target.executorPreference,
              })
              if (target.agent !== undefined && adopted.session.agent !== target.agent)
                return yield* new CompositionConflictError({
                  sessionID: targetID,
                  reason: "custom_root_agent_mismatch",
                })
            }
            if (target.mode !== "custom") {
              if (target.composition)
                return yield* new CompositionConflictError({
                  sessionID: targetID,
                  reason: "composition_requires_custom_mode",
                })
              yield* result.create({
                id: targetID,
                location: target.location ?? bound.sourceLocation,
                mode: target.mode,
                agent: target.agent,
                model: target.model,
                executorPreference: target.executorPreference,
                title: target.title ?? bound.request.description,
              })
            }
            return yield* tasks.advanceOperation({
              ...ref,
              change: new SessionTask.OperationChange({ phase: "created" }),
              expect: ["permission_pending"],
            })
          }),
        )
        const targetID = operation.targetSessionID
        if (!targetID) return yield* new OperationConflictError({ ...ref, reason: "phase_changed" })
        const target = yield* result.get(targetID)
        const reference = operation.request.reference
          ? yield* SessionConsultationReference.freeze(db, operation.request.reference)
          : undefined
        const item = yield* SessionPrompt.prepare({
          session: target,
          messageID: operation.inputID,
          input: {
            text: operation.request.prompt,
            files: operation.request.files,
            delivery: operation.request.delivery,
            metadata: {
              task: {
                parentSessionID: operation.sourceSessionID,
                parentTaskID: operation.taskID,
                parentTaskRevision: operation.taskRevision,
                operationID: operation.operationID,
              },
              actorSessionID: operation.sourceSessionID,
            },
          },
        }).pipe(
          Effect.provideService(Instance.Service, instances),
          Effect.provideService(FSUtil.Service, fs),
          Effect.provideService(SessionComposition.Service, compositions),
        )
        const payload = yield* Consultation.attach(
          db,
          targetID,
          SessionInbox.UserPayload.make({
            text: item.payload.text,
            agents: item.payload.agents,
            skills: item.payload.skills,
            files: reference ? [...(item.payload.files ?? []), reference.file] : item.payload.files,
            metadata: item.payload.metadata,
          }),
        )
        const prepared = new SessionTask.OperationPrepared({
          payload,
          delivery: item.delivery,
          digest: TaskOperation.payloadDigest(payload, item.delivery),
          reference,
        })
        yield* tasks.advanceOperation({
          ...ref,
          change: new SessionTask.OperationChange({ phase: "prepared", prepared }),
          expect: ["permission_pending", "created"],
        })
        yield* Session.serializedSelection(
          operation.sourceSessionID,
          Effect.gen(function* () {
            yield* assertOperation(operation)
            if (target.revert) yield* sessions.forSession(target.id).revert.commit()
            yield* admission.admit({
              id: operation.inputID,
              sessionID: targetID,
              item: { type: "user", payload: prepared.payload, delivery: prepared.delivery },
              operation: new SessionTask.OperationReadonlyRef({
                sourceSessionID: operation.sourceSessionID,
                operationID: operation.operationID,
              }),
              beforeCommit: assertOperation(operation).pipe(Effect.asVoid, Effect.orDie),
            })
            yield* tasks.advanceOperation({
              ...ref,
              change: new SessionTask.OperationChange({ phase: "admitted" }),
              expect: ["admitted", "prepared"],
            })
          }),
        )
        if (operation.request.resume) yield* execution.wake(targetID)
        yield* observeTaskOperation((yield* tasks.operation(ref)) ?? operation)
      }).pipe(
        Effect.onError((cause) =>
          Effect.gen(function* () {
            const failure = Cause.squash(cause)
            const current = yield* tasks.operation({
              sessionID: reservation.sourceSessionID,
              operationID: reservation.operationID,
            })
            if (!current || ["settled", "blocked", "failed", "cancelled", "superseded"].includes(current.phase)) return
            const cancelled = Cause.hasInterrupts(cause) || failure instanceof Permission.DeclinedError
            const blocked = failure instanceof Permission.BlockedError || failure instanceof ControllerConflictError
            yield* tasks
              .advanceOperation({
                sessionID: reservation.sourceSessionID,
                operationID: reservation.operationID,
                change: new SessionTask.OperationChange({
                  phase: cancelled ? "cancelled" : blocked ? "blocked" : "failed",
                  cancelIntent: cancelled || current.cancelIntent,
                  error: new SessionTask.OperationError({
                    code:
                      failure instanceof ControllerConflictError
                        ? failure.kind
                        : failure instanceof Error
                          ? failure.name
                          : "preparation_failed",
                    message: failure instanceof Error ? failure.message : String(failure),
                  }),
                }),
              })
              .pipe(Effect.orDie)
          }),
        ),
      ),
    )

    const resolveMetaModel = Effect.fn("Session.resolveMetaModel")(function* (
      sessionID: SessionSchema.ID,
      location: Location.Ref,
      requested?: Model.Selection,
      preference?: SessionSchema.ExecutorPreference,
      frozenExecutors?: readonly Agent.Info[],
      mode: ProductMode.ID = ProductMode.Default,
    ) {
      return yield* Effect.gen(function* () {
        yield* Plugin.awaitActivation
        const catalog = yield* Model.Service
        const resolver = yield* ModelResolver.Service
        const agents = yield* Agent.Service
        if (preference) {
          const target = frozenExecutors
            ? frozenExecutors.find((agent) => agent.id === preference.agent)
            : yield* agents.get(preference.agent)
          if (!target || target.id === "meta" || target.mode === "primary")
            return yield* new ControllerConflictError({
              sessionID,
              field: "executorPreference.agent",
              kind: "executor_unavailable",
              message: `Executor unavailable: ${preference.agent}`,
            })
          if (frozenExecutors === undefined)
            yield* Agent.assertOrdinaryMode(target, mode).pipe(
              Effect.mapError(
                (error) =>
                  new ControllerConflictError({
                    sessionID,
                    field: "executorPreference.agent",
                    kind: "executor_unavailable",
                    message: error.message,
                  }),
              ),
            )
          if (preference.model) {
            const selected = preference.model
            yield* Effect.gen(function* () {
              if (Model.Selection.isGroup(selected)) {
                yield* ModelGroup.behavior(selected.groupID).pipe(Effect.mapError((error) => new ControllerConflictError({
                  sessionID, field: "executorPreference.model", kind: "executor_model_unavailable", message: error.message,
                })))
                return
              }
              const candidate = (yield* catalog.available()).find((item) => item.id === selected.id && item.providerID === selected.providerID)
              if (!candidate)
                return yield* new ControllerConflictError({ sessionID, field: "executorPreference.model", kind: "executor_model_unavailable", message: "Executor model is unavailable" })
              yield* resolver.resolveModel(candidate, selected.variant).pipe(Effect.mapError((error) => new ControllerConflictError({
                sessionID, field: "executorPreference.model", kind: "executor_model_invalid", message: error.message,
              })))
            })
          }
        }
        const selection = requested ?? (yield* catalog.selection())
        if (selection && Model.Selection.isGroup(selection)) {
          yield* ModelGroup.behavior(selection.groupID).pipe(Effect.mapError((error) => new ControllerConflictError({
            sessionID, field: "model", kind: "meta_model_unavailable", message: error.message,
          })))
          return selection
        }
        const candidate = selection
          ? (yield* catalog.available()).find(
              (item) => item.id === selection.id && item.providerID === selection.providerID,
            )
          : undefined
        if (selection && !candidate)
          return yield* new ControllerConflictError({
            sessionID,
            field: "model",
            kind: "meta_model_unavailable",
            message: "Meta model is unavailable",
          })
        const resolved = yield* (
          candidate ? resolver.resolveModel(candidate, selection?.variant) : resolver.resolve()
        ).pipe(
          Effect.mapError(
            (error) =>
              new ControllerConflictError({
                sessionID,
                field: "model",
                kind: "meta_model_invalid",
                message: error.message,
              }),
          ),
        )
        if (!resolved)
          return yield* new ControllerConflictError({
            sessionID,
            field: "model",
            kind: "meta_model_missing",
            message: "No Meta model is available",
          })
        return resolved.ref
      }).pipe(Effect.provide(locations.get(location)))
    })

    const captureGroupBehavior = Effect.fn("Session.captureGroupBehavior")(function* (
      sessionID: SessionSchema.ID,
      location: Location.Ref,
      model?: Model.Selection,
    ) {
      if (model === undefined || !Model.Selection.isGroup(model)) return undefined
      return yield* ModelGroup.behavior(model.groupID).pipe(
        Effect.mapError((error) => new ControllerConflictError({ sessionID, field: "model", kind: "group_model_unavailable", message: error.message })),
        Effect.provide(locations.get(location)),
      )
    })

    const commitMetaAssociation = Effect.fn("Session.commitMetaAssociation")(function* (
      controller: SessionSchema.Controller,
      sessionID: SessionSchema.ID,
      model: Model.Selection,
      title?: string,
      reuse = false,
      groupBehavior?: ModelGroup.BehaviorSnapshot,
    ) {
      if (controller.kind === "root" && !reuse)
        yield* metas.create({ id: controller.metaAgentID, title: title ?? "Meta", agent: "meta", model, groupBehavior })
      yield* metas.attach({
        metaID: controller.metaAgentID,
        sessionID,
        role: controller.kind === "root" ? "orchestrator" : "worker",
      })
    })

    const adoptFrozen = Effect.fn("Session.adoptFrozen")(function* (
      session: SessionSchema.Info,
      input: {
        parentID?: SessionSchema.ID
        agent: Agent.ID
        snapshot: Composition.Snapshot
        mode?: ProductMode.ID
        parent?: SessionSchema.Info
        source?: SessionSchema.ControllerSource
        executor?: SessionSchema.ExecutorBinding
        model?: Model.Selection
      },
    ) {
      if (
        session.mode !== (input.mode ?? "custom") ||
        session.parentID !== input.parentID ||
        session.agent !== input.agent
      )
        return yield* new CompositionConflictError({ sessionID: session.id, reason: "custom_identity_mismatch" })
      const snapshot = yield* compositions.get(session.id)
      const selected = session.model ?? (snapshot.version === 2
        ? session.agent === (snapshot.data.root?.id ?? "meta") ? snapshot.data.orchestrator?.model : snapshot.data.executors?.find((executor) => executor.id === session.agent)?.info.model
        : undefined)
      if (input.model !== undefined && ((selected !== undefined && Model.Selection.isGroup(selected)) || Model.Selection.isGroup(input.model)) && !sameModel(selected, input.model))
        return yield* new CompositionConflictError({ sessionID: session.id, reason: "group_selection_mismatch" })
      // The existing Session retains captured Group behavior when its source
      // retries after a Group edit or changes its own runtime selection.
      const expected = snapshot.version === 2 && input.snapshot.version === 2
        ? [input.agent, ...(input.parent ? [input.parent.agent ?? input.snapshot.data.root?.id ?? "meta"] : [])].reduce(
            (expected, agent) => SessionComposition.bindGroupBehavior(expected, agent, SessionComposition.groupBehaviorFor(snapshot, agent)),
            input.snapshot,
          )
        : input.snapshot
      if (
        CompositionDigest.computeDigest({ ...snapshot, sessionID: undefined }) !==
        CompositionDigest.computeDigest({ ...expected, sessionID: undefined })
      )
        return yield* new CompositionConflictError({ sessionID: session.id, reason: "inherited_snapshot_mismatch" })
      if (input.source) {
        // An ordinary source owns its child without creating an executor binding.
        const uncontrolled =
          input.parent && !session.controller && !input.executor
            ? (yield* metas.assertChildSource(
                input.parent,
                session.id,
                input.executor,
                input.source,
                session.metadata,
                true,
              )) === undefined
            : false
        if (
          !uncontrolled &&
          (session.controller?.kind !== "child" ||
            !input.executor ||
            !bindingMatches(session) ||
            !sameExecutor(session.controller.executor, input.executor) ||
            (input.model !== undefined && !sameModel(input.model, session.controller.executor.model)) ||
            CompositionDigest.computeDigest(session.controller.source) !==
              CompositionDigest.computeDigest(input.source))
        )
          return yield* new ControllerConflictError({
            sessionID: session.id,
            field: "executor",
            kind: "meta_binding_conflict",
            message: "Child execution fields must match the first binding",
          })
        if (input.parent && !uncontrolled)
          yield* metas.assertChildSource(input.parent, session.id, input.executor, input.source, session.metadata, true)
      }
      yield* metas.assertOwner(session)
      return session
    })

    const retryCustom = Effect.fn("Session.retryCustom")(function* (
      session: SessionSchema.Info,
      input: CreateCustomInput,
    ) {
      if (session.mode !== "custom" || session.parentID !== undefined)
        return yield* new CompositionConflictError({ sessionID: session.id, reason: "custom_identity_mismatch" })
      // Retry identity belongs to the frozen input, so deleted profiles do not
      // force another resolution and current tool capture does not replace it.
      const snapshot = yield* compositions.get(session.id)
      if (
        snapshot.data.sourceLocation !== undefined &&
        (path.resolve(snapshot.data.sourceLocation.directory) !== path.resolve(input.location.directory) ||
          snapshot.data.sourceLocation.workspaceID !== input.location.workspaceID)
      )
        return yield* new CompositionConflictError({ sessionID: session.id, reason: "composition_source_mismatch" })
      const rootID = snapshot.version === 2 ? (snapshot.data.root?.id ?? "meta") : "meta"
      if (session.agent !== rootID)
        return yield* new CompositionConflictError({ sessionID: session.id, reason: "custom_identity_mismatch" })
      if (snapshot.digest !== CompositionDigest.computeCompositionDigest(input.composition))
        return yield* new CompositionConflictError({ sessionID: session.id, reason: "composition_input_mismatch" })
      if (input.expectedPlanDigest !== undefined && input.expectedPlanDigest !== snapshot.digest)
        return yield* new Composition.ResolveError({
          code: "plan_digest_mismatch",
          message: `Composition plan digest mismatch: expected ${input.expectedPlanDigest}, got ${snapshot.digest}`,
        })
      return new Composition.StartResponse({ session, snapshot })
    })

    const assertUpgradeSource = Effect.fn("Session.assertUpgradeSource")(function* (source: SessionSchema.Info) {
      const current = yield* store.get(source.id)
      if (!current) return yield* new NotFoundError({ sessionID: source.id })
      if (current.mode === "custom")
        return yield* new UpgradeSourceModeError({ sessionID: current.id, mode: current.mode })
      if (yield* execution.isActive(current.id)) return yield* new BusyError({ sessionID: current.id })
      if (
        current.location.directory !== source.location.directory ||
        current.location.workspaceID !== source.location.workspaceID
      )
        return yield* new UpgradeSourceMovedError({
          sessionID: current.id,
          expected: source.location,
          actual: current.location,
        })
    })

    const startCustom = Effect.fn("Session.startCustom")(function* (
      input: CreateCustomInput,
      beforeCommit?: () => Effect.Effect<void>,
    ) {
      yield* ProductModePolicy.assertRuntimeSupported("custom")
      const sessionID = input.id ?? SessionSchema.ID.create()
      const recorded = yield* store.get(sessionID)
      if (recorded) return yield* retryCustom(recorded, input)
      const frozen = yield* Effect.gen(function* () {
        yield* Plugin.awaitActivation
        const resolver = yield* CompositionResolver.Service
        return yield* resolver.freeze(new Composition.FreezeInput({ input: input.composition, sessionID }))
      }).pipe(Effect.provide(locations.get(input.location)))
      if (input.expectedPlanDigest !== undefined && input.expectedPlanDigest !== frozen.digest)
        return yield* new Composition.ResolveError({
          code: "plan_digest_mismatch",
          message: `Composition plan digest mismatch: expected ${input.expectedPlanDigest}, got ${frozen.digest}`,
        })
      const project = yield* projects.resolve(input.location.directory)
      const root = frozen.data.orchestrator
      if (root === undefined)
        return yield* new Composition.ResolveError({
          code: "orchestrator_unavailable",
          message: "Custom adoption requires a frozen root configuration",
        })
      const meta =
        root.id === "meta"
          ? {
              model: yield* resolveMetaModel(
                sessionID,
                input.location,
                input.model ?? (frozen.data.root === undefined ? undefined : root.model),
                input.executorPreference,
                frozen.data.executors?.map((executor) => executor.info) ?? [],
              ),
              controller: new SessionSchema.RootController({
                kind: "root",
                metaAgentID: MetaAgent.ID.descending(),
                rootSessionID: sessionID,
              }),
            }
          : undefined
      const selected = meta?.model ?? input.model ?? root.model
      const groupBehavior = selected && Model.Selection.isGroup(selected)
        ? input.model === undefined && frozen.data.groupBehavior?.groupID === selected.groupID
          ? frozen.data.groupBehavior
          : yield* captureGroupBehavior(sessionID, input.location, selected)
        : undefined
      const snapshot = SessionComposition.bindGroupBehavior(frozen, root.id, groupBehavior)
      yield* bus
        .publish(
          SessionEvent.Created,
          {
            sessionID,
            slug: Slug.create(),
            version: app.version,
            projectID: project.id,
            mode: "custom",
            location: input.location,
            subpath: RelativePath.make(
              path.relative(project.directory, input.location.directory).replaceAll("\\", "/"),
            ),
            title: input.title,
            agent: root.id,
            model: meta?.model ?? input.model,
            groupBehavior,
            controller: meta?.controller,
            executorPreference: meta ? input.executorPreference : undefined,
          },
          {
            location: input.location,
            commit: () =>
              Effect.gen(function* () {
                if (beforeCommit) yield* beforeCommit()
                yield* SessionComposition.insertSnapshot(db, sessionID, snapshot)
                if (meta) yield* commitMetaAssociation(meta.controller, sessionID, meta.model, input.title, false, snapshot.data.groupBehavior)
              }),
          },
        )
        .pipe(
          Effect.catchDefect((defect) => {
            if (!(defect instanceof SessionProjector.SessionAlreadyProjected)) return Effect.die(defect)
            return store
              .get(sessionID)
              .pipe(
                Effect.flatMap((session) =>
                  session ? retryCustom(session, input).pipe(Effect.asVoid) : Effect.die(defect),
                ),
              )
          }),
        )
      const session = yield* store.get(sessionID)
      if (!session) return yield* Effect.die(new Error(`Custom session was not projected: ${sessionID}`))
      return new Composition.StartResponse({ session, snapshot: yield* compositions.get(sessionID) })
    })

    const result: Interface = Service.of({
      reconcileTaskOperation,
      recoverTaskOperations: Effect.gen(function* () {
        for (const source of (yield* result.list()).data) {
          for (const saved of yield* tasks.operations({ sessionID: source.id })) {
            const operation =
              (yield* reconcileTaskOperation({ sessionID: source.id, operationID: saved.operationID })) ?? saved
            if (["admitted", "running"].includes(operation.phase)) {
              yield* observeTaskOperation(operation)
              continue
            }
            if (
              !["reserved", "permission_pending", "created", "prepared"].includes(operation.phase) ||
              operation.cancelIntent
            )
              continue
            if (operation.phase === "reserved") {
              yield* jobs.start({
                id: operationJobID({ sessionID: source.id, operationID: operation.operationID }),
                type: "task-operation",
                metadata: { sessionID: source.id },
                run: prepareTaskOperation(operation).pipe(Effect.as("")),
              })
              continue
            }
            if (!operation.prepared) {
              yield* tasks
                .advanceOperation({
                  sessionID: source.id,
                  operationID: operation.operationID,
                  change: new SessionTask.OperationChange({
                    phase: "recovery_required",
                    error: new SessionTask.OperationError({
                      code: "preparation_unknown",
                      message: "Preparation stopped before its frozen payload was saved",
                    }),
                  }),
                })
                .pipe(Effect.orDie)
              continue
            }
            const prepared = operation.prepared
            const targetID = operation.targetSessionID
            if (!targetID) continue
            yield* Session.serializedSelection(
              source.id,
              Effect.gen(function* () {
                yield* assertOperation(operation)
                yield* admission.admit({
                  id: operation.inputID,
                  sessionID: targetID,
                  item: { type: "user", payload: prepared.payload, delivery: prepared.delivery },
                  operation: new SessionTask.OperationReadonlyRef({
                    sourceSessionID: source.id,
                    operationID: operation.operationID,
                  }),
                  beforeCommit: assertOperation(operation).pipe(Effect.asVoid, Effect.orDie),
                })
              }),
            ).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("Task operation recovery requires reconciliation", {
                  operationID: operation.operationID,
                  cause,
                }),
              ),
            )
            const admitted = yield* tasks.operation({ sessionID: source.id, operationID: operation.operationID })
            if (admitted?.phase === "admitted") {
              yield* observeTaskOperation(admitted)
              if (admitted.request.resume && admitted.targetSessionID) yield* execution.wake(admitted.targetSessionID)
            }
          }
        }
      }),
      waitTaskOperation: Effect.fn("Session.waitTaskOperation")(function* (input) {
        const operation = yield* reconcileTaskOperation(input)
        if (!operation) return yield* new OperationConflictError({ ...input, reason: "operation_missing" })
        if (["settled", "failed", "cancelled", "blocked", "superseded", "recovery_required"].includes(operation.phase))
          return operation
        if (operation.phase === "waiting") {
          yield* bus.log({ aggregateID: operation.sourceSessionID, follow: true }).pipe(
            Stream.mapEffect(() => tasks.operation(input)),
            Stream.filter((current) => current !== undefined && current.phase !== "waiting"),
            Stream.runHead,
          )
          return yield* result.waitTaskOperation(input)
        }
        yield* observeTaskOperation(operation)
        yield* jobs.wait({ id: `task.operation.result:${operation.sourceSessionID}:${operation.operationID}` })
        return (yield* tasks.operation(input)) ?? operation
      }),
      dispatchTask: Effect.fn("Session.dispatchTask")(function* (input, options) {
        const source = yield* result.get(input.sessionID)
        const origin =
          options?.source ??
          new SessionTask.OperationUserSource({
            type: "user_coordination",
            sessionID: source.id,
            agent: source.agent ?? Agent.ID.make("meta"),
          })
        const previous = yield* tasks.operation({ sessionID: input.sessionID, operationID: input.request.operationID })
        if (previous)
          return (yield* tasks.reserveOperation({
            sessionID: input.sessionID,
            request: input.request,
            source: origin,
            selection: previous.selection,
            sourceLocation: previous.sourceLocation,
            sourceMode: previous.sourceMode,
          })).operation
        const reservation = yield* Session.serializedSelection(
          source.id,
          Effect.gen(function* () {
            const capability = yield* metas.assertCoordination(source.id, { agent: origin.agent, tool: "task" })
            if (options?.targetSessionID && origin.type !== "schedule_occurrence")
              return yield* new OperationConflictError({
                sessionID: source.id,
                operationID: input.request.operationID,
                reason: "source_changed",
              })
            if (input.request.replacesOperationID !== undefined) {
              if (input.request.replacesOperationID === input.request.operationID)
                return yield* new OperationConflictError({
                  sessionID: source.id,
                  operationID: input.request.operationID,
                  reason: "request_changed",
                })
              if (!(yield* tasks.operation({ sessionID: source.id, operationID: input.request.replacesOperationID })))
                return yield* new OperationConflictError({
                  sessionID: source.id,
                  operationID: input.request.operationID,
                  reason: "operation_missing",
                })
            }
            const goalRounds =
              origin.type === "model_tool"
                ? yield* goals.roundsForMessage({ sessionID: source.id, assistantMessageID: origin.messageID })
                : undefined
            if (goalRounds?.length) yield* goals.beforeTask({ rounds: goalRounds }).pipe(Effect.orDie)
            return yield* tasks.reserveOperation({
              sessionID: source.id,
              request: input.request,
              source: origin,
              sourceLocation: source.location,
              sourceMode: source.mode,
              goalRounds,
              targetSessionID: options?.targetSessionID,
              selection: new SessionTask.OperationSelection({
                agent: origin.agent,
                eventID: capability.selection.event?.id,
                seq: capability.selection.event?.seq ?? Event.Seq.make(0),
                compositionDigest: capability.selection.compositionDigest,
              }),
            })
          }),
        )
        if (
          !reservation.created ||
          (reservation.operation.phase === "waiting" && reservation.operation.request.replacesOperationID === undefined)
        )
          return reservation.operation
        const ref = { sessionID: source.id, operationID: reservation.operation.operationID }
        yield* jobs.start({
          id: operationJobID(ref),
          type: "task-operation",
          title: input.request.description,
          metadata: { sessionID: source.id, operationID: ref.operationID },
          run: prepareTaskOperation(reservation.operation).pipe(Effect.as("")),
        })
        yield* jobs.wait({ id: operationJobID(ref) })
        const saved = yield* tasks.operation(ref)
        if (!saved) return yield* new OperationConflictError({ ...ref, reason: "operation_missing" })
        return saved
      }),
      cancelTaskOperation,
      getConsultation: Effect.fn("Session.getConsultation")(function* (sessionID) {
        yield* result.get(sessionID)

        // The row and its current inbox/message carrier belong to one bounded read snapshot.
        return yield* db
          .transaction(() =>
            Effect.gen(function* () {
              const record = yield* Consultation.get(db, sessionID)

              if (!record) return yield* new NotFoundError({ sessionID })

              return SessionConsultation.Read.make({
                reference: yield* Consultation.reference(db, record),
                admission:
                  record.phase === "reserved"
                    ? { state: "reserved", id: record.first_message_id }
                    : yield* Consultation.admission(db, record),
              })
            }),
          )
          .pipe(Effect.catchTag("SqlError", Effect.die))
      }),
      createConsultation: Effect.fn("Session.createConsultation")((input) =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const operation = { sourceSessionID: input.sourceSessionID, firstMessageID: input.prompt.id }
            const prior = yield* Consultation.get(db, input.id)
            if (prior && !Consultation.matchesIdentity(prior, operation))
              return yield* new ConsultationConflictError({
                sessionID: input.id,
                field: "id",
                message: "The target belongs to a different consultation source or first prompt",
              })
            if (!prior) {
              if (yield* store.get(input.id))
                return yield* new ConsultationConflictError({
                  sessionID: input.id,
                  field: "id",
                  message: "The existing target is not owned by this consultation",
                })
              const source = yield* restore(result.get(input.sourceSessionID))
              const selected = yield* restore(
                Effect.gen(function* () {
                  yield* Plugin.awaitActivation
                  const agents = yield* Agent.Service
                  return (yield* agents.select(input.agent)).info
                }).pipe(Effect.provide(locations.get(source.location))),
              )
              if (!selected || selected.id === "meta" || selected.mode === "subagent" || selected.hidden)
                return yield* new InvalidConsultationError({
                  sessionID: input.id,
                  field: "agent",
                  message: "A consultation requires an available ordinary root agent",
                })
              const reference = yield* restore(
                SessionConsultationReference.freeze(db, {
                  sourceSessionID: input.sourceSessionID,
                  boundary: input.boundary,
                }),
              )
              yield* restore(
                result.create({
                  id: input.id,
                  mode: ProductMode.ID.make("chat"),
                  agent: selected.id,
                  model: input.model,
                  title: input.title,
                  location: source.location,
                  consultation: { firstMessageID: input.prompt.id, reference },
                }),
              ).pipe(
                Effect.catchDefect((defect) =>
                  defect instanceof ConsultationConflictError ? Effect.fail(defect) : Effect.die(defect),
                ),
              )
            }
            const record = yield* Consultation.get(db, input.id)
            if (!record || !Consultation.matchesIdentity(record, operation))
              return yield* new ConsultationConflictError({
                sessionID: input.id,
                field: "id",
                message: "The target consultation identity was not committed",
              })
            const target = yield* result.get(input.id)
            if (record.phase === "reserved") {
              yield* SessionInbox.serialized(
                input.id,
                admission.reconcile({
                  id: input.prompt.id,
                  sessionID: input.id,
                  type: "user",
                  delivery: input.prompt.delivery ?? "steer",
                  consultation: operation,
                }),
              )
              const item = yield* restore(
                SessionPrompt.prepare({ session: target, messageID: input.prompt.id, input: input.prompt }).pipe(
                  Effect.provideService(Instance.Service, instances),
                  Effect.provideService(FSUtil.Service, fs),
                  Effect.provideService(SessionComposition.Service, compositions),
                ),
              )
              if (target.revert) yield* sessions.forSession(target.id).revert.commit()
              yield* admission.admit({ id: input.prompt.id, sessionID: input.id, item, consultation: operation })
            }
            return yield* SessionInbox.serialized(
              input.id,
              Effect.gen(function* () {
                const current = yield* Consultation.get(db, input.id)
                if (!current)
                  return yield* new ConsultationConflictError({
                    sessionID: input.id,
                    field: "id",
                    message: "The target consultation no longer exists",
                  })
                const admitted = yield* Consultation.admission(db, current)
                const reference = yield* Consultation.reference(db, current)
                if (admitted.state === "pending" && input.resume !== false) yield* execution.wake(input.id)
                return SessionConsultation.Data.make({
                  session: yield* result.get(input.id),
                  reference,
                  admission: admitted,
                })
              }),
            )
          }).pipe(
            Effect.catchTag(
              "SessionInbox.LifecycleConflict",
              () =>
                new ConsultationConflictError({
                  sessionID: input.id,
                  field: "prompt.id",
                  message: "The first prompt ID is occupied by another input",
                }),
            ),
          ),
        ),
      ),
      create: Effect.fn("Session.create")(function* (input) {
        const sessionID = input.id ?? SessionSchema.ID.create()
        const recorded = yield* store.get(sessionID)
        if (recorded && recorded.mode !== "custom" && input.frozenSnapshot === undefined) return recorded
        const parent = input.parentID ? yield* store.get(input.parentID) : undefined
        if (input.parentID && parent === undefined) return yield* new NotFoundError({ sessionID: input.parentID })
        if (input.frozenSnapshot && (!parent || input.source?.kind !== "workflow"))
          return yield* new CompositionConflictError({ sessionID, reason: "workflow_source_required" })
        if (input.frozenSnapshot && parent && input.source?.kind === "workflow") {
          const admission = yield* workflowRuns
            .admission(parent.id, input.source.runID)
            .pipe(
              Effect.mapError(
                () => new CompositionConflictError({ sessionID, reason: "workflow_snapshot_unavailable" }),
              ),
            )
          if (
            !admission.snapshot ||
            CompositionDigest.computeDigest(admission.snapshot) !==
              CompositionDigest.computeDigest(input.frozenSnapshot)
          )
            return yield* new CompositionConflictError({ sessionID, reason: "inherited_snapshot_mismatch" })
        }
        if (parent?.controller?.kind === "child")
          return yield* new ControllerConflictError({
            sessionID,
            field: "parentID",
            kind: "meta_child_recursion",
            message: "Meta children cannot create descendants",
          })
        if (parent && (input.executor || (parent.controller && parent.agent === "meta")) && !input.source)
          return yield* new ControllerConflictError({
            sessionID,
            field: "parentID",
            kind: "meta_child_source_required",
            message: "Meta children require a first binding and owning source",
          })
        const childController =
          parent && input.source && (parent.controller || input.executor)
            ? yield* metas.assertChildSource(
                parent,
                sessionID,
                input.executor,
                input.source,
                input.metadata ?? parent.metadata,
              )
            : undefined
        const mode = parent?.mode ?? input.mode ?? ProductMode.Default
        yield* ProductModePolicy.assertRuntimeSupported(mode)
        if (mode === "custom" && !parent)
          return yield* new CompositionConflictError({ sessionID, reason: "custom_root_requires_composition" })
        if (parent?.mode === "custom" && input.mode !== undefined && input.mode !== "custom")
          return yield* new CompositionConflictError({ sessionID, reason: "custom_parent_mode_mismatch" })
        if (parent?.mode !== "custom" && (input.mode === "custom" || recorded?.mode === "custom"))
          return yield* new CompositionConflictError({ sessionID, reason: "custom_parent_required" })
        const selection =
          parent && (parent.mode === "custom" || input.frozenSnapshot !== undefined)
            ? yield* Effect.gen(function* () {
                if (input.agent === undefined || input.agent === "meta")
                  return yield* new CompositionConflictError({ sessionID, reason: "custom_executor_required" })
                const selection = yield* compositions.selectAgent(parent.id, input.agent, input.frozenSnapshot)
                if (selection.info.id === (selection.snapshot.data.root?.id ?? "meta"))
                  return yield* new CompositionConflictError({ sessionID, reason: "custom_executor_required" })
                return selection
              })
            : undefined
        if (recorded && selection)
          return yield* adoptFrozen(recorded, {
            parentID: parent?.id,
            agent: selection.info.id,
            snapshot: selection.snapshot,
            mode,
            parent,
            source: input.source,
            executor: input.executor,
            model: input.model,
          })
        const location = parent?.location ?? input.location
        if (location === undefined)
          return yield* Effect.die(new Error("Session.create requires either location or an existing parentID"))
        const agent = parent
          ? (selection?.info.id ?? input.agent)
          : yield* Effect.gen(function* () {
              if (input.agent === undefined) yield* Plugin.awaitActivation
              const agents = yield* Agent.Service
              const selected = yield* agents.select(input.agent, mode)
              if (selected.info) yield* Agent.assertOrdinaryMode(selected.info, mode)
              return selected.id
            }).pipe(Effect.provide(locations.get(location)))
        const ordinaryAgent = parent && selection === undefined && agent !== undefined
          ? yield* Effect.gen(function* () {
            const agents = yield* Agent.Service
            const selected = yield* agents.get(Agent.ID.make(agent))
            if (selected) yield* Agent.assertOrdinaryMode(selected, mode)
            return selected
          }).pipe(Effect.provide(locations.get(location)))
          : undefined
        const metaSelected = !parent && agent === "meta"
        const model = metaSelected
          ? yield* resolveMetaModel(sessionID, location, input.model, input.executorPreference, undefined, mode)
          : childController
            ? childController.executor.model
            : input.model ?? (parent ? selection?.info.model ?? ordinaryAgent?.model ?? parent.model : undefined)
        const controller = metaSelected
          ? new SessionSchema.RootController({
              kind: "root",
              metaAgentID: MetaAgent.ID.descending(),
              rootSessionID: sessionID,
            })
          : childController
        if (
          controller?.kind === "child" &&
          (input.agent !== controller.executor.agent ||
            (input.model !== undefined && !sameModel(input.model, controller.executor.model)))
        )
          return yield* new ControllerConflictError({
            sessionID,
            field: "executor",
            kind: "meta_binding_conflict",
            message: "Child execution fields must match the first binding",
          })
        if (parent?.controller && controller?.kind === "child") {
          yield* metas.assertOwner(parent)
          yield* metas.assertChildSource(
            parent,
            sessionID,
            controller.executor,
            controller.source,
            input.metadata ?? parent.metadata,
          )
        }
        const inheritedBehavior = selection && model && Model.Selection.isGroup(model)
          ? sameModel(model, selection.info.model)
            ? selection.snapshot.data.executors?.find((executor) => executor.id === selection.info.id)?.groupBehavior
            : selection.info.model === undefined && sameModel(model, parent?.model) ? selection.snapshot.data.groupBehavior : undefined
          : undefined
        if (selection && model && Model.Selection.isGroup(model) && controller?.kind !== "child" &&
          (sameModel(model, selection.info.model) || (selection.info.model === undefined && sameModel(model, parent?.model))) && inheritedBehavior?.groupID !== model.groupID)
          return yield* new ControllerConflictError({ sessionID, field: "model", kind: "frozen_group_behavior_missing", message: "The frozen source does not contain this model group's behavior" })
        const capturedBehavior = controller?.kind === "child" ? controller.executor.groupBehavior : inheritedBehavior
        const snapshot = selection
          ? SessionComposition.bindGroupBehavior(selection.snapshot, selection.info.id,
              capturedBehavior ?? (yield* captureGroupBehavior(sessionID, location, model)))
          : undefined
        const project = yield* projects.resolve(location.directory)
        const projected = yield* bus
          .publish(
            SessionEvent.Created,
            {
              sessionID,
              slug: Slug.create(),
              version: app.version,
              projectID: project.id,
              parentID: input.parentID,
              mode: parent ? undefined : mode,
              location,
              subpath: RelativePath.make(path.relative(project.directory, location.directory).replaceAll("\\", "/")),
              title: input.title,
              agent,
              controller,
              executorPreference: metaSelected ? input.executorPreference : undefined,
              // Children inherit metadata and permissions the way they inherit
              // location, so host policies that read them treat the family uniformly.
              metadata: input.metadata ?? parent?.metadata,
              permissions: input.permissions ?? parent?.permissions,
              consultation: input.consultation,
              model,
              groupBehavior: controller?.kind === "child" ? undefined : snapshot && agent ? SessionComposition.groupBehaviorFor(snapshot, agent) : undefined,
            },
            {
              location,
              commit: () =>
                Effect.gen(function* () {
                  if (parent && input.source) {
                    const current = yield* result.get(parent.id)
                    if (controller) yield* metas.assertOwner(current)
                    if (current.controller || input.executor)
                      yield* metas.assertChildSource(
                        current,
                        sessionID,
                        input.executor,
                        input.source,
                        input.metadata ?? parent.metadata,
                      )
                  }
                  if (snapshot) yield* SessionComposition.insertSnapshot(db, sessionID, snapshot)
                  if (controller) yield* commitMetaAssociation(controller, sessionID, model!, input.title)
                }).pipe(Effect.orDie),
            },
          )
          .pipe(
            Effect.as({ type: "created" } as const),
            Effect.catchDefect((defect) => {
              if (!(defect instanceof SessionProjector.SessionAlreadyProjected)) {
                return Effect.die(defect)
              }
              // Concurrent creation lost the projection race. The existing Session identity wins.
              return store
                .get(sessionID)
                .pipe(
                  Effect.flatMap((session) =>
                    session ? Effect.succeed({ type: "existing", session } as const) : Effect.die(defect),
                  ),
                )
            }),
          )
        if (projected.type === "existing") {
          if (projected.session.mode !== "custom" && input.frozenSnapshot === undefined) return projected.session
          if (selection)
            return yield* adoptFrozen(projected.session, {
              parentID: parent?.id,
              agent: selection.info.id,
              snapshot: snapshot ?? selection.snapshot,
              mode,
              parent,
              source: input.source,
              executor: input.executor,
              model: input.model,
            })
          return yield* new CompositionConflictError({ sessionID, reason: "custom_identity_mismatch" })
        }
        // TODO: Restore recorded sessions onto replacement synchronized workspaces in a future API slice.
        return yield* result.get(sessionID).pipe(Effect.orDie)
      }),
      createCustom: (input) => startCustom(input),
      upgradeCustom: Effect.fn("Session.upgradeCustom")(function* (input) {
        const source = yield* store.get(input.sessionID)
        if (!source) return yield* new NotFoundError({ sessionID: input.sessionID })
        yield* assertUpgradeSource(source)
        // Each upgrade creates an independent root. Source checks run again in
        // the event transaction so a freeze cannot commit against a moved/busy source.
        return yield* startCustom(
          {
            location: source.location,
            composition: input.composition,
            expectedPlanDigest: input.expectedPlanDigest,
            title: input.title ?? source.title,
            model: input.model,
            executorPreference: input.executorPreference,
          },
          () => assertUpgradeSource(source).pipe(Effect.orDie),
        ).pipe(
          Effect.catchDefect((defect) => {
            if (
              defect instanceof NotFoundError ||
              defect instanceof UpgradeSourceModeError ||
              defect instanceof UpgradeSourceMovedError ||
              defect instanceof BusyError
            )
              return Effect.fail(defect)
            return Effect.die(defect)
          }),
        )
      }),
      fork: Effect.fn("Session.fork")(function* (input) {
        if (input.before !== undefined && input.through !== undefined)
          return yield* new ForkConflictError({ sessionID: input.id ?? input.sessionID, parentID: input.sessionID })
        const requested: SessionSchema.ForkBoundary | undefined =
          input.before !== undefined
            ? { type: "before", messageID: input.before }
            : input.through !== undefined
              ? { type: "through", messageID: input.through }
              : undefined
        const parent = yield* result.get(input.sessionID)
        const metaControlled = input.child
          ? input.executor !== undefined || input.control === "meta"
          : (parent.controller?.kind === "root" && parent.agent === "meta") || input.control === "meta"
        const agent = metaControlled && input.child ? (input.agent ?? input.executor?.agent) : input.agent
        yield* ProductModePolicy.assertRuntimeSupported(parent.mode)
        if (parent.controller?.kind === "child")
          return yield* new ControllerConflictError({
            sessionID: parent.id,
            field: "sessionID",
            kind: "meta_child_recursion",
            message: "Meta children cannot fork new work",
          })
        if (
          (metaControlled || (parent.controller?.kind === "root" && parent.agent === "meta")) &&
          input.child &&
          (!input.source || (metaControlled && (!parent.controller || !input.executor)))
        )
          return yield* new ControllerConflictError({
            sessionID: parent.id,
            field: "child",
            kind: "meta_child_source_required",
            message: "Meta child forks require an owning source and first binding",
          })
        if (metaControlled && !input.child && input.agent !== undefined && input.agent !== "meta")
          return yield* new ControllerConflictError({
            sessionID: parent.id,
            field: "agent",
            kind: "meta_root_agent_conflict",
            message: "Meta root forks require agent meta",
          })
        const sourceSnapshot = (source: SessionSchema.Info) =>
          Effect.gen(function* () {
            return new SessionSchema.ForkExpectedSource({
              sourceSessionID: source.id,
              mode: source.mode,
              agent: source.agent,
              controller: source.controller,
              model: source.model,
              compositionDigest: source.mode === "custom" ? (yield* compositions.get(source.id)).digest : undefined,
            })
          })
        const captured = yield* sourceSnapshot(parent)
        const sourceMatches = (expected: SessionSchema.ForkExpectedSource, actual: SessionSchema.ForkExpectedSource) =>
          CompositionDigest.computeDigest(expected) === CompositionDigest.computeDigest(actual)
        const selection =
          parent.mode === "custom"
            ? yield* Effect.gen(function* () {
                if (!input.child) {
                  const snapshot = yield* compositions.get(parent.id)
                  const rootID = snapshot.version === 2 ? (snapshot.data.root?.id ?? "meta") : "meta"
                  // A Custom fork inherits its frozen root, including controller ownership.
                  if (metaControlled && rootID !== "meta")
                    return yield* new ControllerConflictError({
                      sessionID: parent.id,
                      field: "agent",
                      kind: "meta_root_agent_conflict",
                      message: "Meta root forks require agent meta",
                    })
                  const alias =
                    snapshot.version === 2 &&
                    snapshot.data.root !== undefined &&
                    snapshot.data.orchestrator !== undefined
                      ? String(snapshot.data.orchestrator.name)
                      : undefined
                  if (input.agent !== undefined && input.agent !== rootID && input.agent !== alias)
                    return yield* new CompositionConflictError({
                      sessionID: input.id ?? parent.id,
                      reason:
                        snapshot.version === 2 && snapshot.data.root !== undefined
                          ? "custom_root_requires_frozen_root"
                          : "custom_root_requires_meta",
                    })
                  return yield* compositions.selectAgent(parent.id, rootID)
                }
                if (agent === undefined || agent === "meta")
                  return yield* new CompositionConflictError({
                    sessionID: input.id ?? parent.id,
                    reason: "custom_executor_required",
                  })
                const selection = yield* compositions.selectAgent(parent.id, agent)
                if (selection.info.id === (selection.snapshot.data.root?.id ?? "meta"))
                  return yield* new CompositionConflictError({
                    sessionID: input.id ?? parent.id,
                    reason: "custom_executor_required",
                  })
                return selection
              })
            : undefined
        if (input.id) {
          const existing = yield* store.get(input.id)
          if (existing) {
            if (
              existing.fork?.sessionID !== parent.id ||
              existing.parentID !== (input.child ? parent.id : undefined) ||
              (requested
                ? existing.fork?.boundary.type !== requested.type ||
                  existing.fork.boundary.messageID !== requested.messageID
                : existing.fork?.boundary.type !== "through") ||
              (metaControlled
                ? existing.controller?.kind !== (input.child ? "child" : "root")
                : existing.controller !== undefined) ||
              (metaControlled &&
                parent.controller !== undefined &&
                existing.controller?.metaAgentID !== parent.controller.metaAgentID)
            )
              return yield* new ForkConflictError({ sessionID: input.id, parentID: parent.id })
            if (existing.controller?.kind === "child") {
              if (
                !bindingMatches(existing) ||
                !input.executor ||
                !sameExecutor(existing.controller.executor, input.executor) ||
                (agent !== undefined && agent !== existing.controller.executor.agent) ||
                (input.model !== undefined && !sameModel(input.model, existing.controller.executor.model))
              )
                return yield* new ControllerConflictError({
                  sessionID: existing.id,
                  field: "executor",
                  kind: "meta_binding_conflict",
                  message: "Child fork fields must match the first binding",
                })
              yield* metas.assertChildSource(parent, existing.id, input.executor, input.source!, existing.metadata)
            }
            yield* metas.assertOwner(existing)
            if (selection)
              return yield* adoptFrozen(existing, {
                parentID: input.child ? parent.id : undefined,
                agent: selection.info.id,
                snapshot: selection.snapshot,
                parent,
                model: input.model,
              })
            if (existing.mode === "custom" || (agent !== undefined && existing.agent !== agent))
              return yield* new ForkConflictError({ sessionID: input.id, parentID: parent.id })
            return existing
          }
        }
        if (selection === undefined && agent !== undefined)
          yield* Effect.gen(function* () {
            const agents = yield* Agent.Service
            const selected = yield* agents.get(Agent.ID.make(agent))
            if (selected) yield* Agent.assertOrdinaryMode(selected, parent.mode)
          }).pipe(Effect.provide(locations.get(parent.location)))
        if (
          input.control === "meta" &&
          !parent.controller &&
          (!input.expectedSource || !sourceMatches(input.expectedSource, captured))
        )
          return yield* new ControllerConflictError({
            sessionID: parent.id,
            field: "expectedSource",
            kind: "fork_source_conflict",
            message: "Preview the current source before adopting Meta control",
          })
        if (input.expectedSource && !sourceMatches(input.expectedSource, captured))
          return yield* new ControllerConflictError({
            sessionID: parent.id,
            field: "expectedSource",
            kind: "fork_source_conflict",
            message: "Fork source changed; preview again",
          })
        const boundary = yield* db
          .select({ id: SessionMessageTable.id })
          .from(SessionMessageTable)
          .where(
            and(
              eq(SessionMessageTable.session_id, input.sessionID),
              requested ? eq(SessionMessageTable.id, requested.messageID) : undefined,
            ),
          )
          .orderBy(desc(SessionMessageTable.seq))
          .limit(1)
          .get()
          .pipe(Effect.orDie)
        if (!boundary && requested)
          return yield* new MessageNotFoundError({
            sessionID: input.sessionID,
            messageID: requested.messageID,
          })
        if (!boundary) return yield* new ForkEmptyError({ sessionID: input.sessionID })
        const sessionID = input.id ?? SessionSchema.ID.create()
        const childController =
          input.child && input.source && (parent.controller || input.executor)
            ? yield* metas.assertChildSource(parent, sessionID, input.executor, input.source, parent.metadata)
            : undefined
        if (parent.controller) yield* metas.assertOwner(parent)
        const model = metaControlled
          ? input.child
            ? input.executor!.model
            : yield* resolveMetaModel(
                sessionID,
                parent.location,
                input.model ?? parent.model,
                input.executorPreference ?? parent.executorPreference,
                selection?.snapshot.version === 2
                  ? (selection.snapshot.data.executors?.map((executor) => executor.info) ?? [])
                  : undefined,
                parent.mode,
              )
          : input.model
        const controller = metaControlled
          ? input.child
            ? childController
            : new SessionSchema.RootController({
                kind: "root",
                metaAgentID: parent.controller?.metaAgentID ?? MetaAgent.ID.descending(),
                rootSessionID: sessionID,
              })
          : undefined
        if (controller?.kind === "child") {
          if (
            agent !== controller.executor.agent ||
            (input.model !== undefined && !sameModel(input.model, controller.executor.model))
          )
            return yield* new ControllerConflictError({
              sessionID,
              field: "executor",
              kind: "meta_binding_conflict",
              message: "Child fork fields must match the first binding",
            })
          yield* metas.assertChildSource(parent, sessionID, controller.executor, controller.source, parent.metadata)
        }
        const forkAgent = selection?.info.id ?? agent
        const selectedModel = model ?? parent.model ?? selection?.info.model
        const inheritedAgent = sameModel(selectedModel, parent.model)
          ? parent.agent ?? selection?.snapshot.data.root?.id ?? "meta"
          : sameModel(selectedModel, selection?.info.model) ? selection?.info.id : undefined
        const inheritedBehavior = selection && inheritedAgent !== undefined
          ? SessionComposition.groupBehaviorFor(selection.snapshot, inheritedAgent)
          : undefined
        if (selection && selectedModel && Model.Selection.isGroup(selectedModel) && controller?.kind !== "child" &&
          inheritedAgent !== undefined && inheritedBehavior?.groupID !== selectedModel.groupID)
          return yield* new ControllerConflictError({ sessionID, field: "model", kind: "frozen_group_behavior_missing", message: "The frozen fork source does not contain this model group's behavior" })
        const snapshot = selection
          ? SessionComposition.bindGroupBehavior(selection.snapshot, selection.info.id,
              controller?.kind === "child" ? controller.executor.groupBehavior :
                selectedModel && Model.Selection.isGroup(selectedModel) ? inheritedBehavior ?? (yield* captureGroupBehavior(sessionID, parent.location, selectedModel)) : undefined)
          : undefined
        const groupBehavior = controller?.kind === "child" ? undefined : snapshot && forkAgent ? SessionComposition.groupBehaviorFor(snapshot, forkAgent) : undefined
        const inherited = yield* db
          .transaction(() =>
            Effect.all({
              instructions: InstructionState.current(db, parent.id),
              instructionEntries: InstructionEntry.snapshot(db, parent.id),
            }),
          )
          .pipe(Effect.orDie)
        // The fork adopts the parent's newest instruction values rather than the
        // values in effect at the boundary; copied history may contain frozen
        // instruction-update text the initial baseline already reflects.
        yield* bus
          .publish(
            SessionEvent.Forked,
            {
              sessionID,
              parentID: parent.id,
              boundary: requested ?? { type: "through", messageID: boundary.id },
              child: input.child,
              agent: selection?.info.id ?? agent,
              controller,
              model,
              groupBehavior,
              executorPreference:
                controller?.kind === "root" ? (input.executorPreference ?? parent.executorPreference) : undefined,
              ...inherited,
            },
            {
              commit: () =>
                Effect.gen(function* () {
                  const current = yield* result.get(parent.id)
                  if (
                    (metaControlled || input.expectedSource) &&
                    (!sourceMatches(captured, yield* sourceSnapshot(current)) ||
                      current.location.directory !== parent.location.directory ||
                      current.location.workspaceID !== parent.location.workspaceID)
                  )
                    return yield* Effect.die(
                      new ControllerConflictError({
                        sessionID: parent.id,
                        field: "expectedSource",
                        kind: "fork_source_conflict",
                        message: "Fork source changed; preview again",
                      }),
                    )
                  if (controller?.kind === "child")
                    yield* metas.assertChildSource(
                      current,
                      sessionID,
                      controller.executor,
                      controller.source,
                      parent.metadata,
                    )
                  if (snapshot) yield* SessionComposition.insertSnapshot(db, sessionID, snapshot)
                  if (controller)
                    yield* commitMetaAssociation(
                      controller,
                      sessionID,
                      model!,
                      parent.title,
                      parent.controller !== undefined,
                      groupBehavior,
                    )
                }).pipe(Effect.orDie),
            },
          )
          .pipe(
            Effect.catchDefect((defect) =>
              defect instanceof ControllerConflictError ? Effect.fail(defect) : Effect.die(defect),
            ),
          )
        return yield* result.get(sessionID).pipe(Effect.orDie)
      }),
      get: (sessionID) => sessions.forSession(sessionID).get(),
      environment: Effect.fn("Session.environment")(function* (input) {
        yield* result.get(input.sessionID)
        if (input.variables !== undefined) yield* environments.set(input.sessionID, input.variables)
        return yield* environments.get(input.sessionID)
      }),
      view: (input) => sessions.forSession(input.sessionID).view(input),
      remove: Effect.fn("Session.remove")(function* (sessionID) {
        return yield* jobs.withSessionDeletion(
          sessionID,
          Effect.gen(function* () {
            yield* result.get(sessionID)
            yield* execution.interrupt(sessionID)
            yield* execution.awaitIdle(sessionID)
            yield* jobs.cancelAllForSession(sessionID)
            yield* transport.close(sessionID)
            const children = yield* result.list({ parentID: sessionID })
            yield* Effect.forEach(children.data, (child) => result.remove(child.id), { concurrency: 1, discard: true })
            yield* environments.clear(sessionID)
            yield* bus.publish(SessionEvent.Deleted, { sessionID })
            yield* bus.remove(sessionID)
          }),
        )
      }),
      list: Effect.fn("Session.list")(function* (input) {
        return { data: yield* store.list(input) }
      }),
      messages: Effect.fn("Session.messages")(function* (input) {
        yield* result.get(input.sessionID)
        return yield* store.messages(input)
      }),
      message: (input) => sessions.forSession(input.sessionID).message(input.messageID),
      context: Effect.fn("Session.context")(function* (sessionID) {
        yield* result.get(sessionID)
        return yield* store.context(sessionID)
      }),
      diff: Effect.fn("Session.diff")(function* (input) {
        const session = yield* result.get(input.sessionID)
        const active = yield* execution.isActive(input.sessionID)
        return yield* SessionDiff.turn(db, locations, {
          session,
          active,
          from: input.from,
          to: input.to,
          context: input.context,
        })
      }),
      inbox: (sessionID) => sessions.forSession(sessionID).inbox(),
      cancelInbox: (input) => sessions.forSession(input.sessionID).cancelInbox(input.inboxID),
      steerInbox: (input) => sessions.forSession(input.sessionID).steerInbox(input.inboxID),
      queueInbox: (input) => sessions.forSession(input.sessionID).queueInbox(input.inboxID),
      log: (input) =>
        Stream.unwrap(
          result
            .get(input.sessionID)
            .pipe(Effect.as(bus.log({ aggregateID: input.sessionID, after: input.after, follow: input.follow }))),
        ).pipe(
          Stream.filter(
            (item): item is SessionEvent.DurableEvent | SessionTaskEvent.DurableEvent | EventLog.Synced =>
              Bus.isSynced(item) || isDurableSessionEvent(item),
          ),
        ),
      prompt: (input) => sessions.forSession(input.sessionID).prompt(input),
      generate: Effect.fn("Session.generate")(function* (input) {
        const session = yield* result.get(input.sessionID)
        return yield* SessionGenerate.generate({ session, prompt: input.prompt }).pipe(
          Effect.provideService(Instance.Service, instances),
          Effect.provideService(Database.Service, database),
          Effect.provideService(LLMClient.Service, llm),
        )
      }),
      command: Effect.fn("Session.command")(function* (input) {
        const session = yield* result.get(input.sessionID)
        return yield* SessionCommand.execute({ ...input, session }).pipe(
          Effect.provideService(Instance.Service, instances),
          Effect.provideService(SessionComposition.Service, compositions),
          Effect.provideService(Service, result),
        )
      }),
      shell: (input) => sessions.forSession(input.sessionID).shell(input),
      skill: (input) => sessions.forSession(input.sessionID).skill(input),
      switchAgent: Effect.fn("Session.switchAgent")(function* (input) {
        const session = yield* result.get(input.sessionID)
        if (session.mode !== "custom" && session.controller?.kind !== "child")
          yield* Effect.gen(function* () {
            const agents = yield* Agent.Service
            const agent = yield* agents.get(input.agent)
            if (agent) yield* Agent.assertOrdinaryMode(agent, session.mode)
          }).pipe(Effect.provide(locations.get(session.location)))
        if (input.agent !== "meta" || session.parentID || session.controller?.kind === "child")
          return yield* sessions.forSession(input.sessionID).switchAgent(input)
        yield* ProductModePolicy.assertRuntimeSupported(session.mode)
        const model = yield* resolveMetaModel(session.id, session.location, input.model ?? session.model)
        if (session.controller) yield* metas.assertOwner(session)
        const controller = session.controller
          ? undefined
          : new SessionSchema.RootController({
              kind: "root",
              metaAgentID: MetaAgent.ID.descending(),
              rootSessionID: session.id,
            })
        return yield* sessions
          .forSession(input.sessionID)
          .switchAgent({ ...input, model, controller })
          .pipe(
            Effect.catchTag("Session.ControllerConflictError", (error) =>
              Effect.gen(function* () {
                const current = yield* result.get(input.sessionID)
                if (
                  current.agent !== "meta" ||
                  current.controller?.kind !== "root" ||
                  (session.controller && current.controller.metaAgentID !== session.controller.metaAgentID) ||
                  !sameModel(current.model, model)
                )
                  return yield* error
                yield* metas.assertOwner(current)
              }),
            ),
          )
      }),
      switchModel: Effect.fn("Session.switchModel")(function* (input) {
        const session = yield* result.get(input.sessionID)
        const model =
          session.controller?.kind === "root" && session.agent === "meta"
            ? yield* resolveMetaModel(session.id, session.location, input.model)
            : input.model
        const groupBehavior = session.mode === "custom" && session.controller?.kind !== "child" && !sameModel(session.model, model)
          ? yield* captureGroupBehavior(session.id, session.location, model)
          : undefined
        return yield* sessions.forSession(input.sessionID).switchModel({ ...input, model, groupBehavior })
      }),
      selectExecutor: Effect.fn("Session.selectExecutor")(function* (input) {
        const session = yield* result.get(input.sessionID)
        if (session.controller?.kind !== "root")
          return yield* new ControllerConflictError({
            sessionID: session.id,
            field: "executorPreference",
            kind: "executor_selection_unsupported",
            message: "Executor selection requires a Meta root",
          })
        const frozen =
          session.mode === "custom"
            ? [
                (yield* compositions.selectAgent(session.id, input.executorPreference.agent).pipe(
                  Effect.mapError(
                    () =>
                      new ControllerConflictError({
                        sessionID: session.id,
                        field: "executorPreference.agent",
                        kind: "executor_unavailable",
                        message: "Executor is unavailable in the frozen composition",
                      }),
                  ),
                )).info,
              ]
            : undefined
        yield* resolveMetaModel(
          session.id,
          session.location,
          session.model,
          input.executorPreference,
          frozen,
          session.mode,
        )
        if (
          session.executorPreference?.agent === input.executorPreference.agent &&
          sameModel(session.executorPreference.model, input.executorPreference.model)
        )
          return session
        yield* bus.publish(SessionEvent.ExecutorSelected, input)
        return yield* result.get(session.id)
      }),
      rename: (input) => sessions.forSession(input.sessionID).rename(input),
      setMetadata: (input) => sessions.forSession(input.sessionID).setMetadata(input),
      setPermissions: (input) => sessions.forSession(input.sessionID).setPermissions(input),
      move: moves.move,
      compact: (input) => sessions.forSession(input.sessionID).compact(input),
      wait: (sessionID) => sessions.forSession(sessionID).wait(),
      active: execution.active,
      background: Effect.fn("Session.background")(function* (sessionID) {
        yield* result.get(sessionID)
        const backgrounded = yield* jobs.backgroundAll({ sessionID })
        if (backgrounded.length === 0) return
        yield* result
          .synthetic({
            sessionID,
            text: [
              "User requested that active blocking work be moved to the background.",
              "",
              "Backgrounded work:",
              ...backgrounded.map((job) => `- ${job.type}: ${job.title && job.title.length > 0 ? job.title : job.id}`),
              "",
              "The backgrounded work is still unfinished. Move on to other work if you can. If there is nothing else useful to do, finish your response. Do not wait, sleep, poll, or report the backgrounded work as complete until a later completion notification is added to the conversation.",
            ].join("\n"),
          })
          .pipe(Effect.catchTag("Session.SyntheticConflictError", Effect.die))
      }),
      resume: (sessionID) => sessions.forSession(sessionID).resume(),
      synthetic: (input, options) => sessions.forSession(input.sessionID).synthetic(input, options),
      interrupt: (sessionID, options) => sessions.forSession(sessionID).interrupt(options),
      revert: {
        stage: (input) => sessions.forSession(input.sessionID).revert.stage(input),
        clear: (sessionID) => sessions.forSession(sessionID).revert.clear(),
        commit: (sessionID) => sessions.forSession(sessionID).revert.commit(),
      },
    })

    return result
  }),
)

export const node: LayerNode.Provider<Service, never, typeof Node.tags.values.global> = Node.makeGlobalNode({
  service: Service,
  layer,
  deps: [
    Job.node,
    SessionEnvironment.node,
    Database.node,
    Bus.node,
    Project.node,
    SessionExecution.node,
    SessionModelTransport.node,
    llmClient,
    SessionStore.node,
    SessionComposition.node,
    WorkflowRun.node,
    MetaAgentService.node,
    SessionTask.node,
    SessionGoal.node,
    ScheduleService.node,
    Instance.node,
    SessionInbox.node,
    SessionMove.node,
    SessionProjector.node,
    LocationServiceMap.node,
    FSUtil.node,
    App.node,
  ],
})
