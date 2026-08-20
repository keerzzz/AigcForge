import { afterAll, beforeAll, describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { WorkflowRun } from "@aigcfroge/core/workflow/workflow-run"
import { WorkflowRunner } from "@aigcfroge/core/workflow/workflow-runner"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { Composition } from "@aigcfroge/schema/composition"
import { testEffect } from "./lib/effect"

const it = testEffect(
  Layer.mergeAll(
    Database.defaultLayer,
    SessionComposition.defaultLayer,
    WorkflowRun.defaultLayer,
    WorkflowRunner.defaultLayer,
  ),
)

let savedFlag: string | undefined

beforeAll(() => {
  savedFlag = process.env["AIGCFROGE_CUSTOM_MODE"]
  process.env["AIGCFROGE_CUSTOM_MODE"] = "true"
})

afterAll(() => {
  if (savedFlag === undefined) delete process.env["AIGCFROGE_CUSTOM_MODE"]
  else process.env["AIGCFROGE_CUSTOM_MODE"] = savedFlag
})

const mockDigest = Schema.decodeUnknownSync(Composition.Digest)(
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
)
const mockRevision = Schema.decodeUnknownSync(Composition.Revision)(
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
)

function seedSessionWithSnapshot(
  sid: string,
  workflowSteps: WorkflowAsset.StepDef[],
) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    const composition = yield* SessionComposition.Service
    const projectID = Project.ID.make("prj_wfr_runner_test")
    const sessionID = SessionV2.ID.make(sid)

    yield* db
      .insert(ProjectTable)
      .values({
        id: projectID,
        worktree: AbsolutePath.make("/project"),
        sandboxes: [],
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)

    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: projectID,
        slug: sid,
        directory: "/project",
        title: "Workflow Session",
        mode: "custom",
        version: "test",
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)

    const snapshot = new Composition.SnapshotV2({
      version: 2,
      digest: mockDigest,
      sessionID: sid,
      createdAt: Date.now(),
      data: new Composition.SnapshotDataV2({
        agents: [
          new Composition.AgentInfo({
            id: "coder",
            name: "coder",
            description: "Code agent",
            relativePath: "coder.md",
            revision: mockRevision,
          }),
          new Composition.AgentInfo({
            id: "reviewer",
            name: "reviewer",
            description: "Review agent",
            relativePath: "reviewer.md",
            revision: mockRevision,
          }),
        ],
        workflow: new Composition.WorkflowInfo({
          name: "test-pipeline",
          description: "Test pipeline",
          relativePath: "pipeline.yaml",
          revision: mockRevision,
          steps: workflowSteps,
        }),
        commands: [],
        instructions: [],
        prompts: [],
        skills: [],
        tools: new Composition.SnapshotToolInfo({
          fingerprints: [],
          catalogDigest: mockDigest,
          catalog: [],
        }),
      }),
    })

    yield* composition.attach(sessionID, snapshot)
  })
}

