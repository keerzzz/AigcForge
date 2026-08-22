import type {
  WorkflowAssetStepRunInfo,
  WorkflowAssetWorkflowRunInfo,
  WorkflowAssetWorkflowStatusResponse,
} from "@aigcfroge/sdk/v2/client"
import { uuid } from "@/utils/uuid"

export type WorkflowRunStatus = WorkflowAssetWorkflowRunInfo["status"]
export type WorkflowStepStatus = WorkflowAssetStepRunInfo["status"]
export type WorkflowStatusResponse = WorkflowAssetWorkflowStatusResponse

export type WorkflowRuntimeClient = {
  session: {
    workflow: {
      get: (
        parameters: { sessionID: string },
        options: { throwOnError: true },
      ) => Promise<{ data?: WorkflowStatusResponse }>
      cancelRun: (
        parameters: { sessionID: string; runID: string; expectedRunRevision: number },
        options: { throwOnError: true },
      ) => Promise<unknown>
      cancelStep: (
        parameters: {
          sessionID: string
          runID: string
          stepRunID: string
          expectedRunRevision: number
          expectedStepRevision: number
        },
        options: { throwOnError: true },
      ) => Promise<unknown>
      retryStep: (
        parameters: {
          sessionID: string
          runID: string
          stepRunID: string
          requestID: string
          expectedRunRevision: number
          expectedStepRevision: number
        },
        options: { throwOnError: true },
      ) => Promise<unknown>
    }
  }
}

export const WORKFLOW_RUN_STATUSES = [
  "pending",
  "running",
  "cancelling",
  "completed",
  "partial_success",
  "failed",
  "cancelled",
  "recovery_required",
] as const

export const WORKFLOW_STEP_STATUSES = [
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
] as const

export type WorkflowStatusTone = "neutral" | "info" | "warning" | "success" | "danger"

/**
 * Mutations are optimistically concurrent: the server rejects a stale
 * `expected*Revision` with `409`. That is an expected domain outcome, not an
 * exception, so it is reported as `conflict` and the caller reloads the
 * authoritative state. Everything else surfaces as `failed` with a message —
 * never as a silent no-op.
 */
export type WorkflowMutationOutcome =
  | { readonly outcome: "accepted" }
  | { readonly outcome: "conflict" }
  | { readonly outcome: "failed"; readonly message: string }

export interface WorkflowRuntimeAdapter {
  get(sessionID: string): Promise<WorkflowStatusResponse>
  cancelRun(input: {
    sessionID: string
    runID: string
    expectedRunRevision: number
  }): Promise<WorkflowMutationOutcome>
  cancelStep(input: {
    sessionID: string
    runID: string
    stepRunID: string
    expectedRunRevision: number
    expectedStepRevision: number
  }): Promise<WorkflowMutationOutcome>
  retryStep(input: {
    sessionID: string
    runID: string
    stepRunID: string
    expectedRunRevision: number
    expectedStepRevision: number
  }): Promise<WorkflowMutationOutcome>
}

function statusOf(error: unknown) {
  if (!(error instanceof Error)) return undefined
  const cause = error.cause
  if (!isRecord(cause)) return undefined
  return typeof cause.status === "number" ? cause.status : undefined
}

function messageOf(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

async function settle(action: () => Promise<unknown>): Promise<WorkflowMutationOutcome> {
  try {
    await action()
    return { outcome: "accepted" }
  } catch (error) {
    if (statusOf(error) === 409) return { outcome: "conflict" }
    return { outcome: "failed", message: messageOf(error) }
  }
}

export function createWorkflowRuntimeAdapter(client: WorkflowRuntimeClient): WorkflowRuntimeAdapter {
  const workflow = client.session.workflow
  return {
    async get(sessionID) {
      const response = await workflow.get({ sessionID }, { throwOnError: true })
      return response.data ?? { steps: [] }
    },
    cancelRun: (input) => settle(() => workflow.cancelRun(input, { throwOnError: true })),
    cancelStep: (input) => settle(() => workflow.cancelStep(input, { throwOnError: true })),
    retryStep: (input) =>
      settle(() =>
        workflow.retryStep(
          { ...input, requestID: `workflow-retry-${input.stepRunID}-${uuid()}` },
          { throwOnError: true },
        ),
      ),
  }
}

export function isWorkflowUpdatedForSession(event: unknown, sessionID: string) {
  if (!isRecord(event) || event.type !== "workflow.run.updated") return false
  const properties = isRecord(event.properties) ? event.properties : isRecord(event.data) ? event.data : undefined
  return properties?.sessionID === sessionID
}

export function canCancelRun(status: WorkflowRunStatus) {
  return status === "pending" || status === "running"
}

export function canCancelStep(status: WorkflowStepStatus) {
  return status === "pending" || status === "ready" || status === "dispatching" || status === "running"
}

/**
 * Mirrors the server guard (ADR-18 §2.4.2): manual retry needs a terminal source
 * run and a step the server will actually accept. Offering it for `completed` or
 * `skipped` steps, or while the run is still live, only produces a 409 dead end.
 */
export function canRetryStep(status: WorkflowStepStatus, runStatus: WorkflowRunStatus) {
  if (runStatus === "pending" || runStatus === "running" || runStatus === "cancelling") return false
  return status === "failed" || status === "cancelled" || status === "execution_unknown"
}

export function workflowStatusTone(status: WorkflowRunStatus | WorkflowStepStatus): WorkflowStatusTone {
  if (status === "completed") return "success"
  if (status === "failed" || status === "execution_unknown" || status === "recovery_required") return "danger"
  if (status === "cancelled" || status === "skipped" || status === "partial_success") return "warning"
  if (status === "running" || status === "dispatching" || status === "cancelling") return "info"
  return "neutral"
}

export function workflowStatusKey(status: WorkflowRunStatus | WorkflowStepStatus) {
  return `workflowRuntime.status.${status}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
