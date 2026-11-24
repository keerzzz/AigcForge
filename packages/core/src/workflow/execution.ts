export * as WorkflowExecution from "./execution.js"

import { Cause, Context, Effect, Exit, Layer, Option, Schema } from "effect"
import { Composition } from "@omnixa/schema/composition"
import { WorkflowAsset } from "@omnixa/schema/workflow-asset"
import { Node, makeGlobalNode } from "@omnixa/util/effect/app-node"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { CompositionDigest } from "../composition/digest.js"
import { CompositionResolver } from "../composition-resolver.js"
import { Bus } from "../bus.js"
import { CredentialScanner } from "../credential-scanner.js"
import { Database } from "../database/database.js"
import { FileSystem } from "../filesystem.js"
import { KeyedMutex } from "../effect/keyed-mutex.js"
import { Job } from "../job.js"
import { ProductModePolicy } from "../product-mode-policy.js"
import { Session } from "../session.js"
import { SessionSchema } from "../session/schema.js"
import { SessionComposition } from "../session/composition.js"
import { SessionInputResult } from "../session/input-result.js"
import { SessionExecution } from "../session/execution.js"
import { SessionMessage } from "../session/message.js"
import { SessionTask } from "../session/task.js"
import { SessionStore } from "../session/store.js"
import { SessionNotification } from "../session/notification.js"
import { WorkflowRun } from "./workflow-run.js"
import { MetaAgentService } from "../meta-agent/service.js"
import { LocationServiceMap } from "../location-service-map.js"

export class InvalidError extends Schema.TaggedError<InvalidError>()("WorkflowExecution.InvalidError", {
  sessionID: Session.ID,
  reason: Schema.String,
}) {
  override get message() {
    return this.reason
  }
}

export class ConflictError extends Schema.TaggedError<ConflictError>()("WorkflowExecution.ConflictError", {
  sessionID: Session.ID,
  reason: Schema.String,
}) {
  override get message() {
    return this.reason
  }
}

export class TaskRetry extends Schema.Class<TaskRetry>("WorkflowExecution.TaskRetry")({
  runID: WorkflowAsset.WorkflowRunID,
  stepRunID: WorkflowAsset.StepRunID,
  expectedRunRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  expectedStepRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
}) {}

export type Error =
  | InvalidError
  | ConflictError
  | Session.NotFoundError
  | SessionComposition.Error
  | ProductModePolicy.UnsupportedProductModeError
  | WorkflowRun.WorkflowNotFoundError
  | WorkflowRun.StepNotFoundError
  | WorkflowRun.RequestConflictError
  | WorkflowRun.InvalidStateTransitionError
  | WorkflowRun.InvalidBranchOutputError
  | SessionTask.TaskWriteError
  | Composition.ResolveError
  | FileSystem.DirectoryNotFoundError

export interface Interface {
  readonly task: (input: {
    readonly sessionID: Session.ID
    readonly agent: string
    readonly source: WorkflowRun.TaskBinding["source"]
    readonly composition?: Composition.CompositionInput
    readonly retry?: TaskRetry
    readonly expectedPlanDigest?: Composition.Digest
    readonly description: string
    readonly parentTaskID?: string
    readonly onAdmitted?: (input: {
      readonly runID: WorkflowAsset.WorkflowRunID
      readonly parentTaskID: string
      readonly parentTaskRevision: number
    }) => Effect.Effect<void>
  }) => Effect.Effect<
    {
      readonly run: WorkflowAsset.WorkflowRunInfo
      readonly parentTaskID: string
      readonly parentTaskRevision: number
      readonly text: string
    },
    Error
  >
  readonly run: (input: {
    readonly sessionID: Session.ID
    readonly requestID: string
    readonly expectedSnapshotDigest: Composition.Digest
  }) => Effect.Effect<WorkflowAsset.WorkflowStatusResponse, Error>
  readonly cancelRun: (input: {
    readonly sessionID: Session.ID
    readonly runID: WorkflowAsset.WorkflowRunID
    readonly expectedRunRevision: number
  }) => Effect.Effect<WorkflowAsset.WorkflowStatusResponse, Error>
  readonly cancelStep: (input: {
    readonly sessionID: Session.ID
    readonly runID: WorkflowAsset.WorkflowRunID
    readonly stepRunID: WorkflowAsset.StepRunID
    readonly expectedRunRevision: number
    readonly expectedStepRevision: number
  }) => Effect.Effect<WorkflowAsset.WorkflowStatusResponse, Error>
  readonly retryStep: (input: {
    readonly sessionID: Session.ID
    readonly runID: WorkflowAsset.WorkflowRunID
    readonly stepRunID: WorkflowAsset.StepRunID
    readonly requestID: string
    readonly expectedRunRevision: number
    readonly expectedStepRevision: number
  }) => Effect.Effect<WorkflowAsset.WorkflowStatusResponse, Error>
  /** Explicitly inspect durable inputs after restart; never replay unknown provider work. */
  readonly resume: (input: {
    readonly sessionID: Session.ID
    readonly runID?: WorkflowAsset.WorkflowRunID
  }) => Effect.Effect<WorkflowAsset.WorkflowStatusResponse, Error>
  readonly wait: (runID: WorkflowAsset.WorkflowRunID) => Effect.Effect<WorkflowAsset.WorkflowStatusResponse, Error>
  /** Startup reconciliation reads durable results without starting step Jobs. */
  readonly reconcilePending: Effect.Effect<readonly Session.ID[], Error>
}

export class Service extends Context.Service<Service, Interface>()("@omnixa/v2/WorkflowExecution") {}

class BatchAbort extends Schema.TaggedError<BatchAbort>()("WorkflowExecution.BatchAbort", {
  category: WorkflowAsset.ErrorCategory,
}) {}

class StepTimeout extends Schema.TaggedError<StepTimeout>()("WorkflowExecution.StepTimeout", {}) {}

const MAX_HANDOFF = 12_000
const MAX_STEP_OUTPUT = 2_000
const requestIDSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))
const decodeBranch = Schema.decodeUnknownOption(Schema.fromJsonString(WorkflowAsset.BranchOutput), {
  onExcessProperty: "error",
})
const terminal = (status: WorkflowAsset.WorkflowRunStatus) =>
  status !== "pending" && status !== "running" && status !== "cancelling"
const activeStep = (step: WorkflowAsset.StepRunInfo) =>
  step.status === "dispatching" || step.status === "running" || step.status === "cancelling"
const latestSteps = (steps: readonly WorkflowAsset.StepRunInfo[]) => [
  ...steps
    .reduce((latest, step) => {
      const previous = latest.get(step.stepId)
      if (!previous || previous.attempt < step.attempt) latest.set(step.stepId, step)
      return latest
    }, new Map<string, WorkflowAsset.StepRunInfo>())
    .values(),
]
const runJobID = (runID: WorkflowAsset.WorkflowRunID) => `workflow/${runID}`
const stepJobID = (stepID: WorkflowAsset.StepRunID) => `workflow/step/${stepID}`
const childIDFor = (stepID: string) =>
  Session.ID.make(`ses_${CompositionDigest.computeDigest({ workflowChild: stepID }).slice(0, 32)}`)
const inputIDFor = (stepID: string) => MetaAgentService.workflowInputID(stepID)
const handoffIDFor = (runID: WorkflowAsset.WorkflowRunID) =>
  SessionMessage.ID.make(`msg_${CompositionDigest.computeDigest({ workflowResult: runID }).slice(0, 32)}`)
const boundText = (text: string, limit: number) => {
  const points = Array.from(text)
  const marker = "\n[truncated]"
  return points.length <= limit ? text : `${points.slice(0, Math.max(0, limit - marker.length)).join("")}${marker}`
}
const assistantText = (assistant: SessionMessage.Assistant) =>
  assistant.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
const parentTaskStatus = (run: WorkflowAsset.WorkflowRunInfo) =>
  run.status === "completed" || run.status === "partial_success"
    ? ("completed" as const)
    : run.status === "cancelled"
      ? ("cancelled" as const)
      : ("failed" as const)
