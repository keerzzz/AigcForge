export * as WorkflowRun from "./workflow-run"

import { Context, Effect, Layer, Option, Schema } from "effect"
import { and, desc, eq } from "drizzle-orm"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { Composition } from "@aigcfroge/schema/composition"
import type { Session as SessionSchema } from "@aigcfroge/schema/session"
import { Database } from "../database/database"
import { Identifier } from "../id/id"
import { WorkflowRunTable, WorkflowStepRunTable } from "./sql"

export class WorkflowNotFoundError extends Schema.TaggedErrorClass<WorkflowNotFoundError>()(
  "WorkflowRun.WorkflowNotFoundError",
  {
    runID: Schema.String,
  },
) {}

export class StepNotFoundError extends Schema.TaggedErrorClass<StepNotFoundError>()(
  "WorkflowRun.StepNotFoundError",
  {
    stepRunID: Schema.String,
  },
) {}

export class InvalidStateTransitionError extends Schema.TaggedErrorClass<InvalidStateTransitionError>()(
  "WorkflowRun.InvalidStateTransitionError",
  {
    from: Schema.String,
    to: Schema.String,
    reason: Schema.String,
  },
) {}

export interface Interface {
  readonly create: (input: {
    sessionID: SessionSchema.ID
    workflow: Composition.WorkflowInfo
  }) => Effect.Effect<WorkflowAsset.WorkflowRunInfo>

  readonly get: (
    runID: WorkflowAsset.WorkflowRunID,
  ) => Effect.Effect<WorkflowAsset.WorkflowRunInfo, WorkflowNotFoundError>

  readonly getBySession: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<WorkflowAsset.WorkflowRunInfo | undefined>

  readonly getSteps: (
    runID: WorkflowAsset.WorkflowRunID,
  ) => Effect.Effect<readonly WorkflowAsset.StepRunInfo[]>

  readonly findReadySteps: (
    runID: WorkflowAsset.WorkflowRunID,
    stepsDef: readonly WorkflowAsset.StepDef[],
  ) => Effect.Effect<readonly WorkflowAsset.StepRunInfo[]>

  readonly startStep: (
    stepRunID: WorkflowAsset.StepRunID,
  ) => Effect.Effect<WorkflowAsset.StepRunInfo, StepNotFoundError>

  readonly settleStep: (
    stepRunID: WorkflowAsset.StepRunID,
    result: {
      status: "completed" | "failed" | "cancelled" | "skipped"
      output?: unknown
      error?: string
    },
  ) => Effect.Effect<WorkflowAsset.StepRunInfo, StepNotFoundError>

  readonly retryStep: (
    stepRunID: WorkflowAsset.StepRunID,
  ) => Effect.Effect<WorkflowAsset.StepRunInfo, StepNotFoundError>

  readonly cancelRun: (
    runID: WorkflowAsset.WorkflowRunID,
    reason?: string,
  ) => Effect.Effect<WorkflowAsset.WorkflowRunInfo, WorkflowNotFoundError>

  readonly completeRun: (
    runID: WorkflowAsset.WorkflowRunID,
    partial?: boolean,
  ) => Effect.Effect<WorkflowAsset.WorkflowRunInfo, WorkflowNotFoundError>

