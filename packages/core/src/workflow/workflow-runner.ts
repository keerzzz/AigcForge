export * as WorkflowRunner from "./workflow-runner"

import { Cause, Context, Duration, Effect, Exit, Layer, Option, Schema } from "effect"
import { Composition } from "@aigcfroge/schema/composition"
import { Session as SessionSchema } from "@aigcfroge/schema/session"
import { WorkflowAsset, computeMaxConcurrency } from "@aigcfroge/schema/workflow-asset"
import { computeDigest } from "../composition/digest"
import { KeyedMutex } from "../effect/keyed-mutex"
import { AgentV2 } from "../agent"
import { ProductModePolicy } from "../product-mode-policy"
import { SessionComposition } from "../session/composition"
import { SessionMessage } from "../session/message"
import { SessionTask } from "../session/task"
import { TaskDriver } from "../tool/task-driver"
import { WorkflowRun } from "./workflow-run"
import { CredentialScanner } from "../credential-scanner"

export class WorkflowExecutionError extends Schema.TaggedErrorClass<WorkflowExecutionError>()(
  "WorkflowRunner.WorkflowExecutionError",
  {
    runID: Schema.String,
    reason: Schema.String,
  },
) {
  override get message() {
    return this.reason
  }
}

class BatchAbortError extends Schema.TaggedErrorClass<BatchAbortError>()("WorkflowRunner.BatchAbortError", {
  errorCategory: WorkflowAsset.ErrorCategory,
}) {
  override get message() {
    return this.errorCategory
  }
}

const MAX_HANDOFF_TEXT = 12_000
const MAX_HANDOFF_STEP_TEXT = 2_000

function boundCodePoints(text: string, limit: number): string {
  const points = Array.from(text)
  if (points.length <= limit) return text
  return `${points.slice(0, limit).join("")}\n[truncated]`
}

/**
 * Child output is untrusted text that lands in the root orchestrator as a
 * durable `role: "user"` message. Neutralise the envelope delimiters and collapse
 * line breaks so a child cannot close `</workflow_result>` early, forge extra
 * step lines, or append instructions the root would read as the user's.
 */
function escapeHandoffDetail(text: string): string {
  return text
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll(/[\r\n]+/g, " ⏎ ")
}

function renderRootHandoff(input: {
  run: WorkflowAsset.WorkflowRunInfo
  steps: readonly WorkflowAsset.StepRunInfo[]
  summaries: ReadonlyMap<string, string>
  scan: (text: string) => Effect.Effect<string>
}) {
  // Scan before truncating: a credential straddling the cut would otherwise lose
  // the tail the pattern needs and survive into the durable event as a prefix.
  return Effect.forEach(input.steps, (step) =>
    Effect.map(input.scan(input.summaries.get(step.stepId) ?? step.outputDigest ?? "no_output"), (scanned) => {
      const detail = step.errorCategory ?? boundCodePoints(escapeHandoffDetail(scanned), MAX_HANDOFF_STEP_TEXT)
      return `- ${step.stepId}: ${step.status} (${detail})`
    }),
  ).pipe(
    Effect.map((lines) =>
      boundCodePoints(
        [
          `<workflow_result run_id="${input.run.id}">`,
          `status: ${input.run.status}`,
          ...lines,
          "</workflow_result>",
        ].join("\n"),
        MAX_HANDOFF_TEXT,
      ),
    ),
  )
}

export interface StepPreparation {
  readonly taskId?: string
  readonly childSessionId?: string
  readonly errorCategory?: WorkflowAsset.ErrorCategory
}

export interface StepExecutionResult {
  readonly output?: unknown
  readonly error?: string
  readonly errorCategory?: WorkflowAsset.ErrorCategory
}

