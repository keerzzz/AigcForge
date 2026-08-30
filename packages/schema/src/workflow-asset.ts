export * as WorkflowAsset from "./workflow-asset"

import { Effect, Schema } from "effect"

export const Name = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter<string>((input) => Array.from(input).length >= 1, {
      message: "Name must be at least 1 code point",
    }),
  ),
  Schema.check(
    Schema.makeFilter<string>((input) => Array.from(input).length <= 80, {
      message: "Name must be at most 80 code points",
    }),
  ),
  Schema.brand("WorkflowAsset.Name"),
)
export type Name = typeof Name.Type

export const Description = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter<string>((input) => Array.from(input).length <= 300, {
      message: "Description must be at most 300 code points",
    }),
  ),
  Schema.brand("WorkflowAsset.Description"),
)
export type Description = typeof Description.Type

export const Revision = Schema.String.pipe(
  Schema.check(Schema.isMinLength(64)),
  Schema.check(Schema.isMaxLength(64)),
  Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  Schema.brand("WorkflowAsset.Revision"),
)
export type Revision = typeof Revision.Type

export const FailurePolicy = Schema.Literals(["abort", "continue", "retry"])
export type FailurePolicy = typeof FailurePolicy.Type

export const WorkflowRunStatus = Schema.Literals([
  "pending",
  "running",
  "cancelling",
  "completed",
  "partial_success",
  "failed",
  "cancelled",
  "recovery_required",
])
export type WorkflowRunStatus = typeof WorkflowRunStatus.Type

export const StepRunStatus = Schema.Literals([
  "pending",
  "ready",
  "dispatching",
  "running",
  "cancelling",
  "completed",
  "failed",
  "cancelled",
  "skipped",
  "execution_unknown",
])
export type StepRunStatus = typeof StepRunStatus.Type

export const WorkflowRunID = Schema.String.pipe(Schema.brand("WorkflowRunID"))
export type WorkflowRunID = typeof WorkflowRunID.Type

export const StepRunID = Schema.String.pipe(Schema.brand("StepRunID"))
export type StepRunID = typeof StepRunID.Type

export const ErrorCategory = Schema.Literals([
  "invalid_branch_output",
  "step_timeout",
  "step_failed",
  "step_cancelled",
  "max_attempts_exceeded",
  "custom_mode_disabled",
  "agent_not_allowed",
  "executor_unavailable",
  "root_handoff_failed",
  "execution_unknown",
  "unknown_error",
])
export type ErrorCategory = typeof ErrorCategory.Type

export class WorkflowRunInfo extends Schema.Class<WorkflowRunInfo>("WorkflowAsset.WorkflowRunInfo")({
  id: WorkflowRunID,
  sessionID: Schema.String,
  snapshotDigest: Schema.String,
  workflowName: Schema.String,
  workflowRevision: Schema.String,
  status: WorkflowRunStatus,
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  parentRunID: Schema.optional(WorkflowRunID),
  rootRunID: Schema.optional(WorkflowRunID),
  retryOfStepRunID: Schema.optional(StepRunID),
  currentStepId: Schema.optional(Schema.String),
  errorCategory: Schema.optional(ErrorCategory),
  timeCreated: Schema.Finite,
  timeUpdated: Schema.Finite,
  timeCompleted: Schema.optional(Schema.Finite),
}) {}

export class StepRunInfo extends Schema.Class<StepRunInfo>("WorkflowAsset.StepRunInfo")({
  id: StepRunID,
  runId: WorkflowRunID,
  stepId: Schema.String,
  agentId: Schema.String,
  status: StepRunStatus,
  attempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  taskId: Schema.optional(Schema.String),
  childSessionId: Schema.optional(Schema.String),
  inputDigest: Schema.optional(Schema.String),
  outputDigest: Schema.optional(Schema.String),
  branchTarget: Schema.optional(Schema.String),
  errorCategory: Schema.optional(ErrorCategory),
  timeCreated: Schema.Finite,
  timeStarted: Schema.optional(Schema.Finite),
  timeCompleted: Schema.optional(Schema.Finite),
}) {}

export class WorkflowStatusResponse extends Schema.Class<WorkflowStatusResponse>(
  "WorkflowAsset.WorkflowStatusResponse",
)({
  run: Schema.optional(WorkflowRunInfo),
  steps: Schema.Array(StepRunInfo),
}) {}