  readonly failRun: (
    runID: WorkflowAsset.WorkflowRunID,
    error: string,
  ) => Effect.Effect<WorkflowAsset.WorkflowRunInfo, WorkflowNotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/WorkflowRun") {}

function rowToRunInfo(row: typeof WorkflowRunTable.$inferSelect): WorkflowAsset.WorkflowRunInfo {
  return new WorkflowAsset.WorkflowRunInfo({
    id: row.id,
    sessionID: row.session_id,
    workflowName: row.workflow_name,
    workflowRevision: row.workflow_revision,
    status: row.status,
    currentStepId: row.current_step_id ?? undefined,
    error: row.error ?? undefined,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
    timeCompleted: row.time_completed ?? undefined,
  })
}

function rowToStepInfo(row: typeof WorkflowStepRunTable.$inferSelect): WorkflowAsset.StepRunInfo {
  return new WorkflowAsset.StepRunInfo({
    id: row.id,
    runId: row.run_id,
    stepId: row.step_id,
    agentId: row.agent_id,
    status: row.status,
    attempt: row.attempt,
    input: row.input ? (JSON.parse(String(row.input)) as unknown) : undefined,
    output: row.output ? (JSON.parse(String(row.output)) as unknown) : undefined,
    error: row.error ?? undefined,
    timeCreated: row.time_created,
    timeStarted: row.time_started ?? undefined,
    timeCompleted: row.time_completed ?? undefined,
  })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const create: Interface["create"] = Effect.fn("WorkflowRun.create")(function* (input) {
      const runID = Identifier.ascending("workflowRun") as WorkflowAsset.WorkflowRunID
      const now = Date.now()

      yield* db
        .insert(WorkflowRunTable)
        .values({
          id: runID,
          session_id: input.sessionID,
          workflow_name: input.workflow.name,
          workflow_revision: input.workflow.revision,
          status: "pending",
          time_created: now,
          time_updated: now,
        })
        .run()
        .pipe(Effect.orDie)

      // Seed initial step runs
      const stepRows: Array<typeof WorkflowStepRunTable.$inferInsert> = []
      const steps = input.workflow.steps

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]
        const stepRunID = Identifier.ascending("workflowStep") as WorkflowAsset.StepRunID
        // First step in list or steps with no predecessors start ready
        const isEntry = i === 0
        stepRows.push({
          id: stepRunID,
          run_id: runID,
          step_id: step.id,
          agent_id: step.agent || "default",
          status: isEntry ? "ready" : "pending",
          attempt: 1,
          input: step.input ? JSON.stringify(step.input) : undefined,
          time_created: now,
        })
      }

      if (stepRows.length > 0) {
        for (const row of stepRows) {
          yield* db.insert(WorkflowStepRunTable).values(row).run().pipe(Effect.orDie)
        }
      }

      return new WorkflowAsset.WorkflowRunInfo({
        id: runID,
        sessionID: input.sessionID,
        workflowName: input.workflow.name,
        workflowRevision: input.workflow.revision,
        status: "pending",
        timeCreated: now,
        timeUpdated: now,
      })
    })

    const get: Interface["get"] = Effect.fn("WorkflowRun.get")(function* (runID) {
      const row = yield* db
        .select()
        .from(WorkflowRunTable)
        .where(eq(WorkflowRunTable.id, runID))
        .get()
        .pipe(Effect.orDie)

      if (!row) {
        return yield* new WorkflowNotFoundError({ runID })
      }
      return rowToRunInfo(row)
    })

    const getBySession: Interface["getBySession"] = Effect.fn("WorkflowRun.getBySession")(function* (sessionID) {
      const row = yield* db
        .select()
        .from(WorkflowRunTable)
        .where(eq(WorkflowRunTable.session_id, sessionID))
        .orderBy(desc(WorkflowRunTable.time_created))
        .get()
        .pipe(Effect.orDie)

      if (!row) return undefined
      return rowToRunInfo(row)
    })

    const getSteps: Interface["getSteps"] = Effect.fn("WorkflowRun.getSteps")(function* (runID) {
      const rows = yield* db
        .select()
        .from(WorkflowStepRunTable)
        .where(eq(WorkflowStepRunTable.run_id, runID))
        .orderBy(WorkflowStepRunTable.time_created)
        .all()
        .pipe(Effect.orDie)

      return rows.map(rowToStepInfo)
    })

    const findReadySteps: Interface["findReadySteps"] = Effect.fn("WorkflowRun.findReadySteps")(function* (
      runID,
      stepsDef,
    ) {
      const allStepRuns = yield* getSteps(runID)
      // Group latest step run by step_id
      const latestStepRuns = new Map<string, WorkflowAsset.StepRunInfo>()
      for (const stepRun of allStepRuns) {
        const existing = latestStepRuns.get(stepRun.stepId)
        if (!existing || existing.attempt < stepRun.attempt) {
          latestStepRuns.set(stepRun.stepId, stepRun)
        }
      }

      // Build predecessor map from stepsDef
      const predecessorsMap = new Map<string, string[]>()
      for (const def of stepsDef) {
        if (!predecessorsMap.has(def.id)) {
          predecessorsMap.set(def.id, [])
        }
        if (def.next && def.next !== "END") {
          const list = predecessorsMap.get(def.next) ?? []
          list.push(def.id)
          predecessorsMap.set(def.next, list)
        }
        if (def.branches) {
          for (const branchTarget of Object.values(def.branches)) {
            if (branchTarget !== "END") {
              const list = predecessorsMap.get(branchTarget) ?? []
              list.push(def.id)
              predecessorsMap.set(branchTarget, list)
            }
          }
        }
        if (def.parallel) {
          for (const parallelTarget of def.parallel) {
            const list = predecessorsMap.get(parallelTarget) ?? []
            list.push(def.id)
            predecessorsMap.set(parallelTarget, list)
          }
        }
      }

      const readyList: WorkflowAsset.StepRunInfo[] = []
      for (const def of stepsDef) {
        const stepRun = latestStepRuns.get(def.id)
        if (!stepRun) continue

        if (stepRun.status === "ready") {
          readyList.push(stepRun)
          continue
        }

        if (stepRun.status === "pending") {
          const preds = predecessorsMap.get(def.id) ?? []
          if (preds.length === 0) {
            // Entry step without predecessors -> ready
            yield* db
              .update(WorkflowStepRunTable)
              .set({ status: "ready" })
              .where(eq(WorkflowStepRunTable.id, stepRun.id))
              .run()
              .pipe(Effect.orDie)
            readyList.push(
              new WorkflowAsset.StepRunInfo({
                ...stepRun,
                status: "ready",
              }),
            )
            continue
          }

          // Check if all predecessors are completed (or completed/failed if continue)
          const allPredsSatisfied = preds.every((predId) => {
            const predRun = latestStepRuns.get(predId)
            if (!predRun) return false
            if (predRun.status === "completed") return true
            // If predecessor failed and failurePolicy is continue, treat as satisfied (partial branch)
            const predDef = stepsDef.find((s) => s.id === predId)
            if (predRun.status === "failed" && predDef?.failurePolicy === "continue") {
              return true
            }
            return false
          })

          if (allPredsSatisfied) {
            yield* db
              .update(WorkflowStepRunTable)
              .set({ status: "ready" })
              .where(eq(WorkflowStepRunTable.id, stepRun.id))
              .run()
              .pipe(Effect.orDie)
            readyList.push(
              new WorkflowAsset.StepRunInfo({
                ...stepRun,
                status: "ready",
              }),
            )
          }
        }
      }

      return readyList
    })

    const startStep: Interface["startStep"] = Effect.fn("WorkflowRun.startStep")(function* (stepRunID) {
      const now = Date.now()
      const stepRun = yield* db
        .select()
        .from(WorkflowStepRunTable)
        .where(eq(WorkflowStepRunTable.id, stepRunID))
        .get()
        .pipe(Effect.orDie)

      if (!stepRun) {
        return yield* new StepNotFoundError({ stepRunID })
      }

      yield* db
        .update(WorkflowStepRunTable)
        .set({
          status: "running",
          time_started: now,
        })
        .where(eq(WorkflowStepRunTable.id, stepRunID))
        .run()
        .pipe(Effect.orDie)

      // Also ensure parent run is in running state
      yield* db
        .update(WorkflowRunTable)
        .set({
          status: "running",
          current_step_id: stepRun.step_id,
          time_updated: now,
        })
        .where(eq(WorkflowRunTable.id, stepRun.run_id))
        .run()
        .pipe(Effect.orDie)

      return rowToStepInfo({
        ...stepRun,
        status: "running",
        time_started: now,
      })
    })

    const settleStep: Interface["settleStep"] = Effect.fn("WorkflowRun.settleStep")(function* (
      stepRunID,
      result,
    ) {
      const now = Date.now()
      const stepRun = yield* db
        .select()
        .from(WorkflowStepRunTable)
        .where(eq(WorkflowStepRunTable.id, stepRunID))
        .get()
        .pipe(Effect.orDie)

      if (!stepRun) {
        return yield* new StepNotFoundError({ stepRunID })
      }

      const outputStr = result.output !== undefined ? JSON.stringify(result.output) : null

      yield* db
        .update(WorkflowStepRunTable)
        .set({
          status: result.status,
          output: outputStr,
          error: result.error ?? null,
          time_completed: now,
        })
        .where(eq(WorkflowStepRunTable.id, stepRunID))
        .run()
        .pipe(Effect.orDie)

      return rowToStepInfo({
        ...stepRun,
        status: result.status,
        output: outputStr,
        error: result.error ?? null,
        time_completed: now,
      })
    })

    const retryStep: Interface["retryStep"] = Effect.fn("WorkflowRun.retryStep")(function* (stepRunID) {
      const now = Date.now()
      const prevStepRun = yield* db
        .select()
        .from(WorkflowStepRunTable)
        .where(eq(WorkflowStepRunTable.id, stepRunID))
        .get()
        .pipe(Effect.orDie)

      if (!prevStepRun) {
        return yield* new StepNotFoundError({ stepRunID })
      }
      const newStepRunID = Identifier.ascending("workflowStep") as WorkflowAsset.StepRunID
      const nextAttempt = prevStepRun.attempt + 1

      yield* db
        .insert(WorkflowStepRunTable)
        .values({
          id: newStepRunID,
          run_id: prevStepRun.run_id,
          step_id: prevStepRun.step_id,
          agent_id: prevStepRun.agent_id,
          status: "ready",
          attempt: nextAttempt,
          input: prevStepRun.input,
          time_created: now,
        })
        .run()
        .pipe(Effect.orDie)

      return new WorkflowAsset.StepRunInfo({
        id: newStepRunID,
        runId: prevStepRun.run_id,
        stepId: prevStepRun.step_id,
        agentId: prevStepRun.agent_id,
        status: "ready",
        attempt: nextAttempt,
        input: prevStepRun.input ? (JSON.parse(String(prevStepRun.input)) as unknown) : undefined,
        timeCreated: now,
      })
    })

    const cancelRun: Interface["cancelRun"] = Effect.fn("WorkflowRun.cancelRun")(function* (runID, reason) {
      const now = Date.now()
      // Cancel all unfinished steps
      yield* db
        .update(WorkflowStepRunTable)
        .set({
          status: "cancelled",
          time_completed: now,
        })
        .where(
          and(
            eq(WorkflowStepRunTable.run_id, runID),
            eq(WorkflowStepRunTable.status, "running"),
          ),
        )
        .run()
        .pipe(Effect.orDie)

      yield* db
        .update(WorkflowStepRunTable)
        .set({
          status: "cancelled",
          time_completed: now,
        })
        .where(
          and(
            eq(WorkflowStepRunTable.run_id, runID),
            eq(WorkflowStepRunTable.status, "ready"),
          ),
        )
        .run()
        .pipe(Effect.orDie)

      yield* db
        .update(WorkflowStepRunTable)
        .set({
          status: "cancelled",
          time_completed: now,
        })
        .where(
          and(
            eq(WorkflowStepRunTable.run_id, runID),
            eq(WorkflowStepRunTable.status, "pending"),
          ),
        )
        .run()
        .pipe(Effect.orDie)

      yield* db
        .update(WorkflowRunTable)
        .set({
          status: "cancelled",
          error: reason ?? null,
          time_completed: now,
          time_updated: now,
        })
        .where(eq(WorkflowRunTable.id, runID))
        .run()
        .pipe(Effect.orDie)

      return yield* get(runID)
    })

    const completeRun: Interface["completeRun"] = Effect.fn("WorkflowRun.completeRun")(function* (
      runID,
      partial,
    ) {
      const now = Date.now()
      const finalStatus = partial ? "partial_success" : "completed"

      yield* db
        .update(WorkflowRunTable)
        .set({
          status: finalStatus,
          time_completed: now,
          time_updated: now,
        })
        .where(eq(WorkflowRunTable.id, runID))
        .run()
        .pipe(Effect.orDie)

      return yield* get(runID)
    })

    const failRun: Interface["failRun"] = Effect.fn("WorkflowRun.failRun")(function* (runID, error) {
      const now = Date.now()

      // Cancel any remaining steps
      yield* db
        .update(WorkflowStepRunTable)
        .set({
          status: "cancelled",
          time_completed: now,
        })
        .where(
          and(
            eq(WorkflowStepRunTable.run_id, runID),
            eq(WorkflowStepRunTable.status, "running"),
          ),
        )
        .run()
        .pipe(Effect.orDie)

      yield* db
        .update(WorkflowRunTable)
        .set({
          status: "failed",
          error,
          time_completed: now,
          time_updated: now,
        })
        .where(eq(WorkflowRunTable.id, runID))
        .run()
        .pipe(Effect.orDie)

      return yield* get(runID)
    })

    return Service.of({
      create,
      get,
      getBySession,
      getSteps,
      findReadySteps,
      startStep,
      settleStep,
      retryStep,
      cancelRun,
      completeRun,
      failRun,
    } satisfies Interface)
  }),
)

export const locationLayer = layer
export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))
