export * as ScheduleExecution from "./schedule-execution.js"

import { eq } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Option, Stream } from "effect"
import { createHash, randomUUID } from "node:crypto"
import { makeGlobalNode } from "@omnixa/util/effect/app-node"
import { Schedule } from "@omnixa/schema/schedule"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { DelegationExecution } from "../delegation/execution.js"
import { DelegationFold } from "../delegation/fold.js"
import { DelegationService } from "../delegation/service.js"
import { Job } from "../job.js"
import { MetaAgentService } from "../meta-agent/service.js"
import { Permission } from "../permission.js"
import { Session } from "../session.js"
import { SessionExecution } from "./execution.js"
import { SessionGoal } from "./goal.js"
import { SessionInputResult } from "./input-result.js"
import { serializedSelection } from "./session.js"
import { ScheduleError } from "./schedule-rule.js"
import { SchedulerCore } from "./schedule-core.js"
import { ScheduleService } from "./schedule-service.js"
import { ScheduleTask } from "./schedule-task.js"
import { ScheduleTable } from "./schedule.sql.js"
import { TaskTable } from "./sql.js"
import { SessionTask } from "./task.js"

const terminal = (status: Schedule.OccurrenceStatus) =>
  status === "completed" ||
  status === "failed" ||
  status === "cancelled" ||
  status === "blocked" ||
  status === "skipped"

const sourceOf = (run: Schedule.Occurrence) =>
  new Permission.OperationSource({
    type: "operation",
    sessionID: run.sessionID,
    operationID: run.operationID,
  })

export type Interface = Effect.Success<ReturnType<typeof make>>
export class Service extends Context.Service<Service, Interface>()("@omnixa/ScheduleExecution") {}

