import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import {
  canCancelRun,
  canCancelStep,
  canRetryStep,
  createWorkflowRuntimeAdapter,
  isWorkflowUpdatedForSession,
  workflowStatusTone,
  type WorkflowRuntimeClient,
} from "./workflow-runtime-model"

describe("workflow runtime model", () => {
  test("filters workflow update events by type and session id", () => {
    expect(
      isWorkflowUpdatedForSession(
        {
          type: "workflow.run.updated",
          properties: { sessionID: "session-a", runID: "run-1" },
        },
        "session-a",
      ),
    ).toBe(true)
    expect(
      isWorkflowUpdatedForSession(
        {
          type: "workflow.run.updated",
          properties: { sessionID: "session-b", runID: "run-1" },
        },
        "session-a",
      ),
    ).toBe(false)
    expect(isWorkflowUpdatedForSession({ type: "session.updated", properties: { sessionID: "session-a" } }, "session-a")).toBe(false)
  })

  test("exposes the terminal and active action matrix", () => {
    expect(canCancelRun("pending")).toBe(true)
    expect(canCancelRun("running")).toBe(true)
    expect(canCancelRun("cancelling")).toBe(false)
    expect(canCancelRun("completed")).toBe(false)

    expect(canCancelStep("ready")).toBe(true)
    expect(canCancelStep("running")).toBe(true)
    expect(canCancelStep("cancelled")).toBe(false)
    // Retry mirrors the server guard: terminal run + a retryable step status.
    expect(canRetryStep("failed", "failed")).toBe(true)
    expect(canRetryStep("execution_unknown", "recovery_required")).toBe(true)
    expect(canRetryStep("cancelled", "cancelled")).toBe(true)
    expect(canRetryStep("running", "running")).toBe(false)
    // The server rejects these with 409, so the affordance must not be offered.
    expect(canRetryStep("completed", "completed")).toBe(false)
    expect(canRetryStep("skipped", "partial_success")).toBe(false)
    expect(canRetryStep("failed", "running")).toBe(false)
  })

  test("maps every supported status to a semantic tone", () => {
    for (const status of [
      "pending",
      "ready",
      "dispatching",
      "running",
      "cancelling",
      "completed",
      "partial_success",
      "failed",
      "cancelled",
      "skipped",
      "execution_unknown",
      "recovery_required",
    ] as const) {
      expect(workflowStatusTone(status)).toBeTypeOf("string")
      expect(["success", "danger", "warning", "info", "neutral"]).toContain(workflowStatusTone(status))
    }
  })

  test("drives every mutation through the generated session.workflow namespace", async () => {
    const calls: Array<[string, unknown]> = []
    const ok = (name: string) => async (parameters: unknown) => {
      calls.push([name, parameters])
      return {}
    }
    let retryRequestID: string | undefined
    const client: WorkflowRuntimeClient = {
      session: {
        workflow: {
          get: async ({ sessionID }) => {
            calls.push(["get", sessionID])
            return { data: { steps: [] } }
          },
          cancelRun: ok("cancelRun"),
          cancelStep: ok("cancelStep"),
          retryStep: async (parameters) => {
            calls.push(["retryStep", parameters])
            retryRequestID = parameters.requestID
            return {}
          },
        },
      },
    }
    const adapter = createWorkflowRuntimeAdapter(client)

    expect(await adapter.get("session-a")).toEqual({ steps: [] })
    expect(await adapter.cancelRun({ sessionID: "session-a", runID: "run-1", expectedRunRevision: 3 })).toEqual({
      outcome: "accepted",
    })
    expect(
      await adapter.cancelStep({
        sessionID: "session-a",
        runID: "run-1",
        stepRunID: "step-1",
        expectedRunRevision: 3,
        expectedStepRevision: 2,
      }),
    ).toEqual({ outcome: "accepted" })
    expect(
      await adapter.retryStep({
        sessionID: "session-a",
        runID: "run-1",
        stepRunID: "step-1",
        expectedRunRevision: 3,
        expectedStepRevision: 2,
      }),
    ).toEqual({ outcome: "accepted" })

    expect(calls.map(([name]) => name)).toEqual(["get", "cancelRun", "cancelStep", "retryStep"])
    expect(calls[1]?.[1]).toMatchObject({ sessionID: "session-a", runID: "run-1", expectedRunRevision: 3 })
    // Retry is an admission and needs its own idempotency key, so the adapter
    // must mint a requestID the caller never has to know about.
    expect(calls[3]?.[1]).toMatchObject({ stepRunID: "step-1", expectedStepRevision: 2 })
    expect(retryRequestID).toBeString()
  })

  test("reports a stale revision as a conflict instead of a silent no-op", async () => {
    const client: WorkflowRuntimeClient = {
      session: {
        workflow: {
          get: async () => ({ data: { steps: [] } }),
          cancelRun: () => Promise.reject(new Error("stale", { cause: { status: 409 } })),
          cancelStep: () => Promise.reject(new Error("boom")),
          retryStep: () => Promise.reject(new Error("stale", { cause: { status: 409 } })),
        },
      },
    }
    const adapter = createWorkflowRuntimeAdapter(client)

    expect(await adapter.cancelRun({ sessionID: "s", runID: "r", expectedRunRevision: 1 })).toEqual({
      outcome: "conflict",
    })
    expect(
      await adapter.cancelStep({
        sessionID: "s",
        runID: "r",
        stepRunID: "st",
        expectedRunRevision: 1,
        expectedStepRevision: 1,
      }),
    ).toEqual({ outcome: "failed", message: "boom" })
  })

  test("the generated SDK really exposes the session.workflow mutation namespace", () => {
    // Regression guard for a real defect: the three mutation endpoints were
    // declared without an `OpenApi.annotations({ identifier: ... })`, so the
    // generator emitted them flat on the parent Session class and
    // `client.session.workflow.cancelRun` was `undefined` at runtime.
    //
    // This asserts on the generated source rather than importing the client,
    // because `mock.module("@aigcfroge/sdk/v2/client", ...)` in
    // `components/prompt-input/submit.test.ts` is process-global in bun and
    // would replace the real client for whichever file runs second.
    const generated = fs.readFileSync(
      path.resolve(__dirname, "../../../../sdk/js/src/v2/gen/sdk.gen.ts"),
      "utf8",
    )
    const workflowClass = generated.slice(generated.indexOf("export class Workflow extends HeyApiClient"))
    const body = workflowClass.slice(0, workflowClass.indexOf("\nexport class ", 1))
    expect(body).toContain("export class Workflow extends HeyApiClient")
    for (const method of ["get", "run", "cancelRun", "cancelStep", "retryStep"]) {
      expect(body).toContain(`public ${method}<ThrowOnError extends boolean = false>(`)
    }
    // The bug's fingerprint: mutation methods flattened onto the Session class.
    expect(generated).not.toContain("public workflowCancelRun")
    expect(generated).not.toContain("public workflowCancelStep")
    expect(generated).not.toContain("public workflowRetryStep")
  })
})
