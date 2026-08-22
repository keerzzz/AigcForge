import type { WorkflowAssetStepRunInfo, WorkflowAssetWorkflowRunInfo } from "@aigcfroge/sdk/v2/client"
import { WorkflowRuntimePanel } from "./workflow-runtime-panel"
import type { WorkflowMutationOutcome, WorkflowRuntimeAdapter, WorkflowStatusResponse } from "./workflow-runtime-model"

const SESSION_ID = "ses_workflow_story"
const RUN_ID = "wfr_workflow_story"
const T0 = 1_755_000_000_000

function makeRun(
  status: WorkflowAssetWorkflowRunInfo["status"],
  overrides?: Partial<WorkflowAssetWorkflowRunInfo>,
): WorkflowAssetWorkflowRunInfo {
  return {
    id: RUN_ID,
    sessionID: SESSION_ID,
    snapshotDigest: "sha256:6b1f0ad4c9",
    workflowName: "release-notes-pipeline",
    workflowRevision: "4",
    status,
    revision: 18,
    timeCreated: T0,
    timeUpdated: T0 + 96_000,
    ...overrides,
  }
}

function makeStep(
  stepId: string,
  agentId: string,
  status: WorkflowAssetStepRunInfo["status"],
  overrides?: Partial<WorkflowAssetStepRunInfo>,
): WorkflowAssetStepRunInfo {
  return {
    id: `wfs_${stepId}`,
    runId: RUN_ID,
    stepId,
    agentId,
    status,
    attempt: 1,
    revision: 6,
    timeCreated: T0,
    ...overrides,
  }
}

// Every story runs a fully wired adapter: cancelRun/cancelStep/retryStep all exist in
// the generated SDK. An accepted mutation makes the panel refetch, and the refetch
// returns the same projection because Core settles run and step state — never the client.
function storyAdapter(
  load: () => Promise<WorkflowStatusResponse>,
  outcome: WorkflowMutationOutcome = { outcome: "accepted" },
): WorkflowRuntimeAdapter {
  const respond = (): Promise<WorkflowMutationOutcome> => Promise.resolve(outcome)
  return {
    get: load,
    cancelRun: respond,
    cancelStep: respond,
    retryStep: respond,
  }
}

// `narrow` emulates the Custom mode drawer column; `desktop` the snapshot panel column.
function panel(
  width: "desktop" | "narrow",
  load: () => Promise<WorkflowStatusResponse>,
  outcome?: WorkflowMutationOutcome,
) {
  const adapter = storyAdapter(load, outcome)
  return () => (
    <div class={width === "narrow" ? "w-80" : "w-full max-w-2xl"}>
      <WorkflowRuntimePanel sessionID={SESSION_ID} adapter={adapter} />
    </div>
  )
}

const settled = (status: WorkflowStatusResponse) => () => Promise.resolve(status)

const PLAN_DONE = makeStep("plan", "planner", "completed", {
  outputDigest: "sha256:1a2b3c",
  timeStarted: T0 + 1_000,
  timeCompleted: T0 + 12_000,
})

// Live run: one branch already failed while sibling steps keep moving, and the
// untaken branch is skipped. Covers every non-terminal step tone in one pass.
const RUNNING: WorkflowStatusResponse = {
  run: makeRun("running", { currentStepId: "research" }),
  steps: [
    PLAN_DONE,
    makeStep("research", "researcher", "running", { taskId: "tsk_research", timeStarted: T0 + 12_500 }),
    makeStep("draft", "writer", "dispatching"),
    makeStep("review", "reviewer", "ready"),
    makeStep("polish", "editor", "pending"),
    makeStep("translate", "translator", "failed", {
      attempt: 2,
      revision: 9,
      errorCategory: "step_failed",
      timeStarted: T0 + 20_000,
      timeCompleted: T0 + 26_000,
    }),
    makeStep("publish", "publisher", "skipped", { branchTarget: "hotfix", timeCompleted: T0 + 26_500 }),
  ],
}

// `completeRun(partial)` refuses to settle while any step is unfinished, so a
// partial_success run only ever holds terminal steps.
const PARTIAL_SUCCESS: WorkflowStatusResponse = {
  run: makeRun("partial_success", {
    revision: 27,
    errorCategory: "step_failed",
    timeCompleted: T0 + 184_000,
  }),
  steps: [
    PLAN_DONE,
    makeStep("research", "researcher", "completed", { timeStarted: T0 + 12_500, timeCompleted: T0 + 48_000 }),
    makeStep("draft", "writer", "completed", { timeStarted: T0 + 48_500, timeCompleted: T0 + 120_000 }),
    makeStep("translate", "translator", "failed", {
      attempt: 3,
      revision: 11,
      errorCategory: "step_failed",
      timeCompleted: T0 + 180_000,
    }),
    makeStep("publish", "publisher", "skipped", { branchTarget: "hotfix", timeCompleted: T0 + 181_000 }),
  ],
}