// Graph and execution bounds are part of the persisted workflow contract.
export const MAX_STEPS = 64
export const MAX_PARALLEL = 8
export const MAX_ATTEMPTS = 8
export const MAX_TIMEOUT_SECONDS = 86_400
export const MAX_BRANCH_SUMMARY_CODE_POINTS = 2_000

export const StepInput = Schema.Record(Schema.String, Schema.Json)
export type StepInput = typeof StepInput.Type

export class BranchOutput extends Schema.Class<BranchOutput>("WorkflowAsset.BranchOutput")({
  branch: Schema.String,
  summary: Schema.optional(
    Schema.String.pipe(
      Schema.check(
        Schema.makeFilter<string>((input) => Array.from(input).length <= MAX_BRANCH_SUMMARY_CODE_POINTS, {
          message: `Branch summary must be at most ${MAX_BRANCH_SUMMARY_CODE_POINTS} code points`,
        }),
      ),
    ),
  ),
}) {}

export class StepDef extends Schema.Class<StepDef>("WorkflowAsset.StepDef")({
  id: Schema.String,
  name: Schema.String,
  agent: Schema.String,
  input: Schema.optional(StepInput).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({})),
    Schema.withConstructorDefault(Effect.succeed({})),
  ),
  next: Schema.optional(Schema.String),
  branches: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  parallel: Schema.optional(Schema.Array(Schema.String)),
  failurePolicy: Schema.optional(FailurePolicy).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("abort" as const)),
    Schema.withConstructorDefault(Effect.succeed("abort" as const)),
  ),
  maxAttempts: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(MAX_ATTEMPTS)),
  ).pipe(Schema.withDecodingDefaultKey(Effect.succeed(1)), Schema.withConstructorDefault(Effect.succeed(1))),
  timeoutSeconds: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(MAX_TIMEOUT_SECONDS)),
  ),
}) {}

export class Summary extends Schema.Class<Summary>("WorkflowAsset.Summary")({
  kind: Schema.Literal("workflow"),
  name: Name,
  description: Description,
  relativePath: Schema.String,
  revision: Revision,
}) {}

export class Info extends Schema.Class<Info>("WorkflowAsset.Info")({
  kind: Schema.Literal("workflow"),
  name: Name,
  description: Description,
  relativePath: Schema.String,
  revision: Revision,
  version: Schema.String,
  triggers: Schema.Array(Schema.String),
  steps: Schema.Array(StepDef),
}) {}

export class Frontmatter extends Schema.Class<Frontmatter>("WorkflowAsset.Frontmatter")({
  kind: Schema.Literal("workflow"),
  name: Schema.String,
  description: Schema.String,
  version: Schema.String,
  triggers: Schema.optional(Schema.Array(Schema.String)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
    Schema.withConstructorDefault(Effect.succeed([])),
  ),
  steps: Schema.Array(StepDef),
}) {}

export const InvalidErrorTag = Schema.Literals(["parse_error", "bad_frontmatter", "name_conflict"])
export type InvalidErrorTag = typeof InvalidErrorTag.Type

export class InvalidEntry extends Schema.Class<InvalidEntry>("WorkflowAsset.InvalidEntry")({
  relativePath: Schema.String,
  errorTag: InvalidErrorTag,
}) {}

export function computeMaxConcurrency(steps: readonly StepDef[]): number {
  return Math.min(
    MAX_PARALLEL,
    steps.reduce((maximum, step) => Math.max(maximum, step.parallel?.length ?? 1), 1),
  )
}

export type GraphErrorCode =
  | "duplicate_step_id"
  | "unknown_step_target"
  | "unknown_branch_target"
  | "unknown_parallel_target"
  | "graph_cycle"
  | "unreachable_step"
  | "max_steps_exceeded"
  | "max_parallel_exceeded"
  | "branch_continue_forbidden"
  | "max_attempts_exceeded"
  | "timeout_exceeded"

export interface GraphError {
  readonly code: GraphErrorCode
  readonly message: string
  readonly stepId?: string
}

export interface GraphValidationResult {
  readonly valid: boolean
  readonly errors: readonly GraphError[]
}

