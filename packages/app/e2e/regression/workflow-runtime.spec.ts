import { expect, test, type Page, type Request } from "@playwright/test"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { trackPageErrors } from "../utils/errors"
import { expectSessionTitle } from "../utils/waits"

// Custom mode M2 Phase H. The Workflow runtime panel is the only surface where a
// user can observe or steer a durable workflow run. `CustomSessionPanel` mounts it
// unconditionally, and the session side panel renders that panel whenever
// `mode.currentMode === "custom"` — which `app.tsx` locks from `session.mode`.
//
// The panel is deliberately NOT authoritative: `workflow.run.updated` is only an
// invalidation notice. So every state transition below is driven through the mocked
// `GET /session/:id/workflow`, never through an event payload, and the assertions
// pin request bodies wherever the invariant is about the request (revision CAS,
// retry idempotency key) rather than about rendered text.
const directory = "C:/Aigcfroge/WorkflowRuntime"
const projectID = "proj_workflow_runtime"
const sessionID = "ses_workflow_runtime"
const runID = "wfr_workflow_runtime"
const title = "Workflow runtime regression"
const T0 = 1700000000000

const base64Encode = (value: string) =>
  Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")

const model = { providerID: "aigcfroge", modelID: "claude-opus-4-6", variant: "max" }

const provider = {
  all: [
    {
      id: "aigcfroge",
      label: "AigcForge",
      models: [
        { id: "claude-opus-4-6", label: "Claude Opus 4.6", mode: "chat", variants: [{ id: "max", label: "Max" }] },
      ],
    },
  ],
  default: "aigcfroge",
}

const project = {
  id: projectID,
  worktree: directory,
  vcs: "git",
  name: "WorkflowRuntime",
  time: { created: T0, updated: T0 },
}

// The session `mode` is what drives `mode.currentMode` (app.tsx:145), which is what
// makes the side panel render `CustomSessionPanel` at all.
const session = {
  id: sessionID,
  slug: "workflow-runtime-regression",
  projectID,
  directory,
  mode: "custom",
  title,
  version: "dev",
  time: { created: T0, updated: T0 },
}

const userMessage = {
  info: {
    id: "msg_user_workflow",
    sessionID,
    role: "user",
    time: { created: T0 },
    summary: { diffs: [] },
    agent: "meta",
    mode: "custom",
    model,
  },
  parts: [{ id: "prt_user_workflow", sessionID, messageID: "msg_user_workflow", type: "text", text: "run the flow" }],
}

type RunStatus =
  | "pending"
  | "running"
  | "cancelling"
  | "completed"
  | "partial_success"
  | "failed"
  | "cancelled"
  | "recovery_required"

type StepStatus =
  | "pending"
  | "ready"
  | "dispatching"
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped"
  | "execution_unknown"

type WorkflowState = { run?: Record<string, unknown>; steps: Record<string, unknown>[] }

function makeRun(status: RunStatus, overrides: Record<string, unknown> = {}) {
  return {
    id: runID,
    sessionID,
    snapshotDigest: "a".repeat(64),
    workflowName: "release-notes-pipeline",
    workflowRevision: "4",
    status,
    revision: 18,
    timeCreated: T0,
    timeUpdated: T0 + 96_000,
    ...overrides,
  }
}

function makeStep(stepId: string, agentId: string, status: StepStatus, overrides: Record<string, unknown> = {}) {
  return {
    id: `wfs_${stepId}`,
    runId: runID,
    stepId,
    agentId,
    status,
    attempt: 1,
    revision: 6,
    timeCreated: T0,
    ...overrides,
  }
}