const make = Effect.fn("ScheduleExecution.make")(function* () {
  const database = yield* Database.Service
  const db = database.db
  const bus = yield* Bus.Service
  const schedules = yield* ScheduleService.Service
  const sessions = yield* Session.Service
  const execution = yield* SessionExecution.Service
  const tasks = yield* SessionTask.Service
  const goals = yield* SessionGoal.Service
  const delegations = yield* DelegationExecution.Service
  const delegationState = yield* DelegationService.Service
  const metas = yield* MetaAgentService.Service
  const jobs = yield* Job.Service
  const bootAt = (yield* DateTime.nowAsDate).getTime()
  const owner = `schedule-host:${randomUUID()}`

  const requireRule = Effect.fnUntraced(function* (id: Schedule.ID, revision?: number) {
    const rule = yield* schedules.getRule(id)
    if (!rule) return yield* new ScheduleError({ scheduleID: id, reason: "missing", message: "Schedule not found" })
    if (revision !== undefined && rule.revision !== revision)
      return yield* new ScheduleError({
        scheduleID: id,
        reason: "stale_revision",
        message: "The rule changed; reload its current revision",
      })
    return rule
  })

  const reconcile = Effect.fn("ScheduleExecution.reconcile")(function* (id: Schedule.OccurrenceID) {
    const run = yield* schedules.occurrence(id)
    if (!run || (terminal(run.status) && run.sourceSettlement !== "pending")) return run
    if (run.snapshot.target?.policy !== "legacy_child") {
      const operation = yield* sessions.reconcileTaskOperation({
        sessionID: run.sessionID,
        operationID: run.operationID,
      })
      if (!operation) return run
      const status =
        operation.phase === "settled"
          ? "completed"
          : operation.phase === "superseded"
            ? "cancelled"
            : operation.phase === "failed" || operation.phase === "cancelled" || operation.phase === "blocked"
              ? operation.phase
              : undefined
      if (status)
        return yield* schedules.advanceOccurrence(
          id,
          new Schedule.OccurrenceChange({
            status,
            result: operation.result,
            output: operation.result?.text ?? operation.error?.message,
            sourceSettlement:
              operation.sourceSettlement === "settled"
                ? status === "cancelled"
                  ? "cancelled"
                  : "completed"
                : (operation.sourceSettlement ?? (operation.taskRevision === undefined ? "unavailable" : "pending")),
            error: operation.error ? new Schedule.ErrorInfo(operation.error) : null,
            completedAt: run.completedAt ?? (yield* DateTime.nowAsDate).getTime(),
          }),
        )
      // The operation owns an unknown outcome; inbox processing only proves delivery.
      if (operation.phase === "recovery_required") {
        if (run.status === "recovery_required") return run
        return yield* schedules.advanceOccurrence(
          id,
          new Schedule.OccurrenceChange({
            status: "recovery_required",
            error: operation.error ? new Schedule.ErrorInfo(operation.error) : null,
          }),
        )
      }
      if (operation.cancelIntent || run.cancelRequested)
        return yield* schedules.advanceOccurrence(
          id,
          new Schedule.OccurrenceChange({
            status: "recovery_required",
            error: new Schedule.ErrorInfo({
              code: "cancellation_pending",
              message: "The original input cancellation has not reached its terminal boundary",
            }),
          }),
        )
      if (!operation.admission || !operation.targetSessionID) return run
      const outcome = yield* SessionInputResult.read(db, {
        sessionID: operation.targetSessionID,
        inputID: operation.inputID,
      }).pipe(Effect.orDie)
      return yield* schedules.advanceOccurrence(
        id,
        new Schedule.OccurrenceChange({
          targetSessionID: operation.targetSessionID,
          taskID: operation.taskID,
          taskRevision: operation.taskRevision,
          admission:
            run.admission ??
            new Schedule.Admission({
              targetSessionID: operation.targetSessionID,
              inputID: operation.inputID,
              operationID: operation.operationID,
              taskID: operation.taskID,
              taskRevision: operation.taskRevision,
              admittedAt: operation.updatedAt,
            }),
          status:
            outcome.status === "processing"
              ? "running"
              : outcome.status === "pending"
                ? "admitted"
                : "recovery_required",
          error:
            outcome.status === "pending" || outcome.status === "processing"
              ? null
              : new Schedule.ErrorInfo({
                  code: "session_input_unverified",
                  message: "The original Task operation has no verified terminal receipt",
                }),
        }),
      )
    }
    if (!run.targetSessionID) return run
    if (run.receipt) {
      const state = yield* delegationState.foldState(run.receipt.delegationID).pipe(Effect.orDie)
      const delivery = state?.deliveries.get(
        DelegationFold.deliveryKey(
          run.receipt.turnID,
          run.receipt.participantID,
          run.receipt.deliveryOrigin,
          run.receipt.senderParticipantID,
        ),
      )
      if (
        delivery &&
        delivery.attempt === run.receipt.attempt &&
        ["completed", "failed", "cancelled", "recovery_required"].includes(delivery.status)
      ) {
        const settled = yield* delegations.wait(run.receipt).pipe(Effect.orDie)
        const outcome = yield* SessionInputResult.read(db, {
          sessionID: run.targetSessionID,
          inputID: run.inputID,
        }).pipe(Effect.orDie)
        return yield* schedules.advanceOccurrence(
          id,
          new Schedule.OccurrenceChange({
            status: settled.status,
            output: settled.text,
            sourceSettlement: settled.sourceSettlement ?? "pending",
            result: new SessionTask.OperationResultRef({
              sessionID: run.targetSessionID,
              inputID: run.inputID,
              messageIDs: outcome.status === "completed" ? [outcome.assistant.id] : undefined,
              sharedInputs: outcome.sharedInputs,
              resultEventID: outcome.resultEventID,
              text: settled.text,
              digest: SessionTask.OperationDigest.make(createHash("sha256").update(settled.text).digest("hex")),
            }),
            completedAt:
              settled.status === "recovery_required"
                ? undefined
                : (run.completedAt ?? (yield* DateTime.nowAsDate).getTime()),
            error:
              settled.status === "failed" || settled.status === "recovery_required"
                ? new Schedule.ErrorInfo({ code: `delegation_${settled.status}`, message: settled.text })
                : null,
          }),
        )
      }
    }
    if (run.cancelRequested)
      return yield* schedules.advanceOccurrence(
        id,
        new Schedule.OccurrenceChange({
          status: "recovery_required",
          error: new Schedule.ErrorInfo({
            code: "cancellation_pending",
            message: "The original child cancellation has not reached its terminal receipt",
          }),
        }),
      )
    const outcome = yield* SessionInputResult.read(db, { sessionID: run.targetSessionID, inputID: run.inputID }).pipe(
      Effect.orDie,
    )
    if (outcome.status === "pending" || outcome.status === "processing") {
      if (outcome.status === "processing" && run.status !== "running")
        return yield* schedules.advanceOccurrence(id, new Schedule.OccurrenceChange({ status: "running" }))
      return run
    }
    if (outcome.status === "missing" || outcome.status === "unverified")
      return yield* schedules.advanceOccurrence(
        id,
        new Schedule.OccurrenceChange({
          status: "recovery_required",
          error: new Schedule.ErrorInfo({
            code: "session_input_unverified",
            message: "The admitted input has no verified terminal receipt",
          }),
        }),
      )
    return run
  })

  const observe = Effect.fn("ScheduleExecution.observe")(function* (run: Schedule.Occurrence) {
    if (!run.targetSessionID || (terminal(run.status) && run.sourceSettlement !== "pending")) return
    yield* jobs.start({
      id: `schedule.observe:${run.id}`,
      type: "schedule",
      title: run.snapshot.content,
      metadata: { sessionID: run.sessionID, occurrenceID: run.id },
      run: bus.log({ aggregateID: run.targetSessionID, follow: true }).pipe(
        Stream.merge(bus.log({ aggregateID: run.sessionID, follow: true })),
        Stream.merge(run.receipt ? bus.log({ aggregateID: run.receipt.delegationID, follow: true }) : Stream.empty),
        Stream.mapEffect(() => reconcile(run.id)),
        Stream.filter(
          (current) => current !== undefined && terminal(current.status) && current.sourceSettlement !== "pending",
        ),
        Stream.runHead,
        Effect.map((current) =>
          Option.isSome(current) ? (current.value?.output ?? "Schedule execution settled") : "Session event log closed",
        ),
        Effect.orDie,
      ),
    })
  })

  const failRun = Effect.fnUntraced(function* (run: Schedule.Occurrence, error: Error) {
    const current = yield* schedules.occurrence(run.id)
    if (!current || terminal(current.status)) return
    const code = "_tag" in error ? String(error._tag) : error.name
    if (
      current.snapshot.target?.policy !== "legacy_child" &&
      current.snapshot.kind !== "reminder" &&
      current.snapshot.kind !== "goal"
    ) {
      const operation = yield* sessions.reconcileTaskOperation({
        sessionID: current.sessionID,
        operationID: current.operationID,
      })
      if (operation && ["settled", "failed", "cancelled", "blocked", "superseded"].includes(operation.phase)) {
        yield* reconcile(current.id)
        return
      }
      if (operation) {
        yield* schedules.advanceOccurrence(
          current.id,
          new Schedule.OccurrenceChange({
            status: "recovery_required",
            error: new Schedule.ErrorInfo({ code, message: error.message }),
          }),
        )
        yield* observe((yield* schedules.occurrence(current.id)) ?? current)
        return
      }
    }
    const task =
      !current.admission &&
      current.snapshot.target?.policy === "legacy_child" &&
      current.taskID &&
      current.taskRevision !== undefined
        ? yield* tasks
            .patch(
              {
                sessionID: current.sessionID,
                id: current.taskID,
                status: current.cancelRequested ? "cancelled" : "failed",
                outputDigest: error.message,
                expectedRevision: current.taskRevision,
                expect: ["in_progress"],
              },
              { settle: { source: sourceOf(current), revision: current.taskRevision } },
            )
            .pipe(
              Effect.catchTag("SessionTask.TaskWriteError", () =>
                tasks
                  .releaseClaim({
                    sessionID: current.sessionID,
                    id: current.taskID ?? "",
                    revision: current.taskRevision ?? 0,
                    source: sourceOf(current),
                  })
                  .pipe(Effect.as(undefined)),
              ),
            )
        : undefined
    yield* schedules.advanceOccurrence(
      run.id,
      new Schedule.OccurrenceChange({
        status: current.admission ? "recovery_required" : current.cancelRequested ? "cancelled" : "failed",
        error: new Schedule.ErrorInfo({ code, message: error.message }),
        ...(current.admission || current.snapshot.kind === "reminder" || current.snapshot.kind === "goal"
          ? {}
          : {
              sourceSettlement: task
                ? current.cancelRequested
                  ? "cancelled"
                  : "completed"
                : current.taskRevision === undefined
                  ? "unavailable"
                  : "conflict",
            }),
        ...(current.admission ? {} : { completedAt: (yield* DateTime.nowAsDate).getTime() }),
      }),
    )
  })

  const prepare = Effect.fn("ScheduleExecution.prepare")(function* (run: Schedule.Occurrence) {
    const current = yield* schedules.occurrence(run.id)
    if (!current || terminal(current.status)) return "Schedule occurrence ended before admission"
    if (current.cancelRequested && !current.admission) {
      yield* schedules.advanceOccurrence(
        current.id,
        new Schedule.OccurrenceChange({ status: "cancelled", completedAt: (yield* DateTime.nowAsDate).getTime() }),
      )
      return "Schedule occurrence cancelled before admission"
    }
    if (current.snapshot.kind === "reminder") {
      const delivered = yield* schedules.deliverOccurrence(current.id, (yield* DateTime.nowAsDate).getTime())
      return delivered.status
    }
    if (current.snapshot.kind === "goal" && current.snapshot.target?.policy === "goal") {
      const target = current.snapshot.target
      const result = yield* goals.scheduleWake({
        sessionID: current.sessionID,
        goalID: SessionGoal.ID.make(target.goalID),
        scheduleID: current.scheduleID,
        occurrenceID: current.id,
        revision: current.ruleRevision,
        userResume: target.resumeAuthorization,
      })
      if (result.state === "admitted") yield* execution.wake(current.sessionID)
      yield* schedules.advanceOccurrence(
        current.id,
        new Schedule.OccurrenceChange({
          status:
            result.state === "admitted" || result.state === "waiting"
              ? "completed"
              : result.state === "blocked"
                ? "blocked"
                : "skipped",
          goalID: target.goalID,
          roundID: result.round?.roundID,
          goalInputID: result.round?.inputID,
          output: result.state,
          completedAt: (yield* DateTime.nowAsDate).getTime(),
          error: result.reason ? new Schedule.ErrorInfo({ code: result.reason, message: result.reason }) : undefined,
        }),
      )
      return result.state
    }
    if (current.admission) {
      yield* observe(current)
      return "The saved input is being observed"
    }
    if (current.snapshot.target?.policy === "legacy_child") {
      yield* delegations.internalParticipant(current.id)
      const admitted = (yield* schedules.occurrence(current.id)) ?? current
      yield* observe(admitted)
      return "The scheduled child input was admitted"
    }
    const target = current.snapshot.target
    if (!target || target.policy === "goal")
      return yield* new ScheduleError({
        scheduleID: current.scheduleID,
        reason: "invalid_target",
        message: "An execution target is required",
      })
    const rule = yield* requireRule(current.scheduleID)
    const savedOperation = yield* tasks.operation({ sessionID: current.sessionID, operationID: current.operationID })
    const bound =
      target.policy === "new_once" && current.targetSessionID
        ? yield* sessions.get(current.targetSessionID).pipe(Effect.option)
        : Option.none()
    const request =
      savedOperation?.request ??
      new SessionTask.OperationRequest({
        operationID: current.operationID,
        inputID: current.inputID,
        taskID: rule.taskID,
        target:
          target.policy === "existing"
            ? new SessionTask.OperationExistingRootTarget({ type: "existing_root", sessionID: target.sessionID })
            : target.policy === "new_once" && Option.isSome(bound)
              ? new SessionTask.OperationExistingRootTarget({ type: "existing_root", sessionID: bound.value.id })
              : target.template,
        description: current.snapshot.content,
        prompt: current.snapshot.content,
        delivery: current.snapshot.executionPolicy.delivery,
        resume: true,
      })
    const actor = current.snapshot.sourceAgent ?? (yield* metas.assertCoordination(current.sessionID)).selection.agent
    if (!actor)
      return yield* new ScheduleError({
        scheduleID: current.scheduleID,
        reason: "invalid_target",
        message: "The source has no effective Meta selection",
      })
    const options = {
      source: new SessionTask.OperationScheduleSource({
        type: "schedule_occurrence",
        sessionID: current.sessionID,
        agent: actor,
        scheduleID: current.scheduleID,
        occurrenceID: current.id,
        revision: current.ruleRevision,
      }),
      targetSessionID: current.targetSessionID,
    }
    const operation = yield* sessions.dispatchTask({ sessionID: current.sessionID, request }, options)
    if (
      operation.inputID !== current.inputID ||
      (current.targetSessionID && operation.targetSessionID !== current.targetSessionID)
    )
      return yield* new ScheduleError({
        scheduleID: current.scheduleID,
        reason: "invalid_target",
        message: "The operation has a different reserved target or input identity",
      })
    if (operation.taskID && !rule.taskID) yield* schedules.bindTask(rule.id, operation.taskID)
    const admission =
      operation.admission && operation.targetSessionID
        ? new Schedule.Admission({
            targetSessionID: operation.targetSessionID,
            inputID: operation.inputID,
            operationID: operation.operationID,
            taskID: operation.taskID,
            taskRevision: operation.taskRevision,
            admittedAt: operation.updatedAt,
          })
        : undefined
    const state =
      operation.phase === "failed" || operation.phase === "cancelled" || operation.phase === "blocked"
        ? operation.phase
        : admission
          ? "admitted"
          : "recovery_required"
    const admitted = yield* schedules.advanceOccurrence(
      current.id,
      new Schedule.OccurrenceChange({
        status: state,
        targetSessionID: operation.targetSessionID,
        taskID: operation.taskID,
        taskRevision: operation.taskRevision,
        admission,
        error: operation.error
          ? new Schedule.ErrorInfo(operation.error)
          : state === "recovery_required"
            ? new Schedule.ErrorInfo({
                code: "operation_preparation_pending",
                message: "The original Task operation has not completed preparation",
              })
            : undefined,
      }),
    )
    if (!terminal(admitted.status)) yield* observe(admitted)
    return state
  })

  const start = Effect.fn("ScheduleExecution.start")(function* (run: Schedule.Occurrence) {
    const row = yield* db
      .select({ attempts: ScheduleTable.attempts })
      .from(ScheduleTable)
      .where(eq(ScheduleTable.id, run.scheduleID))
      .get()
      .pipe(Effect.orDie)
    yield* jobs.start({
      id: `schedule.prepare:${run.id}:${row?.attempts ?? 0}`,
      type: "schedule",
      title: run.snapshot.content,
      metadata: { sessionID: run.sessionID, occurrenceID: run.id },
      run: prepare(run).pipe(Effect.tapError((error) => failRun(run, error))),
    })
  })

  const trigger = Effect.fn("ScheduleExecution.trigger")(function* (id: Schedule.ID, time: number) {
    const rule = yield* schedules.getRule(id)
    if (!rule) return
    const existing = rule.activeOccurrenceID ? yield* schedules.occurrence(rule.activeOccurrenceID) : undefined
    if (existing) {
      if (existing.snapshot.kind === "reminder" && existing.status === "claimed") yield* start(existing)
      return
    }
    const run = yield* schedules.claimOccurrence(
      id,
      time,
      owner,
      false,
      rule.createdAt <= bootAt && (rule.nextDueAt ?? rule.dueAt) < bootAt,
    )
    if (!run) return
    if (run.caughtUp && run.snapshot.executionPolicy.missed === "skip") {
      yield* schedules.advanceOccurrence(
        run.id,
        new Schedule.OccurrenceChange({
          status: "skipped",
          completedAt: time,
          error: new Schedule.ErrorInfo({
            code: "missed_window",
            message: "The configured missed occurrence window was skipped",
          }),
        }),
      )
      return
    }
    yield* start(run)
  })

  const makeCore = Effect.fn("ScheduleExecution.makeCore")(function* () {
    return yield* SchedulerCore.make({
      scan: () =>
        schedules.listRules().pipe(
          Effect.flatMap((rules) =>
            Effect.forEach(rules, (rule) =>
              Effect.gen(function* () {
                const active = rule.activeOccurrenceID
                  ? yield* schedules.occurrence(rule.activeOccurrenceID)
                  : undefined
                const retry = active?.snapshot.kind === "reminder" && active.status === "claimed"
                const row = retry
                  ? yield* db
                      .select({ next: ScheduleTable.next_attempt_at })
                      .from(ScheduleTable)
                      .where(eq(ScheduleTable.id, rule.id))
                      .get()
                      .pipe(Effect.orDie)
                  : undefined
                return {
                  id: rule.id,
                  status: rule.status === "pending" && (!active || retry) ? "pending" : "inactive",
                  scheduledAt: rule.nextDueAt,
                  nextDueAt: retry ? (row?.next ?? active?.scheduledAt) : rule.nextDueAt,
                  recurrence: null,
                }
              }),
            ),
          ),
        ),
      recover: () => Effect.void,
      trigger: (id, time) => trigger(id, time).pipe(Effect.orDie),
    })
  })

  const recover = Effect.fn("ScheduleExecution.recover")(function* () {
    const time = (yield* DateTime.nowAsDate).getTime()
    const sources = yield* db.select({ sessionID: TaskTable.session_id }).from(TaskTable).all().pipe(Effect.orDie)
    for (const sessionID of new Set(sources.map((source) => source.sessionID)))
      yield* db
        .transaction((tx) => ScheduleTask.sync(tx, { sessionID, now: time }).pipe(Effect.orDie))
        .pipe(Effect.orDie)
    for (const run of yield* schedules.unsettledOccurrences()) {
      if (run.snapshot.kind === "reminder" || run.snapshot.kind === "goal") {
        yield* start(run)
        continue
      }
      if (run.snapshot.target?.policy === "legacy_child" && !run.receipt) {
        yield* start(run)
        continue
      }
      const current = (yield* reconcile(run.id)) ?? run
      if (terminal(current.status) && current.sourceSettlement !== "pending") continue
      if (current.admission || current.receipt) {
        yield* observe(current)
        continue
      }
      yield* start(current)
    }
  })

  return {
    makeCore,
    trigger,
    recover,
    reconcile,
    create: Effect.fn("ScheduleExecution.create")(function* (input: Schedule.Create) {
      yield* sessions.get(input.sessionID)
      const selection =
        input.kind !== "reminder" ? yield* metas.assertCoordination(input.sessionID, { tool: "task" }) : undefined
      return yield* schedules.createRule(input, selection?.selection.agent)
    }),
    edit: Effect.fn("ScheduleExecution.edit")(function* (id: Schedule.ID, input: Schedule.Edit) {
      const rule = yield* requireRule(id, input.expectedRevision)
      if (rule.kind !== "reminder" && rule.target?.policy !== "legacy_child")
        yield* metas.assertCoordination(rule.sessionID, { tool: "task" })
      return yield* schedules.editRule(id, input)
    }),
    runOnce: Effect.fn("ScheduleExecution.runOnce")(function* (id: Schedule.ID, revision: number) {
      const rule = yield* requireRule(id, revision)
      if (rule.kind !== "reminder" && rule.target?.policy !== "legacy_child")
        yield* metas.assertCoordination(rule.sessionID, { tool: "task" })
      const run = yield* schedules.claimOccurrence(id, (yield* DateTime.nowAsDate).getTime(), owner, true, false)
      if (!run)
        return yield* new ScheduleError({
          scheduleID: id,
          reason: "overlap",
          message: "The rule is paused or already owns an unresolved occurrence",
        })
      yield* start(run)
      return (yield* schedules.occurrence(run.id)) ?? run
    }),
    cancelRun: Effect.fn("ScheduleExecution.cancelRun")(function* (id: Schedule.OccurrenceID) {
      const run = yield* schedules.occurrence(id)
      if (!run)
        return yield* new ScheduleError({ reason: "occurrence_missing", message: "Schedule occurrence not found" })
      if (terminal(run.status)) return run
      const current = yield* serializedSelection(
        run.sessionID,
        schedules.advanceOccurrence(id, new Schedule.OccurrenceChange({ cancelRequested: true })),
      )
      if (terminal(current.status)) return current
      const operation = yield* tasks.operation({ sessionID: current.sessionID, operationID: current.operationID })
      if (operation) {
        const cancelled = yield* sessions.cancelTaskOperation({
          sessionID: current.sessionID,
          operationID: current.operationID,
        })
        if (!["settled", "failed", "cancelled", "blocked", "superseded"].includes(cancelled.phase))
          return yield* schedules.advanceOccurrence(
            id,
            new Schedule.OccurrenceChange({
              status: "recovery_required",
              error: new Schedule.ErrorInfo({
                code: "cancellation_pending",
                message: "The original input cancellation has not reached its terminal boundary",
              }),
            }),
          )
        yield* jobs.cancel(`schedule.prepare:${current.id}:0`)
        return (yield* reconcile(id)) ?? current
      }
      if (current.receipt) {
        yield* delegations.close({
          delegationID: current.receipt.delegationID,
          reason: "Scheduled occurrence cancelled",
        })
        yield* delegations.wait(current.receipt)
        return (yield* reconcile(id)) ?? current
      }
      yield* jobs.cancel(`schedule.prepare:${current.id}:0`)
      const task =
        current.taskID && current.taskRevision !== undefined
          ? yield* tasks.patch(
              {
                sessionID: current.sessionID,
                id: current.taskID,
                expectedRevision: current.taskRevision,
                status: "cancelled",
                expect: ["in_progress"],
              },
              { settle: { source: sourceOf(current), revision: current.taskRevision } },
            )
          : undefined
      return yield* schedules.advanceOccurrence(
        id,
        new Schedule.OccurrenceChange({
          status: "cancelled",
          sourceSettlement:
            current.snapshot.kind === "reminder" || current.snapshot.kind === "goal"
              ? undefined
              : task
                ? "cancelled"
                : current.taskRevision === undefined
                  ? "unavailable"
                  : "conflict",
          completedAt: (yield* DateTime.nowAsDate).getTime(),
        }),
      )
    }),
  }
})

export const layer = Layer.effect(Service, make())
export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [
    Database.node,
    Bus.node,
    ScheduleService.node,
    Session.node,
    SessionExecution.node,
    SessionTask.node,
    SessionGoal.node,
    DelegationExecution.node,
    DelegationService.node,
    MetaAgentService.node,
    Job.node,
  ],
})

/** The server calls this once after SessionRestart has reconciled original execution ownership. */
export const daemon = Effect.fn("ScheduleExecution.daemon")(function* (
  schedules: Interface,
  options?: { readonly recover?: boolean },
) {
  const events = yield* Bus.Service
  if (options?.recover !== false) yield* schedules.recover()
  const core = yield* schedules.makeCore()
  yield* SchedulerCore.daemon({
    core,
    rearmSignals: events
      .subscribe(Schedule.RuleUpdated)
      .pipe(
        Stream.merge(events.subscribe(Schedule.OccurrenceUpdated)),
        Stream.merge(events.subscribe(Schedule.Updated)),
      ),
  })
})