// `failRun` cancels running steps and skips pending/ready ones; the failed step stays
// failed and is the retry entry point.
const FAILED: WorkflowStatusResponse = {
  run: makeRun("failed", {
    revision: 22,
    errorCategory: "max_attempts_exceeded",
    timeCompleted: T0 + 132_000,
  }),
  steps: [
    PLAN_DONE,
    makeStep("research", "researcher", "failed", {
      attempt: 3,
      revision: 12,
      errorCategory: "max_attempts_exceeded",
      timeStarted: T0 + 12_500,
      timeCompleted: T0 + 130_000,
    }),
    makeStep("draft", "writer", "cancelled", { errorCategory: "max_attempts_exceeded", timeCompleted: T0 + 131_000 }),
    makeStep("review", "reviewer", "skipped", { errorCategory: "max_attempts_exceeded", timeCompleted: T0 + 131_000 }),
  ],
}

// `finalizeCancelRun` turns cancelling steps into cancelled; pending/ready were already
// skipped when the cancel was requested.
const CANCELLED: WorkflowStatusResponse = {
  run: makeRun("cancelled", { revision: 25, errorCategory: "step_cancelled", timeCompleted: T0 + 71_000 }),
  steps: [
    PLAN_DONE,
    makeStep("research", "researcher", "cancelled", {
      revision: 8,
      errorCategory: "step_cancelled",
      timeStarted: T0 + 12_500,
      timeCompleted: T0 + 70_000,
    }),
    makeStep("draft", "writer", "cancelled", { errorCategory: "step_cancelled", timeCompleted: T0 + 70_000 }),
    makeStep("review", "reviewer", "skipped", { errorCategory: "step_cancelled", timeCompleted: T0 + 69_000 }),
    makeStep("publish", "publisher", "skipped", { errorCategory: "step_cancelled", timeCompleted: T0 + 69_000 }),
  ],
}

// Owner claim found a step that was running when the process died: the run needs
// recovery and the step outcome is genuinely unknown, so it is the only retry target.
const RECOVERY_REQUIRED: WorkflowStatusResponse = {
  run: makeRun("recovery_required", {
    revision: 20,
    errorCategory: "execution_unknown",
    timeCompleted: T0 + 60_000,
  }),
  steps: [
    PLAN_DONE,
    makeStep("research", "researcher", "execution_unknown", {
      childSessionId: "ses_workflow_story_research",
      errorCategory: "execution_unknown",
      timeStarted: T0 + 12_500,
      timeCompleted: T0 + 60_000,
    }),
    makeStep("draft", "writer", "skipped", { errorCategory: "execution_unknown", timeCompleted: T0 + 60_000 }),
    makeStep("review", "reviewer", "skipped", { errorCategory: "execution_unknown", timeCompleted: T0 + 60_000 }),
  ],
}

export default {
  title: "App/Session/WorkflowRuntimePanel",
  id: "app-session-workflow-runtime-panel",
  component: WorkflowRuntimePanel,
  tags: ["autodocs"],
  parameters: {
    frameHeight: "520px",
  },
}

export const Running = {
  render: panel("desktop", settled(RUNNING)),
}

// Never settles, so the in-flight row stays reviewable.
export const Loading = {
  render: panel("desktop", () => new Promise<WorkflowStatusResponse>(() => {})),
}

export const LoadError = {
  render: panel("desktop", () => Promise.reject(new Error("workflow status request failed"))),
}

export const Empty = {
  render: panel("desktop", settled({ steps: [] })),
}

export const PartialSuccess = {
  render: panel("desktop", settled(PARTIAL_SUCCESS)),
}

export const FailedRetryableStep = {
  render: panel("desktop", settled(FAILED)),
}

export const Cancelled = {
  render: panel("desktop", settled(CANCELLED)),
}

export const RecoveryRequired = {
  render: panel("desktop", settled(RECOVERY_REQUIRED)),
}

export const Narrow = {
  render: panel("narrow", settled(RUNNING)),
}

// Pinned dark so the built Storybook always carries a dark rendering; every other
// story follows the global theme toggle.
export const Dark = {
  parameters: {
    themes: { themeOverride: "dark" },
  },
  render: panel("desktop", settled(RUNNING)),
}

export const NarrowDark = {
  parameters: {
    themes: { themeOverride: "dark" },
  },
  render: panel("narrow", settled(RECOVERY_REQUIRED)),
}

// The stale-revision notice is only reachable through an action: press "Cancel run" (or
// a step action) and the rejected mutation reports the conflict instead of refetching.
export const MutationConflict = {
  render: panel("desktop", settled(RUNNING), { outcome: "conflict" }),
}