// One live run covering every non-terminal step tone in a single render.
const RUNNING: WorkflowState = {
  run: makeRun("running", { currentStepId: "research" }),
  steps: [
    makeStep("plan", "planner", "completed", { outputDigest: "b".repeat(64) }),
    makeStep("research", "researcher", "running", { taskId: "tsk_research" }),
    makeStep("draft", "writer", "dispatching"),
    makeStep("review", "reviewer", "ready"),
    makeStep("polish", "editor", "pending"),
    makeStep("translate", "translator", "failed", { attempt: 2, revision: 9, errorCategory: "step_failed" }),
    makeStep("publish", "publisher", "skipped", { branchTarget: "hotfix" }),
  ],
}

// `finalizeCancelRun` settles cancelling steps to cancelled and skips the ones that
// had not started, so a cancelled run only ever holds terminal steps.
const CANCELLED: WorkflowState = {
  run: makeRun("cancelled", { revision: 25, errorCategory: "step_cancelled", timeCompleted: T0 + 71_000 }),
  steps: [
    makeStep("plan", "planner", "completed", { outputDigest: "b".repeat(64) }),
    makeStep("research", "researcher", "cancelled", { revision: 8, errorCategory: "step_cancelled" }),
    makeStep("draft", "writer", "cancelled", { errorCategory: "step_cancelled" }),
    makeStep("review", "reviewer", "skipped", { errorCategory: "step_cancelled" }),
  ],
}

const FAILED: WorkflowState = {
  run: makeRun("failed", { revision: 22, errorCategory: "max_attempts_exceeded", timeCompleted: T0 + 132_000 }),
  steps: [
    makeStep("plan", "planner", "completed", { outputDigest: "b".repeat(64) }),
    makeStep("research", "researcher", "failed", {
      attempt: 3,
      revision: 12,
      errorCategory: "max_attempts_exceeded",
    }),
    makeStep("draft", "writer", "skipped", { errorCategory: "max_attempts_exceeded" }),
  ],
}

// A step that was `running` when the owner died becomes `execution_unknown` and its
// run becomes `recovery_required` — never auto-replayed, only manually retried.
const RECOVERY_REQUIRED: WorkflowState = {
  run: makeRun("recovery_required", { revision: 20, errorCategory: "execution_unknown" }),
  steps: [
    makeStep("plan", "planner", "completed", { outputDigest: "b".repeat(64) }),
    makeStep("research", "researcher", "execution_unknown", {
      childSessionId: "ses_workflow_runtime_child",
      errorCategory: "execution_unknown",
    }),
    makeStep("draft", "writer", "skipped", { errorCategory: "execution_unknown" }),
  ],
}

const PARTIAL_SUCCESS: WorkflowState = {
  run: makeRun("partial_success", { revision: 27, errorCategory: "step_failed" }),
  steps: [
    makeStep("plan", "planner", "completed", { outputDigest: "b".repeat(64) }),
    makeStep("translate", "translator", "failed", { attempt: 3, revision: 11, errorCategory: "step_failed" }),
  ],
}

type WorkflowMock = {
  /** Reassign to change what the next `GET .../workflow` serves. */
  state: WorkflowState
  /** Every mutation request, in order, with its parsed body. */
  readonly posts: Array<{ path: string; body: Record<string, unknown> }>
  /** Set to 409 to make the next cancel reject the optimistic revision. */
  cancelRunStatus: number
}

const workflowRoot = `/session/${sessionID}/workflow`

// POST goes cross-origin (app :3000 -> server :4096) and the SDK keeps
// `x-aigcfroge-directory` on non-GET requests, so the preflight needs the full
// allow set — the shared mock's `json()` only sets allow-origin.
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "*",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function bodyOf(request: Request): Record<string, unknown> {
  const parsed: unknown = request.postDataJSON()
  return isRecord(parsed) ? parsed : {}
}