const parentTaskDigest = (run: WorkflowAsset.WorkflowRunInfo) =>
  CompositionDigest.computeDigest({ runID: run.id, status: run.status })

/** A branch is exactly one JSON object; prose, fences and extra fields are not an execution contract. */
export function branchOutput(step: WorkflowAsset.StepDef, text: string) {
  if (!step.branches) return undefined
  const decoded = decodeBranch(text.trim())
  if (Option.isNone(decoded) || !Object.hasOwn(step.branches, decoded.value.branch)) return undefined
  if (decoded.value.summary !== undefined && Array.from(decoded.value.summary).length > MAX_STEP_OUTPUT)
    return undefined
  const target = step.branches[decoded.value.branch]
  if (typeof target !== "string") return undefined
  return { target, summary: decoded.value.summary }
}

/** One failure decision for live scheduling and startup reconciliation. */
export function failureDecision(step: WorkflowAsset.StepRunInfo, definition: WorkflowAsset.StepDef | undefined) {
  if (step.status === "execution_unknown") return { type: "recover" as const }
  if (step.status === "cancelled") return { type: "abort" as const, category: "step_cancelled" as const }
  if (step.status !== "failed") return { type: "none" as const }
  if (definition?.failurePolicy === "continue" && !definition.branches) return { type: "continue" as const }
  if (definition?.failurePolicy === "retry") {
    if (step.attempt < (definition.maxAttempts ?? 1)) return { type: "retry" as const }
    return { type: "abort" as const, category: "max_attempts_exceeded" as const }
  }
  return { type: "abort" as const, category: step.errorCategory ?? "step_failed" }
}