export interface StepExecutor {
  readonly prepare?: (input: {
    readonly runID: WorkflowAsset.WorkflowRunID
    readonly stepRun: WorkflowAsset.StepRunInfo
    readonly stepDef: WorkflowAsset.StepDef
    readonly snapshot: Composition.SnapshotV2
    readonly sessionID: SessionSchema.ID
  }) => Effect.Effect<StepPreparation>
  readonly execute: (input: {
    readonly runID: WorkflowAsset.WorkflowRunID
    readonly stepRun: WorkflowAsset.StepRunInfo
    readonly stepDef: WorkflowAsset.StepDef
    readonly snapshot: Composition.SnapshotV2
    readonly sessionID: SessionSchema.ID
    readonly preparation: StepPreparation
  }) => Effect.Effect<StepExecutionResult>
}

export interface Interface {
  readonly admit: (
    sessionID: SessionSchema.ID,
    requestID?: string,
    expectedSnapshotDigest?: string,
  ) => Effect.Effect<
    WorkflowAsset.WorkflowRunInfo | undefined,
    WorkflowExecutionError | WorkflowRun.RequestConflictError
  >
  readonly run: (
    sessionID: SessionSchema.ID,
    executor?: StepExecutor,
  ) => Effect.Effect<WorkflowAsset.WorkflowRunInfo | undefined, WorkflowExecutionError>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/WorkflowRunner") {}

function toExecutionError(sessionID: SessionSchema.ID, error: unknown): WorkflowExecutionError {
  if (error instanceof WorkflowExecutionError) return error
  if (error instanceof WorkflowRun.InvalidBranchOutputError) {
    return new WorkflowExecutionError({ runID: sessionID, reason: "invalid_branch_output" })
  }
  if (error instanceof WorkflowRun.InvalidStateTransitionError) {
    return new WorkflowExecutionError({ runID: sessionID, reason: "invalid_state_transition" })
  }
  if (error instanceof WorkflowRun.StepNotFoundError) {
    return new WorkflowExecutionError({ runID: sessionID, reason: "step_not_found" })
  }
  if (error instanceof WorkflowRun.WorkflowNotFoundError) {
    return new WorkflowExecutionError({ runID: sessionID, reason: "run_not_found" })
  }
  return new WorkflowExecutionError({ runID: sessionID, reason: "workflow_execution_failed" })
}

export function branchTarget(step: WorkflowAsset.StepDef, output: unknown): string | undefined {
  if (!step.branches) return undefined
  if (typeof output !== "object" || output === null || Array.isArray(output)) return undefined
  const branch = (output as { branch?: unknown }).branch
  if (typeof branch !== "string") return undefined
  // Own-property lookup only: `constructor` / `toString` / `__proto__` would
  // otherwise resolve through Object.prototype and defeat the fail-closed rule
  // in ADR-18 §2.5.3 by yielding a truthy non-string target.
  if (!Object.hasOwn(step.branches, branch)) return undefined
  const target = step.branches[branch]
  return typeof target === "string" ? target : undefined
}

/**
 * Branch steps route on a structured `{ branch, summary? }` result, but a child
 * Session only ever hands back free text (`TaskDriver.delegate`). Parse that text
 * into the declared contract so dynamic routing works on the production
 * executor; anything that does not decode stays a plain string and the step
 * settles `invalid_branch_output` (ADR-18 §2.5.3 fail closed).
 */
export function decodeBranchOutput(text: string): unknown {
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
  const start = unfenced.indexOf("{")
  const end = unfenced.lastIndexOf("}")
  if (start < 0 || end <= start) return text
  let parsed: unknown
  try {
    parsed = JSON.parse(unfenced.slice(start, end + 1))
  } catch {
    // Malformed JSON is the fail-closed path, not an error to report: the caller
    // turns a non-matching output into `invalid_branch_output`.
    return text
  }
  return Option.getOrElse(Schema.decodeUnknownOption(WorkflowAsset.BranchOutput)(parsed), () => text)
}

/** Tells the child exactly which keys are routable, so a real agent can comply. */
function renderBranchContract(branches: Readonly<Record<string, string>>): string {
  const keys = Object.keys(branches)
    .map((key) => JSON.stringify(key))
    .join(" | ")
  return [
    "<workflow_branch_contract>",
    "Reply with a single JSON object and no other text:",
    `{"branch": ${keys}, "summary": "optional, at most ${WorkflowAsset.MAX_BRANCH_SUMMARY_CODE_POINTS} code points"}`,
    "</workflow_branch_contract>",
  ].join("\n")
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const workflowRun = yield* WorkflowRun.Service
    const credentialScanner = yield* CredentialScanner.Service
    const sessionComposition = yield* SessionComposition.Service
    const tasks = yield* Effect.serviceOption(SessionTask.Service)
    const locks = KeyedMutex.makeUnsafe<SessionSchema.ID>()

    const settleInterrupted = (input: {
      sessionID: SessionSchema.ID
      stepRun: WorkflowAsset.StepRunInfo
      preparation: StepPreparation
    }) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          if (input.preparation.childSessionId) {
            yield* TaskDriver.cancel(Schema.decodeUnknownSync(SessionSchema.ID)(input.preparation.childSessionId)).pipe(
              Effect.catchCause((cause) => Effect.logError("Workflow child cancellation failed", cause)),
            )
          }
          yield* workflowRun
            .settleStep({
              stepRunID: input.stepRun.id,
              expectedRevision: input.stepRun.revision,
              status: "cancelled",
              errorCategory: "step_cancelled",
            })
            .pipe(
              Effect.catchTag("WorkflowRun.InvalidStateTransitionError", () => Effect.void),
              Effect.catchTag("WorkflowRun.StepNotFoundError", () => Effect.void),
            )
          yield* patchTask(input.sessionID, input.preparation, "cancelled")
        }),
      )

    const patchTask = (
      sessionID: SessionSchema.ID,
      preparation: StepPreparation,
      status: "completed" | "failed" | "cancelled",
    ) => {
      if (Option.isNone(tasks) || !preparation.taskId) return Effect.void
      return tasks.value
        .patch({
          sessionID,
          id: preparation.taskId,
          status,
          outputDigest: status === "completed" ? preparation.childSessionId : undefined,
        })
        .pipe(Effect.orDie, Effect.asVoid)
    }

    const cleanupPreparation = (sessionID: SessionSchema.ID, preparation: StepPreparation) =>
      Effect.all([
        preparation.childSessionId
          ? TaskDriver.cancel(Schema.decodeUnknownSync(SessionSchema.ID)(preparation.childSessionId)).pipe(
              Effect.ignore,
            )
          : Effect.void,
        patchTask(sessionID, preparation, "cancelled"),
      ]).pipe(Effect.asVoid)

    const taskDriverExecutor: StepExecutor = {
      prepare: (input) =>
        Effect.gen(function* () {
          if (!ProductModePolicy.isCustomModeEnabled()) return { errorCategory: "custom_mode_disabled" as const }
          const allowed = input.snapshot.data.agents.some(
            (agent) => agent.name === input.stepDef.agent || agent.id === input.stepDef.agent,
          )
          if (!allowed) return { errorCategory: "agent_not_allowed" as const }
          if (!(yield* TaskDriver.isInstalled()) || Option.isNone(tasks)) {
            return { errorCategory: "executor_unavailable" as const }
          }

          const created = yield* tasks.value
            .append({
              sessionID: input.sessionID,
              tasks: [
                {
                  content: input.stepDef.name,
                  status: "in_progress",
                  priority: "medium",
                  agentID: input.stepDef.agent,
                },
              ],
            })
            .pipe(Effect.orDie)
          const task = created.at(-1)
          if (!task) return { errorCategory: "executor_unavailable" as const }

          const child = yield* TaskDriver.createChild({
            parentID: input.sessionID,
            agent: AgentV2.ID.make(input.stepDef.agent),
            attended: false,
          }).pipe(
            // Every defect collapses into `executor_unavailable`, which is indistinguishable
            // from a genuinely absent driver. Carry the defect tag so a wrong-root delegation
            // (e.g. Session.NotFoundError from a foreign composition root) stays diagnosable.
            Effect.catchDefect((defect) =>
              Effect.logError("Workflow child Session creation failed", {
                runID: input.runID,
                stepID: input.stepDef.id,
                defectTag:
                  typeof defect === "object" && defect !== null && "_tag" in defect ? String(defect._tag) : "unknown",
              }).pipe(Effect.as(undefined)),
            ),
          )
          if (!child) return { taskId: task.id, errorCategory: "executor_unavailable" as const }
          if (child.parentID !== input.sessionID) {
            yield* patchTask(input.sessionID, { taskId: task.id }, "failed")
            return { taskId: task.id, errorCategory: "agent_not_allowed" as const }
          }
          return { taskId: task.id, childSessionId: child.id }
        }),
      execute: (input): Effect.Effect<StepExecutionResult> =>
        Effect.gen(function* () {
          if (!ProductModePolicy.isCustomModeEnabled()) {
            return { error: "Custom mode disabled", errorCategory: "custom_mode_disabled" }
          }
          if (!input.preparation.childSessionId) {
            return {
              error: "Workflow step has no child Session",
              errorCategory: input.preparation.errorCategory ?? ("executor_unavailable" as const),
            }
          }
          const childSessionID = Schema.decodeUnknownSync(SessionSchema.ID)(input.preparation.childSessionId)
          const structured =
            typeof input.stepDef.input === "string" ? input.stepDef.input : JSON.stringify(input.stepDef.input ?? {})
          const prompt = input.stepDef.branches
            ? `${structured}\n\n${renderBranchContract(input.stepDef.branches)}`
            : structured
          const delegated: Effect.Effect<StepExecutionResult> = TaskDriver.delegate({
            sessionID: childSessionID,
            parentID: input.sessionID,
            prompt,
          }).pipe(
            Effect.map(
              (text): StepExecutionResult => ({
                output: input.stepDef.branches ? decodeBranchOutput(text) : text,
              }),
            ),
            Effect.catchTag(
              "TaskDriver.DelegateError",
              (error): Effect.Effect<StepExecutionResult> =>
                Effect.succeed({
                  error: "Child Session delegation did not complete",
                  errorCategory: error.reason === "cancelled" ? "step_cancelled" : "step_failed",
                }),
            ),
            Effect.catchDefect(() =>
              Effect.logError("Workflow child Session delegation failed", {
                runID: input.runID,
                stepID: input.stepDef.id,
              }).pipe(
                Effect.as({
                  error: "Workflow executor is unavailable",
                  errorCategory: "executor_unavailable" as const,
                }),
              ),
            ),
            Effect.onInterrupt(() => TaskDriver.cancel(childSessionID)),
          )
          if (!input.stepDef.timeoutSeconds) return yield* delegated

          return yield* delegated.pipe(
            Effect.timeoutOption(Duration.seconds(input.stepDef.timeoutSeconds)),
            Effect.flatMap((result): Effect.Effect<StepExecutionResult> => {
              if (Option.isSome(result)) return Effect.succeed(result.value)
              return TaskDriver.cancel(childSessionID).pipe(
                Effect.as({
                  error: "Workflow step timed out",
                  errorCategory: "step_timeout" as const,
                }),
              )
            }),
          )
        }),
    }

    const admit: Interface["admit"] = Effect.fn("WorkflowRunner.admit")(
      function* (sessionID, requestID, expectedSnapshotDigest) {
        const snapshot = yield* sessionComposition.read(sessionID).pipe(
          Effect.mapError(
            (error) =>
              new WorkflowExecutionError({
                runID: sessionID,
                reason: `Failed to read composition snapshot: ${error.details}`,
              }),
          ),
        )
        if (!snapshot || snapshot.version !== 2 || !snapshot.data.workflow) return undefined
        if (expectedSnapshotDigest !== undefined && snapshot.digest !== expectedSnapshotDigest) {
          return yield* new WorkflowExecutionError({ runID: sessionID, reason: "snapshot_changed" })
        }
        return yield* workflowRun.getOrCreate({
          sessionID,
          workflow: snapshot.data.workflow,
          snapshotDigest: snapshot.digest,
          requestID,
        })
      },
    )

    const runUnlocked = Effect.fnUntraced(function* (sessionID: SessionSchema.ID, customExecutor?: StepExecutor) {
      const executor = customExecutor ?? taskDriverExecutor
      const stepSummaries = new Map<string, string>()
      const snapshot = yield* sessionComposition.read(sessionID).pipe(
        Effect.mapError(
          (error) =>
            new WorkflowExecutionError({
              runID: sessionID,
              reason: `Failed to read composition snapshot: ${error.details}`,
            }),
        ),
      )
      if (!snapshot || snapshot.version !== 2 || !snapshot.data.workflow) return undefined

      const workflow = snapshot.data.workflow
      const stepsDef = workflow.steps
      const currentRun = yield* admit(sessionID)
      if (!currentRun) return undefined
      const runID = currentRun.id
      const reconcileTerminal = (run: WorkflowAsset.WorkflowRunInfo) =>
        Effect.gen(function* () {
          if (run.status === "pending" || run.status === "running" || run.status === "cancelled") return run
          const steps = yield* workflowRun.getSteps(run.id)
          const text = yield* renderRootHandoff({
            run,
            steps,
            summaries: stepSummaries,
            scan: (value) => credentialScanner.scan(value).pipe(Effect.map((result) => result.stripped)),
          })
          const handoffDigest = computeDigest({ runID: run.id, text })
          yield* TaskDriver.injectSynthetic({
            id: SessionMessage.ID.make(`msg_workflow_${handoffDigest}`),
            sessionID,
            text,
          }).pipe(
            Effect.catchDefect((defect) =>
              Effect.logError("Workflow root handoff failed", {
                runID: run.id,
                defectTag:
                  typeof defect === "object" && defect !== null && "_tag" in defect ? String(defect._tag) : "unknown",
              }).pipe(Effect.asVoid),
            ),
          )
          return run
        })
      if (
        currentRun.status === "completed" ||
        currentRun.status === "failed" ||
        currentRun.status === "cancelled" ||
        currentRun.status === "partial_success" ||
        currentRun.status === "recovery_required"
      ) {
        return yield* reconcileTerminal(currentRun)
      }
      while (true) {
        const activeRun = yield* workflowRun
          .get(runID)
          .pipe(Effect.mapError(() => new WorkflowExecutionError({ runID, reason: `get_run_failed:${runID}` })))
        if (
          activeRun.status === "completed" ||
          activeRun.status === "failed" ||
          activeRun.status === "cancelled" ||
          activeRun.status === "partial_success" ||
          activeRun.status === "recovery_required"
        ) {
          return yield* reconcileTerminal(activeRun)
        }

        // The flag check must run against the revision we just read: every
        // dispatch/settle in a previous round bumped the run revision, so
        // `currentRun.revision` is stale from round 2 onward and the CAS would
        // fail, killing the drain fiber and wedging the run in `running` with
        // every endpoint returning 400 while the flag is off (ADR-18 §2.6.3).
        if (!ProductModePolicy.isCustomModeEnabled()) {
          const cancelling = yield* workflowRun
            .cancelRun({
              runID,
              expectedRevision: activeRun.revision,
              errorCategory: "custom_mode_disabled",
            })
            .pipe(Effect.mapError(() => new WorkflowExecutionError({ runID, reason: "custom_mode_disabled" })))
          return yield* workflowRun
            .finalizeCancelRun({
              runID,
              expectedRevision: cancelling.revision,
              errorCategory: "custom_mode_disabled",
            })
            .pipe(Effect.mapError(() => new WorkflowExecutionError({ runID, reason: "custom_mode_disabled" })))
        }

        const readySteps = yield* workflowRun.findReadySteps(runID, stepsDef).pipe(
          Effect.catchTag("WorkflowRun.InvalidBranchOutputError", () =>
            workflowRun.failRun({ runID, errorCategory: "invalid_branch_output" }).pipe(
              Effect.flatMap(
                () =>
                  new WorkflowExecutionError({
                    runID,
                    reason: "invalid_branch_output",
                  }),
              ),
            ),
          ),
        )
        if (readySteps.length === 0) {
          const latestByStep = new Map<string, WorkflowAsset.StepRunInfo>()
          for (const step of yield* workflowRun.getSteps(runID)) {
            const current = latestByStep.get(step.stepId)
            if (!current || current.attempt < step.attempt) latestByStep.set(step.stepId, step)
          }
          const latest = [...latestByStep.values()]
          if (latest.some((step) => step.status === "dispatching")) {
            yield* workflowRun.recoverRunning(runID, "execution_unknown", activeRun.revision)
            continue
          }
          if (latest.some((step) => step.status === "running")) {
            // A process restart or request interruption leaves provider work
            // uncertain. Do not replay it; settle the durable owner as
            // cancelled and require an explicit retry from the client.
            yield* workflowRun.recoverRunning(runID, "execution_unknown")
            return yield* reconcileTerminal(yield* workflowRun.get(runID))
          }

          const failed = latest.filter((step) => step.status === "failed")
          if (failed.length > 0) {
            const allAllowed = failed.every(
              (step) => stepsDef.find((definition) => definition.id === step.stepId)?.failurePolicy === "continue",
            )
            if (allAllowed) {
              const partialRun = yield* workflowRun
                .completeRun({
                  runID,
                  expectedRevision: activeRun.revision,
                  partial: true,
                })
                .pipe(Effect.mapError(() => new WorkflowExecutionError({ runID, reason: "partial_success_failed" })))
              return yield* reconcileTerminal(partialRun)
            }
            return yield* workflowRun
              .failRun({
                runID,
                expectedRevision: activeRun.revision,
                errorCategory: failed[0]?.errorCategory ?? "step_failed",
              })
              .pipe(Effect.mapError(() => new WorkflowExecutionError({ runID, reason: "step_failed" })))
          }
          if (latest.some((step) => step.status === "cancelled")) {
            const cancelling = yield* workflowRun
              .cancelRun({ runID, expectedRevision: activeRun.revision, errorCategory: "step_cancelled" })
              .pipe(Effect.mapError(() => new WorkflowExecutionError({ runID, reason: "step_cancelled" })))
            return yield* workflowRun
              .finalizeCancelRun({
                runID,
                expectedRevision: cancelling.revision,
                errorCategory: "step_cancelled",
              })
              .pipe(Effect.mapError(() => new WorkflowExecutionError({ runID, reason: "step_cancelled" })))
          }
          if (activeRun.status === "cancelling" || latest.some((step) => step.status === "cancelling")) {
            return yield* workflowRun
              .finalizeCancelRun({
                runID,
                expectedRevision: activeRun.revision,
                errorCategory: "step_cancelled",
              })
              .pipe(Effect.mapError(() => new WorkflowExecutionError({ runID, reason: "step_cancelled" })))
          }
          if (latest.some((step) => step.status === "pending" || step.status === "ready")) {
            return yield* workflowRun
              .failRun({
                runID,
                expectedRevision: activeRun.revision,
                errorCategory: "unknown_error",
              })
              .pipe(Effect.mapError(() => new WorkflowExecutionError({ runID, reason: "blocked_frontier" })))
          }
          return yield* workflowRun
            .completeRun({ runID, expectedRevision: activeRun.revision })
            .pipe(Effect.mapError(() => new WorkflowExecutionError({ runID, reason: "complete_run_failed" })))
        }

        const aborted = yield* Effect.forEach(
          readySteps,
          (stepRun) =>
            Effect.gen(function* () {
              const stepDef = stepsDef.find((step) => step.id === stepRun.stepId)
              if (!stepDef) return

              const dispatching = yield* workflowRun
                .dispatchStep({
                  stepRunID: stepRun.id,
                  expectedRevision: stepRun.revision,
                })
                .pipe(Effect.catchTag("WorkflowRun.InvalidStateTransitionError", () => Effect.succeed(undefined)))
              if (!dispatching) return

              const preparation: StepPreparation = executor.prepare
                ? yield* executor.prepare({ runID, stepRun, stepDef, snapshot, sessionID }).pipe(
                    Effect.catchDefect(() =>
                      Effect.logError("Workflow step preparation failed", {
                        runID,
                        stepID: stepDef.id,
                      }).pipe(Effect.map((): StepPreparation => ({ errorCategory: "executor_unavailable" }))),
                    ),
                  )
                : {}
              const claimed = yield* workflowRun
                .startStep({
                  stepRunID: dispatching.id,
                  expectedRevision: dispatching.revision,
                  taskID: preparation.taskId,
                  childSessionID: preparation.childSessionId,
                })
                .pipe(
                  Effect.catchTag("WorkflowRun.InvalidStateTransitionError", () =>
                    cleanupPreparation(sessionID, preparation).pipe(Effect.as(undefined)),
                  ),
                )
              if (!claimed) return

              const executeEffect: Effect.Effect<StepExecutionResult> = preparation.errorCategory
                ? Effect.succeed({
                    error: "Workflow step preparation failed",
                    errorCategory: preparation.errorCategory,
                  })
                : executor
                    .execute({
                      runID,
                      stepRun: claimed,
                      stepDef,
                      snapshot,
                      sessionID,
                      preparation,
                    })
                    .pipe(
                      Effect.catch(() =>
                        Effect.succeed({
                          error: "Workflow step execution failed",
                          errorCategory: "step_failed" as const,
                        } satisfies StepExecutionResult),
                      ),
                      Effect.catchDefect(() =>
                        Effect.logError("Workflow step execution defect", {
                          runID,
                          stepID: stepDef.id,
                        }).pipe(
                          Effect.as({
                            error: "Workflow step execution failed",
                            errorCategory: "step_failed" as const,
                          } satisfies StepExecutionResult),
                        ),
                      ),
                    )
              const result = yield* Effect.onExit(executeEffect, (exit) =>
                Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)
                  ? settleInterrupted({ sessionID, stepRun: claimed, preparation })
                  : Effect.void,
              )

              const selectedBranch = branchTarget(stepDef, result.output)
              if (typeof result.output === "string") stepSummaries.set(stepDef.id, result.output)
              const errorCategory =
                stepDef.branches && !selectedBranch
                  ? ("invalid_branch_output" as const)
                  : result.error
                    ? (result.errorCategory ?? ("step_failed" as const))
                    : undefined
              const settled = yield* workflowRun.settleStep({
                stepRunID: claimed.id,
                expectedRevision: claimed.revision,
                status: errorCategory ? "failed" : "completed",
                outputDigest: result.output === undefined ? undefined : computeDigest(result.output),
                branchTarget: selectedBranch,
                errorCategory,
              })
              yield* patchTask(
                sessionID,
                preparation,
                errorCategory === "step_cancelled" ? "cancelled" : errorCategory ? "failed" : "completed",
              )

              if (!errorCategory) return
              const maxAttempts = stepDef.maxAttempts ?? 1
              if (stepDef.failurePolicy === "retry" && settled.attempt < maxAttempts) {
                yield* workflowRun.retryStep({
                  stepRunID: settled.id,
                  expectedRevision: settled.revision,
                })
                return
              }
              // A branch without a selected target is never recoverable by
              // continue: executing both arms would violate routing safety.
              if (stepDef.failurePolicy === "continue" && !stepDef.branches) return
              yield* new BatchAbortError({ errorCategory })
            }),
          { concurrency: computeMaxConcurrency(stepsDef) },
        ).pipe(
          Effect.as(false),
          Effect.catchTag("WorkflowRunner.BatchAbortError", (error) =>
            workflowRun.get(runID).pipe(
              Effect.flatMap((current) =>
                workflowRun.failRun({
                  runID,
                  expectedRevision: current.revision,
                  errorCategory: error.errorCategory,
                }),
              ),
              Effect.as(true),
            ),
          ),
        )
        if (aborted) return yield* reconcileTerminal(yield* workflowRun.get(runID))
      }
    })

    const run: Interface["run"] = Effect.fn("WorkflowRunner.run")((sessionID, executor) =>
      locks
        .withLock(sessionID)(runUnlocked(sessionID, executor))
        .pipe(Effect.mapError((error) => toExecutionError(sessionID, error))),
    )

    return Service.of({ admit, run } satisfies Interface)
  }),
)

export const locationLayer = layer
export const defaultLayer = layer.pipe(
  Layer.provide(WorkflowRun.defaultLayer),
  Layer.provide(SessionComposition.defaultLayer),
  Layer.provide(CredentialScanner.layer),
)