async function mountWorkflowPanel(page: Page, initial: WorkflowState, events: unknown[] = []) {
  const mock: WorkflowMock = { state: initial, posts: [], cancelRunStatus: 200 }
  const pageErrors = trackPageErrors(page)

  await mockAigcfrogeServer(page, {
    directory,
    project,
    provider,
    sessions: [session],
    pageMessages: () => ({ items: [userMessage] }),
    // One queued event per SSE reconnect, matching the shared mock's one-shot stream.
    events: () => events.splice(0, 1),
    eventRetry: 16,
  })

  // Registered after the shared catch-all so Playwright matches it first; anything
  // that is not a workflow route falls through to the shared mock.
  await page.route("**/*", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path !== workflowRoot && !path.startsWith(`${workflowRoot}/`)) return route.fallback()

    const method = route.request().method()
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: cors, body: "" })
    if (method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: cors,
        body: JSON.stringify(mock.state),
      })
    }

    mock.posts.push({ path, body: bodyOf(route.request()) })
    if (path.endsWith(`/${runID}/cancel`) && mock.cancelRunStatus !== 200) {
      return route.fulfill({
        status: mock.cancelRunStatus,
        contentType: "application/json",
        headers: cors,
        body: JSON.stringify({ _tag: "ConflictError", resource: runID, message: "stale run revision" }),
      })
    }
    return route.fulfill({
      status: path.endsWith("/retry") ? 202 : 200,
      contentType: "application/json",
      headers: cors,
      body: JSON.stringify(mock.state),
    })
  })

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  try {
    await expectSessionTitle(page, title)
  } catch (error) {
    // A blank app tree means the custom-mode surface threw during render; the
    // bare locator timeout hides that, so surface the page errors with it.
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\npage errors:\n${pageErrors.join("\n") || "(none)"}`,
    )
  }
  await expect(page.locator('[data-component="workflow-runtime-panel"]')).toBeVisible({ timeout: 30_000 })
  // Collected errors are only useful if something asserts on them: an uncaught
  // rejection inside the panel would otherwise pass as long as the title renders.
  expect(pageErrors, `unexpected page errors:\n${pageErrors.join("\n")}`).toEqual([])
  return mock
}

const panelOf = (page: Page) => page.locator('[data-component="workflow-runtime-panel"]')
const stepsOf = (page: Page) => page.locator('[data-component="workflow-runtime-step"]')
const stepWith = (page: Page, status: StepStatus) =>
  page.locator(`[data-component="workflow-runtime-step"][data-status="${status}"]`)
// The run badge is the first `data-status` span inside the content block: the run
// header renders before the step list, and step badges live inside step rows.
const runBadgeOf = (page: Page) => page.locator('[data-component="workflow-runtime-content"] span[data-status]').first()

test.describe("regression: custom workflow runtime panel", () => {
  test("renders the empty state, then reloads authoritative state on workflow.run.updated", async ({ page }) => {
    const events: unknown[] = []
    const mock = await mountWorkflowPanel(page, { steps: [] }, events)

    await expect(page.locator('[data-component="workflow-runtime-empty"]')).toBeVisible()
    await expect(stepsOf(page)).toHaveCount(0)

    // The event carries no step data, so the only way the rows can appear is a
    // refetch of GET .../workflow — which is exactly the invariant under test.
    mock.state = RUNNING
    events.push({
      directory,
      payload: {
        type: "workflow.run.updated",
        properties: { runID, sessionID, revision: 18, status: "running", timeUpdated: T0 + 96_000 },
      },
    })

    await expect(stepsOf(page)).toHaveCount(7, { timeout: 30_000 })
    await expect(page.locator('[data-component="workflow-runtime-empty"]')).toBeHidden()
    await expect(runBadgeOf(page)).toHaveAttribute("data-status", "running")
  })

  test("projects every step status and cancels the run with its current revision", async ({ page }) => {
    const mock = await mountWorkflowPanel(page, RUNNING)
    const panel = panelOf(page)

    await expect(stepsOf(page)).toHaveCount(7)
    for (const status of ["completed", "running", "dispatching", "ready", "pending", "failed", "skipped"] as const) {
      await expect(stepWith(page, status)).toHaveCount(1)
    }
    await expect(stepsOf(page).nth(1)).toContainText("researcher")
    await expect(stepWith(page, "failed")).toContainText("attempt 2")

    // Core settles the run; the client only sends the revision it last read.
    mock.state = CANCELLED
    const cancel = page.waitForRequest(
      (request) => request.url().includes(`${workflowRoot}/${runID}/cancel`) && request.method() === "POST",
    )
    await panel.getByRole("button", { name: "Cancel run" }).click()
    await cancel
    expect(mock.posts.at(-1)?.body).toEqual({ expectedRunRevision: 18 })

    await expect(runBadgeOf(page)).toHaveAttribute("data-status", "cancelled", { timeout: 20_000 })
    await expect(panel.getByRole("button", { name: "Cancel run" })).toBeDisabled()
  })

  test("surfaces a stale-revision conflict instead of the optimistic outcome", async ({ page }) => {
    const mock = await mountWorkflowPanel(page, RUNNING)
    const panel = panelOf(page)

    // The run settled behind the user's back, so the CAS rejects the revision.
    mock.cancelRunStatus = 409
    mock.state = CANCELLED
    await panel.getByRole("button", { name: "Cancel run" }).click()

    const notice = page.locator('[data-component="workflow-runtime-action-notice"]')
    await expect(notice).toBeVisible({ timeout: 20_000 })
    await expect(notice).toContainText("The run changed while this view was open")
    // A rejected mutation must still leave the authoritative state on screen.
    await expect(runBadgeOf(page)).toHaveAttribute("data-status", "cancelled")
  })

  test("retries a failed step with an idempotency key and keeps terminal runs immutable", async ({ page }) => {
    const mock = await mountWorkflowPanel(page, FAILED)
    const panel = panelOf(page)

    await expect(panel.getByRole("button", { name: "Cancel run" })).toBeDisabled()

    const retry = page.waitForRequest(
      (request) => request.url().includes("/step/wfs_research/retry") && request.method() === "POST",
    )
    await stepWith(page, "failed").getByRole("button", { name: "Retry step" }).click()
    const accepted = await retry.then((request) => request.response())
    expect(accepted?.status()).toBe(202)

    // Retry admits a NEW lineage run, so it needs its own idempotency key that the
    // caller never supplies; both revisions come from what the panel last read.
    const body = mock.posts.at(-1)?.body ?? {}
    expect(body.expectedRunRevision).toBe(22)
    expect(body.expectedStepRevision).toBe(12)
    expect(typeof body.requestID).toBe("string")
    expect(String(body.requestID ?? "")).not.toHaveLength(0)

    // A run whose owner died mid-step exposes the unknown step and stays terminal.
    mock.state = RECOVERY_REQUIRED
    await panel.getByRole("button", { name: "Reload" }).click()
    await expect(stepWith(page, "execution_unknown")).toHaveCount(1, { timeout: 20_000 })
    await expect(runBadgeOf(page)).toHaveAttribute("data-status", "recovery_required")
    await expect(panel.getByRole("button", { name: "Cancel run" })).toBeDisabled()

    mock.state = PARTIAL_SUCCESS
    await panel.getByRole("button", { name: "Reload" }).click()
    await expect(runBadgeOf(page)).toHaveAttribute("data-status", "partial_success", { timeout: 20_000 })
    await expect(panel.getByRole("button", { name: "Cancel run" })).toBeDisabled()
  })

  test("shows the load error affordance when the workflow read fails", async ({ page }) => {
    await mountWorkflowPanel(page, RUNNING)
    await expect(stepsOf(page)).toHaveCount(7)

    // A URL glob would not match the SDK's `?directory=` query, so match on the
    // parsed pathname instead.
    await page.route(
      (url) => url.pathname === workflowRoot,
      (route) =>
        route.fulfill({ status: 500, contentType: "application/json", headers: cors, body: JSON.stringify({}) }),
    )
    await panelOf(page).getByRole("button", { name: "Reload" }).click()
    await expect(page.locator('[data-component="workflow-runtime-error"]')).toBeVisible({ timeout: 20_000 })
  })
})