describe("WorkflowRunner Service", () => {
  it.effect("executes a multi-step linear workflow to completion", () =>
    Effect.gen(function* () {
      const sid = "ses_runner_linear"
      const steps = [
        new WorkflowAsset.StepDef({
          id: "step_code",
          name: "Coding",
          agent: "coder",
          next: "step_review",
        }),
        new WorkflowAsset.StepDef({
          id: "step_review",
          name: "Review",
          agent: "reviewer",
          next: "END",
        }),
      ]

      yield* seedSessionWithSnapshot(sid, steps)
      const runner = yield* WorkflowRunner.Service
      const workflowService = yield* WorkflowRun.Service

      const executedSteps: string[] = []
      const customExecutor: WorkflowRunner.StepExecutor = {
        execute: (input) =>
          Effect.gen(function* () {
            executedSteps.push(input.stepDef.id)
            return { output: { done: input.stepDef.id } }
          }),
      }

      const result = yield* runner.run(SessionV2.ID.make(sid), customExecutor)
      expect(result).toBeDefined()
      expect(result?.status).toBe("completed")
      expect(executedSteps).toEqual(["step_code", "step_review"])

      const stepRuns = yield* workflowService.getSteps(result!.id)
      expect(stepRuns).toHaveLength(2)
      expect(stepRuns[0].status).toBe("completed")
      expect(stepRuns[1].status).toBe("completed")
    }))

  it.effect("executes a parallel workflow with branches and merge", () =>
    Effect.gen(function* () {
      const sid = "ses_runner_parallel"
      const steps = [
        new WorkflowAsset.StepDef({
          id: "start",
          name: "Start",
          agent: "coder",
          parallel: ["branch_a", "branch_b"],
        }),
        new WorkflowAsset.StepDef({
          id: "branch_a",
          name: "Branch A",
          agent: "coder",
          next: "merge",
        }),
        new WorkflowAsset.StepDef({
          id: "branch_b",
          name: "Branch B",
          agent: "coder",
          next: "merge",
        }),
        new WorkflowAsset.StepDef({
          id: "merge",
          name: "Merge",
          agent: "reviewer",
          next: "END",
        }),
      ]

      yield* seedSessionWithSnapshot(sid, steps)
      const runner = yield* WorkflowRunner.Service

      const executedSteps: string[] = []
      const customExecutor: WorkflowRunner.StepExecutor = {
        execute: (input) =>
          Effect.gen(function* () {
            executedSteps.push(input.stepDef.id)
            return { output: { branch: input.stepDef.id } }
          }),
      }

      const result = yield* runner.run(SessionV2.ID.make(sid), customExecutor)
      expect(result?.status).toBe("completed")
      expect(executedSteps).toContain("start")
      expect(executedSteps).toContain("branch_a")
      expect(executedSteps).toContain("branch_b")
      expect(executedSteps).toContain("merge")
      expect(executedSteps[0]).toBe("start")
      expect(executedSteps[executedSteps.length - 1]).toBe("merge")
    }))

  it.effect("retries a flaky step and succeeds on second attempt", () =>
    Effect.gen(function* () {
      const sid = "ses_runner_retry"
      const steps = [
        new WorkflowAsset.StepDef({
          id: "flaky_step",
          name: "Flaky",
          agent: "coder",
          failurePolicy: "retry",
          maxAttempts: 3,
          next: "END",
        }),
      ]

      yield* seedSessionWithSnapshot(sid, steps)
      const runner = yield* WorkflowRunner.Service
      const workflowService = yield* WorkflowRun.Service

      let attempts = 0
      const customExecutor: WorkflowRunner.StepExecutor = {
        execute: (input) =>
          Effect.gen(function* () {
            attempts++
            if (attempts === 1) {
              return { error: "First attempt simulated failure" }
            }
            return { output: { successOnAttempt: attempts } }
          }),
      }

      const result = yield* runner.run(SessionV2.ID.make(sid), customExecutor)
      expect(result?.status).toBe("completed")
      expect(attempts).toBe(2)

      const stepRuns = yield* workflowService.getSteps(result!.id)
      expect(stepRuns).toHaveLength(2)
      expect(stepRuns[0].attempt).toBe(1)
      expect(stepRuns[0].status).toBe("failed")
      expect(stepRuns[1].attempt).toBe(2)
      expect(stepRuns[1].status).toBe("completed")
    }))

  it.effect("completes as partial_success when continue step fails", () =>
    Effect.gen(function* () {
      const sid = "ses_runner_partial"
      const steps = [
        new WorkflowAsset.StepDef({
          id: "start",
          name: "Start",
          agent: "coder",
          parallel: ["main_branch", "optional_branch"],
        }),
        new WorkflowAsset.StepDef({
          id: "main_branch",
          name: "Main Branch",
          agent: "coder",
          next: "END",
        }),
        new WorkflowAsset.StepDef({
          id: "optional_branch",
          name: "Optional Branch",
          agent: "coder",
          failurePolicy: "continue",
          next: "END",
        }),
      ]

      yield* seedSessionWithSnapshot(sid, steps)
      const runner = yield* WorkflowRunner.Service

      const customExecutor: WorkflowRunner.StepExecutor = {
        execute: (input) =>
          Effect.gen(function* () {
            if (input.stepDef.id === "optional_branch") {
              return { error: "Non-critical error" }
            }
            return { output: { ok: true } }
          }),
      }

      const result = yield* runner.run(SessionV2.ID.make(sid), customExecutor)
      expect(result?.status).toBe("partial_success")
    }))

  it.effect("fails workflow run when abort step fails", () =>
    Effect.gen(function* () {
      const sid = "ses_runner_abort"
      const steps = [
        new WorkflowAsset.StepDef({
          id: "step_critical",
          name: "Critical Step",
          agent: "coder",
          failurePolicy: "abort",
          next: "step_downstream",
        }),
        new WorkflowAsset.StepDef({
          id: "step_downstream",
          name: "Downstream Step",
          agent: "reviewer",
          next: "END",
        }),
      ]

      yield* seedSessionWithSnapshot(sid, steps)
      const runner = yield* WorkflowRunner.Service

      const customExecutor: WorkflowRunner.StepExecutor = {
        execute: () => Effect.succeed({ error: "Fatal compilation error" }),
      }

      const result = yield* runner.run(SessionV2.ID.make(sid), customExecutor)
      expect(result?.status).toBe("failed")
      expect(result?.error).toContain("Fatal compilation error")
    }))

  it.effect("cancels workflow run when custom mode kill-switch is triggered", () =>
    Effect.gen(function* () {
      const sid = "ses_runner_killswitch"
      const steps = [
        new WorkflowAsset.StepDef({
          id: "step_1",
          name: "Step 1",
          agent: "coder",
          next: "END",
        }),
      ]

      yield* seedSessionWithSnapshot(sid, steps)
      const runner = yield* WorkflowRunner.Service

      // Disable custom mode flag
      delete process.env["AIGCFROGE_CUSTOM_MODE"]

      const result = yield* runner.run(SessionV2.ID.make(sid))
      expect(result?.status).toBe("cancelled")
      expect(result?.error).toBe("custom_mode_disabled")

      // Restore flag for subsequent tests
      process.env["AIGCFROGE_CUSTOM_MODE"] = "true"
    }))

  it.effect("executes dynamic branching and skips non-selected branch", () =>
    Effect.gen(function* () {
      const sid = "ses_runner_branching"
      const steps = [
        new WorkflowAsset.StepDef({
          id: "classifier",
          name: "Classifier",
          agent: "coder",
          branches: {
            bug: "step_fix",
            feature: "step_feature",
          },
        }),
        new WorkflowAsset.StepDef({
          id: "step_fix",
          name: "Fix Bug",
          agent: "coder",
          next: "join_step",
        }),
        new WorkflowAsset.StepDef({
          id: "step_feature",
          name: "Add Feature",
          agent: "coder",
          next: "join_step",
        }),
        new WorkflowAsset.StepDef({
          id: "join_step",
          name: "Join",
          agent: "reviewer",
          next: "END",
        }),
      ]

      yield* seedSessionWithSnapshot(sid, steps)
      const runner = yield* WorkflowRunner.Service
      const workflowService = yield* WorkflowRun.Service

      const executedSteps: string[] = []
      const customExecutor: WorkflowRunner.StepExecutor = {
        execute: (input) =>
          Effect.gen(function* () {
            executedSteps.push(input.stepDef.id)
            if (input.stepDef.id === "classifier") {
              return { output: { branch: "bug" } }
            }
            return { output: { done: input.stepDef.id } }
          }),
      }

      const result = yield* runner.run(SessionV2.ID.make(sid), customExecutor)
      expect(result?.status).toBe("completed")
      expect(executedSteps).toEqual(["classifier", "step_fix", "join_step"])

      const stepRuns = yield* workflowService.getSteps(result!.id)
      const fixRun = stepRuns.find((s) => s.stepId === "step_fix")
      const featRun = stepRuns.find((s) => s.stepId === "step_feature")
      const joinRun = stepRuns.find((s) => s.stepId === "join_step")

      expect(fixRun?.status).toBe("completed")
      expect(featRun?.status).toBe("skipped")
      expect(joinRun?.status).toBe("completed")
    }))
})