/** Job owns fibers; WorkflowRun owns durable state; Session owns every model call and input result. */
export const make = Effect.gen(function* () {
  const runs = yield* WorkflowRun.Service
  const sessions = yield* Session.Service
  const sessionExecution = yield* SessionExecution.Service
  const compositions = yield* SessionComposition.Service
  const jobs = yield* Job.Service
  const tasks = yield* SessionTask.Service
  const database = yield* Database.Service
  const bus = yield* Bus.Service
  const store = yield* SessionStore.Service
  const scanner = yield* CredentialScanner.Service
  const locations = yield* LocationServiceMap.Service
  const metas = yield* MetaAgentService.Service
  const locks = yield* KeyedMutex.make<Session.ID>()

  const status = Effect.fnUntraced(function* (runID: WorkflowAsset.WorkflowRunID) {
    return new WorkflowAsset.WorkflowStatusResponse({ run: yield* runs.get(runID), steps: yield* runs.getSteps(runID) })
  })

  const root = Effect.fnUntraced(function* (sessionID: Session.ID) {
    const session = yield* sessions.get(sessionID)
    yield* ProductModePolicy.assertRuntimeSupported(session.mode)
    if (session.mode !== "custom" || session.parentID !== undefined)
      return yield* new InvalidError({ sessionID, reason: "workflow_requires_custom_root" })
    const selection = yield* SessionComposition.selectSessionAgent(compositions, session)
    const workflow = selection.snapshot.data.workflow
    if (!workflow || !WorkflowAsset.validateGraph(workflow.steps).valid)
      return yield* new InvalidError({ sessionID, reason: "workflow_definition_invalid" })
    return { session, snapshot: selection.snapshot, workflow }
  })

  const ownedRun = Effect.fnUntraced(function* (sessionID: Session.ID, runID: WorkflowAsset.WorkflowRunID) {
    const run = yield* runs.get(runID)
    if (run.sessionID !== sessionID) return yield* new WorkflowRun.WorkflowNotFoundError({ runID })
    return run
  })

  const frozenRun = Effect.fnUntraced(function* (sessionID: Session.ID, runID: WorkflowAsset.WorkflowRunID) {
    const admission = yield* runs.admission(sessionID, runID)
    const session = yield* sessions.get(sessionID)
    yield* ProductModePolicy.assertRuntimeSupported(session.mode)
    if (session.mode !== "custom" && (!admission.snapshot || !admission.taskBinding))
      return yield* new InvalidError({ sessionID, reason: "workflow_task_frozen_binding_missing" })
    const snapshot = admission.snapshot ?? (yield* root(sessionID)).snapshot
    const workflow = snapshot.data.workflow
    if (!workflow || !WorkflowAsset.validateGraph(workflow.steps).valid)
      return yield* new InvalidError({ sessionID, reason: "workflow_definition_invalid" })
    if (snapshot.digest !== admission.run.snapshotDigest || workflow.revision !== admission.run.workflowRevision)
      return yield* new ConflictError({ sessionID, reason: "workflow_snapshot_conflict" })
    return { session, snapshot, workflow, taskBinding: admission.taskBinding }
  })

  const ownedStep = Effect.fnUntraced(function* (runID: WorkflowAsset.WorkflowRunID, stepID: WorkflowAsset.StepRunID) {
    const step = (yield* runs.getSteps(runID)).find((candidate) => candidate.id === stepID)
    if (!step) return yield* new WorkflowRun.StepNotFoundError({ stepRunID: stepID })
    return step
  })

  const requestID = (sessionID: Session.ID, value: string) =>
    Schema.is(requestIDSchema)(value)
      ? Effect.void
      : new InvalidError({ sessionID, reason: "workflow_request_id_invalid" })

  const requireAvailable = Effect.fnUntraced(function* (sessionID: Session.ID) {
    if (yield* jobs.isDeletingSession(sessionID))
      return yield* new ConflictError({ sessionID, reason: "workflow_session_deleting" })
  })

  const childForStep = Effect.fnUntraced(function* (
    sessionID: Session.ID,
    step: WorkflowAsset.StepRunInfo,
    current = true,
  ) {
    if (!step.childSessionId) return undefined
    const child = yield* sessions
      .get(Session.ID.make(step.childSessionId))
      .pipe(Effect.catchTag("Session.NotFoundError", () => Effect.succeed(undefined)))
    if (!child) return undefined
    if (
      child.parentID !== sessionID ||
      child.metadata?.workflowRootSessionID !== sessionID ||
      child.metadata.workflowStepID !== step.stepId ||
      typeof child.metadata.workflowStepRunID !== "string" ||
      child.metadata.workflowInputID !== inputIDFor(child.metadata.workflowStepRunID) ||
      (current && (child.metadata.workflowStepRunID !== step.id || child.metadata.workflowRunID !== step.runId))
    ) {
      return yield* new InvalidError({ sessionID, reason: "workflow_child_identity_mismatch" })
    }
    const parent = yield* sessions.get(sessionID)
    if (parent.controller) {
      const controller = child.controller
      if (
        controller?.kind !== "child" ||
        controller.source.kind !== "workflow" ||
        controller.source.runID !== child.metadata.workflowRunID ||
        controller.source.stepRunID !== child.metadata.workflowStepRunID ||
        controller.source.inputID !== child.metadata.workflowInputID
      )
        return yield* new InvalidError({ sessionID, reason: "workflow_child_identity_mismatch" })
      yield* metas
        .assertOwner(child)
        .pipe(Effect.mapError(() => new InvalidError({ sessionID, reason: "workflow_child_identity_mismatch" })))
    }
    return { child, inputID: inputIDFor(child.metadata.workflowStepRunID) }
  })

  const inputResult = Effect.fnUntraced(function* (
    sessionID: Session.ID,
    step: WorkflowAsset.StepRunInfo,
    current = true,
  ) {
    const owned = yield* childForStep(sessionID, step, current)
    if (!owned) return { status: "missing" as const, source: undefined }
    const result = yield* SessionInputResult.read(database.db, {
      sessionID: owned.child.id,
      inputID: owned.inputID,
    }).pipe(Effect.mapError(() => new InvalidError({ sessionID, reason: "workflow_input_result_invalid" })))
    return {
      ...result,
      source: {
        runID: owned.child.metadata?.workflowRunID,
        stepRunID: owned.child.metadata?.workflowStepRunID,
        childSessionID: owned.child.id,
        inputID: owned.inputID,
        resultStatus: result.status,
      },
    }
  })

  const patchTask = Effect.fnUntraced(function* (sessionID: Session.ID, step: WorkflowAsset.StepRunInfo) {
    if (!step.taskId) return
    const binding = (yield* runs.admission(sessionID, step.runId)).taskBinding
    const state =
      step.status === "completed"
        ? "completed"
        : step.status === "failed" || step.status === "execution_unknown"
          ? "failed"
          : "cancelled"
    // Workflow-created tasks start at revision 1 (TaskTable's insert contract).
    // A later user edit revokes this projection claim; never adopt its revision.
    yield* tasks
      .patch(
        {
          sessionID,
          id: step.taskId,
          status: state,
          outputDigest: step.outputDigest,
          expectedRevision: 1,
          expect: ["in_progress"],
        },
        binding && step.status !== "execution_unknown"
          ? { settle: { source: binding.source, revision: 1 } }
          : undefined,
      )
      .pipe(Effect.mapError(() => new InvalidError({ sessionID, reason: "workflow_task_projection_failed" })))
  })

  const cleanupChild = Effect.fnUntraced(function* (sessionID: Session.ID, step: WorkflowAsset.StepRunInfo) {
    const owned = yield* childForStep(sessionID, step, false)
    if (!owned) return
    // Lineage carries old settled identities. This run cannot cancel their children.
    if (owned.child.metadata?.workflowStepRunID !== step.id || owned.child.metadata.workflowRunID !== step.runId) return
    yield* sessions.interrupt(owned.child.id, { resume: false })
    yield* sessions.wait(owned.child.id)
    const pending = (yield* sessions.inbox(owned.child.id)).find((entry) => entry.id === owned.inputID)
    if (pending)
      yield* sessions
        .cancelInbox({ sessionID: owned.child.id, inboxID: owned.inputID })
        .pipe(Effect.catchTag("Session.InboxConflictError", () => Effect.void))
  })

  const cleanup = Effect.fnUntraced(function* (sessionID: Session.ID, runID: WorkflowAsset.WorkflowRunID) {
    const steps = latestSteps(yield* runs.getSteps(runID))
    yield* Effect.forEach(
      steps,
      (step) =>
        Effect.gen(function* () {
          yield* jobs.cancel(stepJobID(step.id))
          if (
            activeStep(step) ||
            step.status === "cancelled" ||
            step.status === "execution_unknown" ||
            step.status === "skipped"
          )
            yield* cleanupChild(sessionID, step)
        }),
      { discard: true, concurrency: WorkflowAsset.MAX_PARALLEL },
    )
  })

  const settleKnown = Effect.fnUntraced(function* (
    sessionID: Session.ID,
    step: WorkflowAsset.StepRunInfo,
    definition: WorkflowAsset.StepDef,
    result: SessionInputResult.Result,
  ) {
    if (result.status === "completed") {
      const text = assistantText(result.assistant)
      const branch = branchOutput(definition, text)
      const updated = yield* runs.settleStep({
        stepRunID: step.id,
        expectedRevision: step.revision,
        status: definition.branches && !branch ? "failed" : "completed",
        errorCategory: definition.branches && !branch ? "invalid_branch_output" : undefined,
        branchTarget: branch?.target,
        outputDigest: CompositionDigest.computeDigest(text),
      })
      yield* patchTask(sessionID, updated)
      return updated
    }
    if (result.status === "failed" || result.status === "interrupted") {
      const updated = yield* runs.settleStep({
        stepRunID: step.id,
        expectedRevision: step.revision,
        status: result.status === "failed" ? "failed" : "cancelled",
        errorCategory: result.status === "failed" ? "step_failed" : "step_cancelled",
      })
      yield* patchTask(sessionID, updated)
      return updated
    }
    return undefined
  })

  const unknown = Effect.fnUntraced(function* (
    sessionID: Session.ID,
    runID: WorkflowAsset.WorkflowRunID,
    unsafeStepIDs: readonly WorkflowAsset.StepRunID[] = [],
  ) {
    const run = yield* runs.get(runID)
    if (terminal(run.status) || run.status === "cancelling") return
    // Absence of an exact durable terminal never authorizes replaying provider/tool work.
    yield* runs.requireRecovery({ runID, expectedRevision: run.revision, unsafeStepIDs })
    yield* cleanup(sessionID, runID)
    yield* Effect.forEach(
      latestSteps(yield* runs.getSteps(runID)).filter((step) => step.status === "execution_unknown"),
      (step) => patchTask(sessionID, step),
      { discard: true },
    )
  })

  const settleParentTask = Effect.fnUntraced(function* (sessionID: Session.ID, runID: WorkflowAsset.WorkflowRunID) {
    const admission = yield* runs.admission(sessionID, runID)
    const binding = admission.taskBinding
    if (!binding || !terminal(admission.run.status)) return
    return yield* tasks.patch(
      {
        sessionID,
        id: binding.parentTaskID,
        status: parentTaskStatus(admission.run),
        outputDigest: parentTaskDigest(admission.run),
        expectedRevision: binding.parentTaskRevision,
        expect: ["in_progress"],
      },
      admission.run.status === "recovery_required"
        ? undefined
        : { settle: { source: binding.source, revision: binding.parentTaskRevision } },
    )
  })

  const resultText = Effect.fnUntraced(function* (
    sessionID: Session.ID,
    runID: WorkflowAsset.WorkflowRunID,
    workflow: Composition.WorkflowInfo,
  ) {
    const admission = yield* runs.admission(sessionID, runID)
    const run = admission.run
    const binding = admission.taskBinding
    const parentTask = binding
      ? (yield* tasks.get(sessionID)).find((task) => task.id === binding.parentTaskID)
      : undefined
    const taskSettlement =
      binding &&
      parentTask?.revision === binding.parentTaskRevision + 1 &&
      parentTask.status === parentTaskStatus(run) &&
      parentTask.outputDigest === parentTaskDigest(run)
        ? "settled"
        : "conflict"
    const steps = latestSteps(yield* runs.getSteps(runID))
    const lines = yield* Effect.forEach(workflow.steps, (definition) =>
      Effect.gen(function* () {
        const step = steps.find((candidate) => candidate.stepId === definition.id)
        const result = step ? yield* inputResult(sessionID, step, false) : undefined
        const complete = result?.status === "completed"
        const text = complete ? assistantText(result.assistant) : (step?.errorCategory ?? "no_output")
        const detail = yield* scanner.scan(text)
        const identity = yield* scanner.scan(definition.id)
        const truncated = Array.from(detail.stripped).length > MAX_STEP_OUTPUT
        return {
          stepID: identity.stripped,
          stepRunID: step?.id,
          revision: step?.revision,
          attempt: step?.attempt,
          status: step?.status ?? "missing",
          errorCategory: step?.errorCategory,
          outputDigest: step?.outputDigest ?? (complete ? CompositionDigest.computeDigest(text) : undefined),
          source: result?.source,
          detail: boundText(detail.stripped, MAX_STEP_OUTPUT),
          quality: complete ? (truncated ? "truncated" : "complete") : "unavailable",
          redacted: detail.hits.length > 0 || identity.hits.length > 0,
        }
      }),
    )
    // Bound the final envelope, including escaping, without cutting JSON or producer identities.
    const encode = (value: object) => JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e")
    const fit = (line: (typeof lines)[number], limit: number) => {
      if (Array.from(encode(line)).length <= limit) return line
      const truncated = { ...line, quality: line.quality === "complete" ? "truncated" : line.quality }
      if (Array.from(encode({ ...truncated, detail: "" })).length > limit) return undefined
      const points = Array.from(line.detail)
      let lower = 0
      let upper = points.length
      while (lower < upper) {
        const middle = Math.ceil((lower + upper) / 2)
        if (Array.from(encode({ ...truncated, detail: points.slice(0, middle).join("") })).length <= limit) {
          lower = middle
          continue
        }
        upper = middle - 1
      }
      return { ...truncated, detail: points.slice(0, lower).join("") }
    }
    const included = lines.slice()
    const render = () =>
      encode({
        runID,
        runRevision: run.revision,
        status: run.status,
        errorCategory: run.errorCategory,
        ...(binding
          ? {
              parentTaskID: binding.parentTaskID,
              parentTaskRevision: binding.parentTaskRevision,
              source: binding.source,
              taskSettlement,
            }
          : {}),
        quality:
          included.length < lines.length || included.some((line) => line.quality === "truncated")
            ? "truncated"
            : included.some((line) => line.quality === "unavailable")
              ? "unavailable"
              : "complete",
        omittedSteps: lines.length - included.length,
        steps: included,
      })
    const limit = MAX_HANDOFF - "<workflow_result>\n\n</workflow_result>".length
    let payload = render()
    while (Array.from(payload).length > limit) {
      if (included.length === 0)
        return yield* new InvalidError({ sessionID, reason: "workflow_result_identity_exceeds_limit" })
      const index = included.findLastIndex((line) => line.detail.length > 0)
      if (index < 0) {
        included.pop()
        payload = render()
        continue
      }
      const line = included[index]
      included[index] = fit(line, Array.from(encode(line)).length - (Array.from(payload).length - limit)) ?? {
        ...line,
        detail: "",
        quality: line.quality === "complete" ? "truncated" : line.quality,
      }
      payload = render()
    }
    return `<workflow_result>\n${payload}\n</workflow_result>`
  })

  const handoff = Effect.fnUntraced(function* (
    sessionID: Session.ID,
    runID: WorkflowAsset.WorkflowRunID,
    workflow: Composition.WorkflowInfo,
    wakeRoot = true,
  ) {
    const admission = yield* runs.admission(sessionID, runID)
    if (!terminal(admission.run.status) || (yield* jobs.isDeletingSession(sessionID))) return false
    if (admission.taskBinding) {
      yield* settleParentTask(sessionID, runID)
      return false
    }
    if (!ProductModePolicy.isCustomModeEnabled() || !bus.retainsEvents) return false
    const notification = yield* SessionNotification.inspect(database.db, bus, store, {
      sessionID,
      inboxID: handoffIDFor(runID),
    })
    if (!notification.admit) {
      const canWake = notification.wake && !(yield* jobs.isDeletingSession(sessionID))
      if (wakeRoot && canWake) yield* sessionExecution.wake(sessionID)
      return canWake
    }
    const text = yield* resultText(sessionID, runID, workflow)
    if (yield* jobs.isDeletingSession(sessionID)) return false
    yield* sessions
      .synthetic({
        sessionID,
        id: handoffIDFor(runID),
        text,
        metadata: { source: "workflow_result", workflowRunID: runID },
        resume: false,
      })
      .pipe(Effect.mapError(() => new InvalidError({ sessionID, reason: "workflow_root_handoff_failed" })))
    const notified = yield* SessionNotification.inspect(database.db, bus, store, {
      sessionID,
      inboxID: handoffIDFor(runID),
    })
    const canWake = notified.wake && !(yield* jobs.isDeletingSession(sessionID))
    if (wakeRoot && canWake) yield* sessionExecution.wake(sessionID)
    return canWake
  })

  const finishCancel = Effect.fnUntraced(function* (sessionID: Session.ID, runID: WorkflowAsset.WorkflowRunID) {
    yield* cleanup(sessionID, runID)
    return yield* locks.withLock(sessionID)(
      Effect.gen(function* () {
        const run = yield* runs.get(runID)
        if (run.status !== "cancelling") return run
        const cancelled = yield* runs.finalizeCancelRun({
          runID,
          expectedRevision: run.revision,
          errorCategory: run.errorCategory,
        })
        yield* Effect.forEach(latestSteps(yield* runs.getSteps(runID)), (step) => patchTask(sessionID, step), {
          discard: true,
        })
        return cancelled
      }),
    )
  })

  const fail = Effect.fnUntraced(function* (
    sessionID: Session.ID,
    runID: WorkflowAsset.WorkflowRunID,
    category: WorkflowAsset.ErrorCategory,
  ) {
    yield* cleanup(sessionID, runID)
    return yield* locks.withLock(sessionID)(
      Effect.gen(function* () {
        const run = yield* runs.get(runID)
        if (terminal(run.status) || run.status === "cancelling") return run
        const failed = yield* runs.failRun({ runID, expectedRevision: run.revision, errorCategory: category })
        yield* Effect.forEach(latestSteps(yield* runs.getSteps(runID)), (step) => patchTask(sessionID, step), {
          discard: true,
        })
        return failed
      }),
    )
  })

  const promptText = Effect.fnUntraced(function* (
    sessionID: Session.ID,
    runID: WorkflowAsset.WorkflowRunID,
    definition: WorkflowAsset.StepDef,
    workflow: Composition.WorkflowInfo,
  ) {
    const predecessors = WorkflowRun.predecessorsFor(workflow.steps).get(definition.id) ?? []
    const previous = latestSteps(yield* runs.getSteps(runID)).filter(
      (step) => step.status === "completed" && predecessors.includes(step.stepId),
    )
    const outputs = yield* Effect.forEach(previous, (step) =>
      Effect.gen(function* () {
        const result = yield* inputResult(sessionID, step, false)
        const text =
          result.status === "completed" ? assistantText(result.assistant) : (step.outputDigest ?? "unavailable")
        return { stepID: step.stepId, output: boundText((yield* scanner.scan(text)).stripped, MAX_STEP_OUTPUT) }
      }),
    )
    const text = JSON.stringify({ step: definition.name, input: definition.input ?? {}, previous: outputs })
    if (!definition.branches) return text
    return `${text}\nReply with one JSON object and no other text: {"branch": "one of the declared keys", "summary": "optional summary"}.\nDeclared branch keys: ${JSON.stringify(Object.keys(definition.branches))}`
  })

  const executeStep = Effect.fnUntraced(function* (
    sessionID: Session.ID,
    runID: WorkflowAsset.WorkflowRunID,
    workflow: Composition.WorkflowInfo,
    stepID: WorkflowAsset.StepRunID,
  ) {
    const prepared = yield* locks.withLock(sessionID)(
      Effect.gen(function* () {
        const run = yield* runs.get(runID)
        const current = yield* ownedStep(runID, stepID)
        if (terminal(run.status) || run.status === "cancelling" || current.status !== "ready") return undefined
        const definition = workflow.steps.find((step) => step.id === current.stepId)
        if (!definition) return yield* new InvalidError({ sessionID, reason: "workflow_step_definition_missing" })
        const owning = yield* frozenRun(sessionID, runID)
        const parent = owning.session
        const selected = yield* compositions.selectAgent(sessionID, definition.agent, owning.snapshot)
        const adopted = yield* childForStep(sessionID, current)
        const executor = parent.controller
          ? adopted?.child.controller?.kind === "child"
            ? adopted.child.controller.executor
            : yield* Session.resolveExecutor(parent, selected.info).pipe(
                Effect.provide(locations.get(parent.location)),
                Effect.provideService(SessionComposition.Service, compositions),
                Effect.mapError(() => new InvalidError({ sessionID, reason: "workflow_executor_unavailable" })),
              )
          : undefined
        const step = yield* runs.dispatchStep({
          stepRunID: current.id,
          expectedRevision: current.revision,
          taskID: `tsk_${current.id}`,
          childSessionID: childIDFor(current.id),
        })
        if (!step.childSessionId || !step.taskId)
          return yield* new InvalidError({ sessionID, reason: "workflow_dispatch_identity_missing" })
        const child = yield* sessions.create({
          id: Session.ID.make(step.childSessionId),
          parentID: sessionID,
          agent: selected.info.id,
          title: definition.name,
          executor,
          model: executor?.model,
          source: executor
            ? new SessionSchema.WorkflowControllerSource({
                kind: "workflow",
                runID,
                stepRunID: step.id,
                inputID: inputIDFor(step.id),
              })
            : undefined,
          frozenSnapshot: owning.taskBinding ? owning.snapshot : undefined,
          metadata: {
            workflowRootSessionID: sessionID,
            workflowRunID: runID,
            workflowStepRunID: step.id,
            workflowStepID: step.stepId,
            workflowInputID: inputIDFor(step.id),
          },
        })
        if (child.parentID !== sessionID || child.agent !== selected.info.id)
          return yield* new InvalidError({ sessionID, reason: "workflow_child_identity_mismatch" })
        yield* childForStep(sessionID, step)
        if (!(yield* tasks.get(sessionID)).some((task) => task.id === step.taskId)) {
          yield* tasks
            .append(
              {
                sessionID,
                tasks: [
                  {
                    id: step.taskId,
                    content: definition.name,
                    status: "in_progress",
                    priority: "medium",
                    agentID: selected.info.id,
                  },
                ],
              },
              owning.taskBinding ? { claim: owning.taskBinding.source } : undefined,
            )
            .pipe(Effect.mapError(() => new InvalidError({ sessionID, reason: "workflow_task_projection_failed" })))
        }
        yield* sessions
          .prompt({
            sessionID: child.id,
            id: inputIDFor(step.id),
            text: yield* promptText(sessionID, runID, definition, workflow),
            resume: false,
            metadata: { source: "workflow_step", workflowRunID: runID, workflowStepRunID: step.id },
          })
          .pipe(Effect.mapError(() => new InvalidError({ sessionID, reason: "workflow_step_admission_failed" })))
        yield* ProductModePolicy.assertRuntimeSupported(parent.mode)
        const delivered = yield* inputResult(sessionID, step)
        if (delivered.status !== "pending") {
          if (delivered.status === "completed" || delivered.status === "failed" || delivered.status === "interrupted") {
            const observed = yield* runs.startStep({ stepRunID: step.id, expectedRevision: step.revision })
            yield* settleKnown(sessionID, observed, definition, delivered)
            return undefined
          }
          // A public move/resume may already have delivered this child's input.
          yield* runs.requireRecovery({
            runID,
            expectedRevision: (yield* runs.get(runID)).revision,
            unsafeStepIDs: [step.id],
          })
          return undefined
        }
        const running = yield* runs.startStep({ stepRunID: step.id, expectedRevision: step.revision })
        return { child, step: running, definition }
      }),
    )
    if (!prepared) return "not_dispatched"
    // Wake drains admitted inputs only. Force-resume could run an already completed input again after a public resume race.
    const completed = yield* sessionExecution
      .wake(prepared.child.id)
      .pipe(Effect.andThen(sessionExecution.awaitIdle(prepared.child.id)), Effect.exit)
    yield* locks.withLock(sessionID)(
      Effect.gen(function* () {
        const current = yield* ownedStep(runID, stepID)
        if (current.status !== "running") return
        const result = yield* inputResult(sessionID, current)
        if (yield* settleKnown(sessionID, current, prepared.definition, result)) return
        // A successful drain is not evidence that this input completed.
      }),
    )
    return Exit.isSuccess(completed) ? "settled" : "execution_failed"
  })

  const startStepJob = Effect.fnUntraced(function* (
    sessionID: Session.ID,
    runID: WorkflowAsset.WorkflowRunID,
    workflow: Composition.WorkflowInfo,
    step: WorkflowAsset.StepRunInfo,
  ) {
    const definition = workflow.steps.find((candidate) => candidate.id === step.stepId)
    const execution = executeStep(sessionID, runID, workflow, step.id)
    const bounded =
      definition?.timeoutSeconds === undefined
        ? execution
        : execution.pipe(
            Effect.timeoutOrElse({ duration: definition.timeoutSeconds * 1000, orElse: () => new StepTimeout({}) }),
          )
    const started = yield* jobs.start({
      id: stepJobID(step.id),
      type: "workflow_step",
      metadata: {
        sessionID,
        runID,
        stepRunID: step.id,
        childSessionID: childIDFor(step.id),
      },
      run: bounded.pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            if (Cause.hasInterruptsOnly(cause)) return yield* Effect.failCause(cause)
            const error = Cause.findErrorOption(cause)
            const category: WorkflowAsset.ErrorCategory =
              Option.isSome(error) && error.value instanceof StepTimeout
                ? "step_timeout"
                : Option.isSome(error) && error.value instanceof ProductModePolicy.UnsupportedProductModeError
                  ? "custom_mode_disabled"
                  : Option.isSome(error) && error.value instanceof SessionComposition.AgentDelegationForbiddenError
                    ? "agent_not_allowed"
                    : "executor_unavailable"
            const current = yield* ownedStep(runID, step.id)
            if (current.status === "running" && category !== "step_timeout") return "execution_unknown"
            if (current.status === "ready" || current.status === "dispatching" || current.status === "running") {
              yield* cleanupChild(sessionID, current)
              yield* locks.withLock(sessionID)(
                Effect.gen(function* () {
                  const latest = yield* ownedStep(runID, current.id)
                  if (latest.status !== "ready" && latest.status !== "dispatching" && latest.status !== "running")
                    return
                  const dispatched =
                    latest.status === "ready"
                      ? yield* runs.dispatchStep({ stepRunID: latest.id, expectedRevision: latest.revision })
                      : latest
                  const started =
                    dispatched.status === "dispatching"
                      ? yield* runs.startStep({ stepRunID: dispatched.id, expectedRevision: dispatched.revision })
                      : dispatched
                  const failed = yield* runs.settleStep({
                    stepRunID: started.id,
                    expectedRevision: started.revision,
                    status: "failed",
                    errorCategory: category,
                  })
                  yield* patchTask(sessionID, failed)
                }),
              )
            }
            return category
          }),
        ),
      ),
    })
    if (started.status === "cancelled") {
      yield* locks.withLock(sessionID)(
        Effect.gen(function* () {
          const run = yield* runs.get(runID)
          const current = yield* ownedStep(runID, step.id)
          if (
            (run.status !== "pending" && run.status !== "running") ||
            !["ready", "dispatching", "running"].includes(current.status)
          )
            return
          const cancelled = yield* runs.cancelStep({
            runID,
            stepRunID: current.id,
            expectedRunRevision: run.revision,
            expectedRevision: current.revision,
          })
          yield* patchTask(sessionID, cancelled)
        }),
      )
    }
  })

  const reconcile = Effect.fnUntraced(function* (
    sessionID: Session.ID,
    runID: WorkflowAsset.WorkflowRunID,
    workflow: Composition.WorkflowInfo,
  ) {
    // Only a new process-local owner reaches this boundary. Existing Jobs join their running work.
    const steps = latestSteps(yield* runs.getSteps(runID))
    for (const step of steps.filter(
      (candidate) => candidate.status === "running" || candidate.status === "dispatching",
    )) {
      const definition = workflow.steps.find((candidate) => candidate.id === step.stepId)
      if (!definition) return yield* new InvalidError({ sessionID, reason: "workflow_step_definition_missing" })
      const result = yield* inputResult(sessionID, step)
      if (result.status === "completed" || result.status === "failed" || result.status === "interrupted") {
        const current =
          step.status === "dispatching"
            ? yield* runs.startStep({ stepRunID: step.id, expectedRevision: step.revision })
            : step
        yield* settleKnown(sessionID, current, definition, result)
        continue
      }
      if (step.status === "dispatching" && result.status === "pending") {
        const child = yield* childForStep(sessionID, step)
        if (child) {
          const reset = yield* runs
            .recoverDispatch({
              runID,
              stepRunID: step.id,
              childSessionID: child.child.id,
              inputID: child.inputID,
              expectedRunRevision: (yield* runs.get(runID)).revision,
              expectedStepRevision: step.revision,
            })
            .pipe(Effect.exit)
          if (Exit.isSuccess(reset)) continue
        }
      }
      yield* unknown(sessionID, runID, [step.id])
      return
    }
  })

  const drain = Effect.fnUntraced(function* (
    sessionID: Session.ID,
    runID: WorkflowAsset.WorkflowRunID,
    snapshot: Composition.SnapshotV2,
    workflow: Composition.WorkflowInfo,
  ) {
    yield* locks.withLock(sessionID)(reconcile(sessionID, runID, workflow))
    while (true) {
      const run = yield* runs.get(runID)
      if (terminal(run.status)) {
        if (run.status === "recovery_required") yield* cleanup(sessionID, runID)
        break
      }
      if (run.status === "cancelling") {
        yield* finishCancel(sessionID, runID)
        break
      }
      if (
        Exit.isFailure(
          yield* ProductModePolicy.assertRuntimeSupported((yield* sessions.get(sessionID)).mode).pipe(Effect.exit),
        )
      ) {
        yield* runs.cancelRun({ runID, expectedRevision: run.revision, errorCategory: "custom_mode_disabled" })
        yield* finishCancel(sessionID, runID)
        break
      }
      const latest = latestSteps(yield* runs.getSteps(runID))
      if (latest.some((step) => step.status === "execution_unknown")) {
        yield* unknown(sessionID, runID)
        break
      }
      const cancelled = latest.find((step) => step.status === "cancelled")
      if (cancelled) {
        yield* fail(sessionID, runID, "step_cancelled")
        break
      }
      const failed = latest.filter((step) => step.status === "failed")
      for (const step of failed) {
        const definition = workflow.steps.find((candidate) => candidate.id === step.stepId)
        const decision = failureDecision(step, definition)
        if (decision.type === "continue") continue
        if (decision.type === "retry") {
          yield* runs.retryStep({ stepRunID: step.id, expectedRevision: step.revision })
          continue
        }
        if (decision.type === "abort") yield* fail(sessionID, runID, decision.category)
        break
      }
      if (terminal((yield* runs.get(runID)).status)) break
      const ready = yield* locks.withLock(sessionID)(runs.findReadySteps(runID, workflow.steps))
      if (ready.length === 0) {
        yield* runs.completeRun({
          runID,
          expectedRevision: (yield* runs.get(runID)).revision,
          partial: failed.length > 0,
        })
        break
      }
      const batch = ready.slice(0, Math.min(snapshot.data.maxConcurrency, WorkflowAsset.MAX_PARALLEL))
      yield* Effect.forEach(batch, (step) => startStepJob(sessionID, runID, workflow, step), { discard: true })
      const waited = yield* Effect.forEach(
        batch,
        (step) =>
          Effect.gen(function* () {
            const finished = yield* jobs.wait({ id: stepJobID(step.id) })
            const current = yield* finished.info?.status === "cancelled"
              ? locks.withLock(sessionID)(
                  Effect.gen(function* () {
                    const observed = yield* ownedStep(runID, step.id)
                    if (!activeStep(observed)) return observed
                    const run = yield* runs.get(runID)
                    if (run.status !== "running" && run.status !== "pending") return observed
                    return yield* runs.cancelStep({
                      runID,
                      stepRunID: observed.id,
                      expectedRevision: observed.revision,
                      expectedRunRevision: run.revision,
                    })
                  }),
                )
              : ownedStep(runID, step.id)
            const definition = workflow.steps.find((candidate) => candidate.id === step.stepId)
            if (current.status === "running") return yield* new BatchAbort({ category: "execution_unknown" })
            const decision = failureDecision(current, definition)
            if (decision.type === "recover") return yield* new BatchAbort({ category: "execution_unknown" })
            if (decision.type === "abort") return yield* new BatchAbort({ category: decision.category })
          }),
        { concurrency: batch.length, discard: true },
      ).pipe(Effect.exit)
      if (Exit.isFailure(waited)) {
        const failure = Cause.findErrorOption(waited.cause)
        const category =
          Option.isSome(failure) && failure.value instanceof BatchAbort ? failure.value.category : "unknown_error"
        if (category === "execution_unknown") yield* unknown(sessionID, runID)
        if (category !== "execution_unknown") yield* fail(sessionID, runID, category)
        break
      }
    }
    yield* handoff(sessionID, runID, workflow)
    return (yield* runs.get(runID)).status
  })

  const wake = Effect.fnUntraced(function* (
    sessionID: Session.ID,
    run: WorkflowAsset.WorkflowRunInfo,
    snapshot: Composition.SnapshotV2,
    workflow: Composition.WorkflowInfo,
  ) {
    yield* requireAvailable(sessionID)
    if (terminal(run.status) || (yield* jobs.get(runJobID(run.id)))?.status === "running") return
    const started = yield* jobs.start({
      id: runJobID(run.id),
      type: "workflow",
      title: workflow.name,
      metadata: { sessionID, runID: run.id },
      run: drain(sessionID, run.id, snapshot, workflow).pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            if (Cause.hasInterruptsOnly(cause)) return yield* Effect.failCause(cause)
            const current = yield* runs.get(run.id)
            if (terminal(current.status))
              return yield* new InvalidError({ sessionID, reason: "workflow_root_handoff_failed" })
            if (current.status === "cancelling") {
              yield* finishCancel(sessionID, run.id)
              return "cancelled"
            }
            if (!terminal(current.status)) {
              if ((yield* runs.getSteps(run.id)).some((step) => step.status === "running"))
                yield* unknown(sessionID, run.id)
              if (!terminal((yield* runs.get(run.id)).status)) yield* fail(sessionID, run.id, "unknown_error")
            }
            return (yield* runs.get(run.id)).status
          }),
        ),
      ),
    })
    if (started.status === "cancelled")
      return yield* new ConflictError({ sessionID, reason: "workflow_session_deleting" })
  })

  const task: Interface["task"] = Effect.fn("WorkflowExecution.task")(function* (input) {
    const requestKey = CompositionDigest.computeDigest({
      workflowTask: { sessionID: input.sessionID, source: input.source },
    })
    if ((input.composition === undefined) === (input.retry === undefined))
      return yield* new InvalidError({
        sessionID: input.sessionID,
        reason: "workflow_task_requires_selection_or_retry",
      })
    if (!bus.retainsEvents)
      return yield* new InvalidError({ sessionID: input.sessionID, reason: "workflow_requires_retained_events" })
    const admitted = yield* locks.withLock(input.sessionID)(
      Effect.gen(function* () {
        yield* requireAvailable(input.sessionID)
        const parent = yield* sessions.get(input.sessionID)
        yield* ProductModePolicy.assertRuntimeSupported(parent.mode)
        if (
          parent.mode !== "work" ||
          parent.parentID !== undefined ||
          parent.agent !== "meta" ||
          input.agent !== "meta" ||
          parent.controller?.kind !== "root"
        )
          return yield* new InvalidError({ sessionID: parent.id, reason: "workflow_task_requires_selected_work_meta" })
        yield* metas
          .assertOwner(parent)
          .pipe(
            Effect.mapError(
              () => new InvalidError({ sessionID: parent.id, reason: "workflow_task_meta_owner_invalid" }),
            ),
          )
        const previous = yield* runs.byRequest(parent.id, requestKey)
        if (previous) {
          if (
            !previous.snapshot ||
            !previous.taskBinding ||
            (input.composition !== undefined &&
              previous.snapshot.digest !== CompositionDigest.computeCompositionDigest(input.composition)) ||
            CompositionDigest.computeDigest(previous.taskBinding.source) !==
              CompositionDigest.computeDigest(input.source) ||
            (input.parentTaskID !== undefined && input.parentTaskID !== previous.taskBinding.parentTaskID)
          )
            return yield* new WorkflowRun.RequestConflictError({ requestID: requestKey })
          const fingerprint = input.retry
            ? CompositionDigest.computeDigest({
                runID: input.retry.runID,
                stepRunID: input.retry.stepRunID,
                expectedRunRevision: input.retry.expectedRunRevision,
                expectedStepRevision: input.retry.expectedStepRevision,
                snapshotDigest: previous.snapshot.digest,
                workflowRevision: previous.run.workflowRevision,
                taskBinding: previous.taskBinding,
              })
            : input.composition
              ? CompositionDigest.computeDigest({
                  snapshotDigest: CompositionDigest.computeCompositionDigest(input.composition),
                  workflowRevision: previous.run.workflowRevision,
                  taskBinding: previous.taskBinding,
                })
              : undefined
          if (previous.requestDigest !== fingerprint)
            return yield* new WorkflowRun.RequestConflictError({ requestID: requestKey })
          if (input.expectedPlanDigest !== undefined && input.expectedPlanDigest !== previous.snapshot.digest)
            return yield* new ConflictError({ sessionID: parent.id, reason: "workflow_snapshot_conflict" })
          const selected = yield* frozenRun(parent.id, previous.run.id)
          yield* wake(parent.id, previous.run, selected.snapshot, selected.workflow)
          return {
            run: previous.run,
            selected,
            parentTaskID: previous.taskBinding.parentTaskID,
            parentTaskRevision: previous.taskBinding.parentTaskRevision,
          }
        }
        const selected = input.retry
          ? yield* frozenRun(parent.id, input.retry.runID)
          : yield* Effect.gen(function* () {
              const composition = input.composition
              if (!composition)
                return yield* new InvalidError({ sessionID: parent.id, reason: "workflow_definition_required" })
              const snapshot = yield* CompositionResolver.Service.use((resolver) =>
                resolver.freeze(new Composition.FreezeInput({ input: composition })),
              ).pipe(Effect.provide(locations.get(parent.location)))
              const workflow = snapshot.data.workflow
              if (!workflow)
                return yield* new InvalidError({ sessionID: parent.id, reason: "workflow_definition_required" })
              return { session: parent, snapshot, workflow }
            })
        const snapshot = selected.snapshot
        const workflow = selected.workflow
        if (input.expectedPlanDigest !== undefined && input.expectedPlanDigest !== snapshot.digest)
          return yield* new ConflictError({ sessionID: parent.id, reason: "workflow_snapshot_conflict" })
        const linked =
          input.parentTaskID === undefined
            ? undefined
            : (yield* tasks.get(parent.id)).find((task) => task.id === input.parentTaskID)
        if (input.parentTaskID !== undefined && !linked)
          return yield* new InvalidError({
            sessionID: parent.id,
            reason: `Parent task ${input.parentTaskID} does not belong to this session`,
          })
        if (linked?.status === "scheduled")
          return yield* new InvalidError({
            sessionID: parent.id,
            reason: "A scheduled parent task cannot be delegated while its schedule owns execution",
          })
        const parentTask =
          linked === undefined
            ? (yield* tasks.append(
                {
                  sessionID: parent.id,
                  tasks: [{ content: input.description, status: "in_progress", priority: "medium" }],
                },
                { claim: input.source },
              )).at(-1)
            : yield* tasks.patch(
                {
                  sessionID: parent.id,
                  id: linked.id,
                  status: "in_progress",
                  expectedRevision: linked.revision,
                  expect: ["pending", "in_progress", "completed", "failed", "cancelled"],
                },
                { claim: input.source },
              )
        if (!parentTask)
          return yield* new ConflictError({
            sessionID: parent.id,
            reason: "Parent task is no longer available for execution",
          })
        const binding = new WorkflowRun.TaskBinding({
          parentTaskID: parentTask.id,
          parentTaskRevision: parentTask.revision,
          source: input.source,
        })
        const run = yield* (
          input.retry
            ? runs.retryRun({
                ...input.retry,
                sessionID: parent.id,
                requestID: requestKey,
                stepsDef: workflow.steps,
                taskBinding: binding,
              })
            : runs.getOrCreate({
                sessionID: parent.id,
                workflow,
                snapshotDigest: snapshot.digest,
                requestID: requestKey,
                frozenSnapshot: snapshot,
                taskBinding: binding,
              })
        ).pipe(
          Effect.onExit((exit) => {
            if (Exit.isSuccess(exit)) return Effect.void
            const error = Cause.findErrorOption(exit.cause)
            return tasks
              .patch(
                {
                  sessionID: parent.id,
                  id: parentTask.id,
                  status: Cause.hasInterruptsOnly(exit.cause) ? "cancelled" : "failed",
                  outputDigest: Option.isSome(error) ? error.value.message : "workflow_run_admission_failed",
                  expectedRevision: parentTask.revision,
                  expect: ["pending", "in_progress"],
                },
                { settle: { source: input.source, revision: parentTask.revision } },
              )
              .pipe(Effect.orDie, Effect.asVoid)
          }),
        )
        yield* wake(parent.id, run, snapshot, workflow)
        return {
          run,
          selected: { session: parent, snapshot, workflow },
          parentTaskID: parentTask.id,
          parentTaskRevision: parentTask.revision,
        }
      }),
    )
    // Step Jobs acquire the same Session key. The Task waits only after admission releases it.
    yield* (
      input.onAdmitted
        ? input
            .onAdmitted({
              runID: admitted.run.id,
              parentTaskID: admitted.parentTaskID,
              parentTaskRevision: admitted.parentTaskRevision,
            })
            .pipe(Effect.andThen(wait(admitted.run.id)))
        : wait(admitted.run.id)
    ).pipe(
      Effect.onInterrupt(() =>
        Effect.gen(function* () {
          const current = yield* runs.get(admitted.run.id)
          yield* cancelRun({ sessionID: input.sessionID, runID: current.id, expectedRunRevision: current.revision })
        }).pipe(Effect.orDie),
      ),
    )
    const run = yield* runs.get(admitted.run.id)
    if (!terminal(run.status))
      return yield* new ConflictError({ sessionID: input.sessionID, reason: "workflow_task_not_terminal" })
    const message = yield* sessions.message({
      sessionID: input.sessionID,
      messageID: SessionMessage.ID.make(input.source.messageID),
    })
    const receipt =
      message?.type === "assistant"
        ? message.content.find(
            (part): part is SessionMessage.AssistantTool => part.type === "tool" && part.id === input.source.id,
          )
        : undefined
    if (receipt?.state.status === "completed")
      return {
        run,
        parentTaskID: admitted.parentTaskID,
        parentTaskRevision: admitted.parentTaskRevision,
        text: receipt.state.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
      }
    yield* settleParentTask(input.sessionID, run.id)
    return {
      run,
      parentTaskID: admitted.parentTaskID,
      parentTaskRevision: admitted.parentTaskRevision,
      text: yield* resultText(input.sessionID, run.id, admitted.selected.workflow),
    }
  })

  const run: Interface["run"] = Effect.fn("WorkflowExecution.run")(function* (input) {
    yield* requestID(input.sessionID, input.requestID)
    if (!bus.retainsEvents)
      return yield* new InvalidError({ sessionID: input.sessionID, reason: "workflow_requires_retained_events" })
    return yield* locks.withLock(input.sessionID)(
      Effect.gen(function* () {
        yield* requireAvailable(input.sessionID)
        const selected = yield* root(input.sessionID)
        if (selected.snapshot.digest !== input.expectedSnapshotDigest)
          return yield* new ConflictError({ sessionID: input.sessionID, reason: "workflow_snapshot_conflict" })
        const admitted = yield* runs.getOrCreate({
          sessionID: input.sessionID,
          workflow: selected.workflow,
          snapshotDigest: selected.snapshot.digest,
          requestID: input.requestID,
        })
        const accepted = yield* status(admitted.id)
        yield* wake(input.sessionID, admitted, selected.snapshot, selected.workflow)
        return accepted
      }),
    )
  })

  const cancelRun: Interface["cancelRun"] = Effect.fn("WorkflowExecution.cancelRun")(function* (input) {
    yield* ownedRun(input.sessionID, input.runID)
    const selected = yield* frozenRun(input.sessionID, input.runID)
    // Persist the intent before stopping Jobs. Waiting for the runner's mutex here would block cancellation behind provider work.
    const cancelled = yield* runs.cancelRun({ runID: input.runID, expectedRevision: input.expectedRunRevision })
    if (!terminal(cancelled.status)) {
      yield* jobs.cancel(runJobID(input.runID))
      yield* finishCancel(input.sessionID, input.runID)
    }
    yield* handoff(input.sessionID, input.runID, selected.workflow)
    return yield* status(input.runID)
  })

  const cancelStep: Interface["cancelStep"] = Effect.fn("WorkflowExecution.cancelStep")(function* (input) {
    yield* ownedRun(input.sessionID, input.runID)
    yield* frozenRun(input.sessionID, input.runID)
    const cancelled = yield* runs.cancelStep({
      sessionID: input.sessionID,
      runID: input.runID,
      stepRunID: input.stepRunID,
      expectedRunRevision: input.expectedRunRevision,
      expectedRevision: input.expectedStepRevision,
    })
    yield* jobs.cancel(stepJobID(cancelled.id))
    yield* cleanupChild(input.sessionID, cancelled)
    yield* patchTask(input.sessionID, cancelled)
    return yield* status(input.runID)
  })

  const retryStep: Interface["retryStep"] = Effect.fn("WorkflowExecution.retryStep")(function* (input) {
    yield* requestID(input.sessionID, input.requestID)
    return yield* locks.withLock(input.sessionID)(
      Effect.gen(function* () {
        const source = yield* ownedRun(input.sessionID, input.runID)
        yield* requireAvailable(input.sessionID)
        if (!bus.retainsEvents)
          return yield* new InvalidError({ sessionID: input.sessionID, reason: "workflow_requires_retained_events" })
        const selected = yield* frozenRun(input.sessionID, input.runID)
        if (
          source.snapshotDigest !== selected.snapshot.digest ||
          source.workflowRevision !== selected.workflow.revision
        )
          return yield* new ConflictError({ sessionID: input.sessionID, reason: "workflow_snapshot_conflict" })
        const retried = yield* runs.retryRun({ ...input, stepsDef: selected.workflow.steps })
        const accepted = yield* status(retried.id)
        yield* wake(input.sessionID, retried, selected.snapshot, selected.workflow)
        return accepted
      }),
    )
  })

  const resume: Interface["resume"] = Effect.fn("WorkflowExecution.resume")(function* (input) {
    if (!bus.retainsEvents)
      return yield* new InvalidError({ sessionID: input.sessionID, reason: "workflow_requires_retained_events" })
    return yield* locks.withLock(input.sessionID)(
      Effect.gen(function* () {
        yield* requireAvailable(input.sessionID)
        const current = input.runID
          ? yield* ownedRun(input.sessionID, input.runID)
          : yield* runs.getBySession(input.sessionID)
        if (!current) return new WorkflowAsset.WorkflowStatusResponse({ steps: [] })
        const selected = yield* frozenRun(input.sessionID, current.id)
        if (
          current.snapshotDigest !== selected.snapshot.digest ||
          current.workflowRevision !== selected.workflow.revision
        )
          return yield* new ConflictError({ sessionID: input.sessionID, reason: "workflow_snapshot_conflict" })
        if (terminal(current.status)) yield* handoff(input.sessionID, current.id, selected.workflow)
        yield* wake(input.sessionID, current, selected.snapshot, selected.workflow)
        return yield* status(current.id)
      }),
    )
  })

  const wait: Interface["wait"] = Effect.fn("WorkflowExecution.wait")(function* (runID) {
    const completed = yield* jobs.wait({ id: runJobID(runID) })
    const current = yield* status(runID)
    if (
      completed.info?.status === "error" &&
      current.run &&
      !(yield* runs.admission(Session.ID.make(current.run.sessionID), runID)).taskBinding
    ) {
      const sessionID = Session.ID.make(current.run.sessionID)
      const receipt = yield* SessionInputResult.read(database.db, { sessionID, inputID: handoffIDFor(runID) }).pipe(
        Effect.mapError(() => new InvalidError({ sessionID, reason: "workflow_root_handoff_failed" })),
      )
      if (receipt.status === "missing")
        return yield* new InvalidError({ sessionID, reason: "workflow_root_handoff_failed" })
    }
    return current
  })

  const reconcilePending: Interface["reconcilePending"] = Effect.gen(function* () {
    if (!bus.retainsEvents) return []
    const parents = new Set<Session.ID>()
    yield* Effect.forEach(
      yield* runs.listForRecovery,
      (run) =>
        Effect.gen(function* () {
          if ((yield* jobs.get(runJobID(run.id)))?.status === "running") return
          const sessionID = Session.ID.make(run.sessionID)
          if (yield* jobs.isDeletingSession(sessionID)) return
          const selected = yield* frozenRun(sessionID, run.id)
          if (run.snapshotDigest !== selected.snapshot.digest || run.workflowRevision !== selected.workflow.revision)
            return yield* new ConflictError({ sessionID, reason: "workflow_snapshot_conflict" })
          if (run.status === "cancelling") yield* finishCancel(sessionID, run.id)
          if (!terminal(run.status) && run.status !== "cancelling")
            yield* locks.withLock(sessionID)(reconcile(sessionID, run.id, selected.workflow))
          const current = yield* runs.get(run.id)
          if (!terminal(current.status)) {
            const ready = yield* runs.findReadySteps(run.id, selected.workflow.steps)
            const latest = latestSteps(yield* runs.getSteps(run.id))
            const decisions = latest.map((step) =>
              failureDecision(
                step,
                selected.workflow.steps.find((definition) => definition.id === step.stepId),
              ),
            )
            const blocked = decisions.find((decision) => decision.type === "abort" || decision.type === "recover")
            if (blocked?.type === "abort") yield* fail(sessionID, run.id, blocked.category)
            if (blocked?.type === "recover") yield* unknown(sessionID, run.id)
            if (
              !blocked &&
              !decisions.some((decision) => decision.type === "retry") &&
              ready.length === 0 &&
              latest.every((step) => ["completed", "failed", "skipped"].includes(step.status))
            )
              yield* runs.completeRun({
                runID: run.id,
                expectedRevision: current.revision,
                partial: latest.some((step) => step.status === "failed"),
              })
          }
          yield* wake(sessionID, yield* runs.get(run.id), selected.snapshot, selected.workflow)
          if (
            terminal((yield* runs.get(run.id)).status) &&
            (yield* handoff(sessionID, run.id, selected.workflow, false))
          )
            parents.add(sessionID)
        }).pipe(
          Effect.catchCause((cause) => {
            if (Cause.hasInterrupts(cause)) return Effect.failCause(cause)
            const error = Cause.findErrorOption(cause)
            const tag =
              Option.isSome(error) &&
              typeof error.value === "object" &&
              error.value !== null &&
              "_tag" in error.value &&
              typeof error.value._tag === "string"
                ? error.value._tag
                : "Defect"
            return Effect.logWarning("Workflow recovery was deferred", { runID: run.id, tag })
          }),
        ),
      { discard: true },
    )
    return [...parents]
  }).pipe(Effect.withSpan("WorkflowExecution.reconcilePending"))

  return Service.of({ task, run, cancelRun, cancelStep, retryStep, resume, wait, reconcilePending })
})

export const layer = Layer.effect(Service, make)
const credentialScannerNode = makeGlobalNode({
  service: CredentialScanner.Service,
  layer: CredentialScanner.layer,
  deps: [],
})
export const node: LayerNode.Provider<Service, never, typeof Node.tags.values.global> = makeGlobalNode({
  service: Service,
  layer,
  deps: [
    WorkflowRun.node,
    Session.node,
    SessionExecution.node,
    SessionComposition.node,
    Job.node,
    SessionTask.node,
    Database.node,
    Bus.node,
    SessionStore.node,
    credentialScannerNode,
    LocationServiceMap.node,
    MetaAgentService.node,
  ],
})