export function validateGraph(steps: readonly StepDef[]): GraphValidationResult {
  const errors: GraphError[] = []

  if (steps.length === 0) {
    return { valid: true, errors: [] }
  }

  if (steps.length > MAX_STEPS) {
    errors.push({
      code: "max_steps_exceeded",
      message: `Workflow exceeds maximum step count of ${MAX_STEPS} (got ${steps.length})`,
    })
  }

  const stepIds = new Set<string>()
  const stepMap = new Map<string, StepDef>()

  for (const step of steps) {
    if (stepIds.has(step.id)) {
      errors.push({
        code: "duplicate_step_id",
        message: `Duplicate step ID: ${step.id}`,
        stepId: step.id,
      })
    } else {
      stepIds.add(step.id)
      stepMap.set(step.id, step)
    }
  }

  // Validate targets
  for (const step of steps) {
    if (step.next && !stepIds.has(step.next) && step.next !== "END") {
      errors.push({
        code: "unknown_step_target",
        message: `Step ${step.id} references unknown next step: ${step.next}`,
        stepId: step.id,
      })
    }

    if (step.branches) {
      for (const [branchKey, target] of Object.entries(step.branches)) {
        if (!stepIds.has(target) && target !== "END") {
          errors.push({
            code: "unknown_branch_target",
            message: `Step ${step.id} branch '${branchKey}' references unknown target: ${target}`,
            stepId: step.id,
          })
        }
      }
    }

    if (step.parallel) {
      if (step.parallel.length > MAX_PARALLEL) {
        errors.push({
          code: "max_parallel_exceeded",
          message: `Step ${step.id} exceeds maximum parallel steps of ${MAX_PARALLEL} (got ${step.parallel.length})`,
          stepId: step.id,
        })
      }
      for (const target of step.parallel) {
        if (!stepIds.has(target)) {
          errors.push({
            code: "unknown_parallel_target",
            message: `Step ${step.id} parallel target references unknown step: ${target}`,
            stepId: step.id,
          })
        }
      }
    }

    if (step.branches && step.failurePolicy === "continue") {
      errors.push({
        code: "branch_continue_forbidden",
        message: `Branch step ${step.id} cannot use failurePolicy=continue; an unresolved branch must fail closed`,
        stepId: step.id,
      })
    }
  }

  // Cycle detection via DFS
  const getSuccessors = (step: StepDef): string[] => {
    const successors: string[] = []
    if (step.next && step.next !== "END" && stepIds.has(step.next)) {
      successors.push(step.next)
    }
    if (step.branches) {
      for (const target of Object.values(step.branches)) {
        if (target !== "END" && stepIds.has(target)) {
          successors.push(target)
        }
      }
    }
    if (step.parallel) {
      for (const target of step.parallel) {
        if (stepIds.has(target)) {
          successors.push(target)
        }
      }
    }
    return successors
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  let hasCycle = false

  const dfs = (id: string) => {
    if (visiting.has(id)) {
      hasCycle = true
      return
    }
    if (visited.has(id)) return

    visiting.add(id)
    const step = stepMap.get(id)
    if (step) {
      for (const succ of getSuccessors(step)) {
        dfs(succ)
        if (hasCycle) return
      }
    }
    visiting.delete(id)
    visited.add(id)
  }

  for (const step of steps) {
    if (!visited.has(step.id)) {
      dfs(step.id)
      if (hasCycle) {
        errors.push({
          code: "graph_cycle",
          message: "Cycle detected in workflow graph",
        })
        break
      }
    }
  }

  // Reachability analysis from entry step (steps[0])
  if (steps.length > 0 && !hasCycle) {
    const reachable = new Set<string>()
    const queue = [steps[0].id]
    reachable.add(steps[0].id)

    while (queue.length > 0) {
      const currentId = queue.shift()!
      const step = stepMap.get(currentId)
      if (step) {
        for (const succ of getSuccessors(step)) {
          if (!reachable.has(succ)) {
            reachable.add(succ)
            queue.push(succ)
          }
        }
      }
    }

    for (const step of steps) {
      if (!reachable.has(step.id)) {
        errors.push({
          code: "unreachable_step",
          message: `Step ${step.id} is unreachable from entry step ${steps[0].id}`,
          stepId: step.id,
        })
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
