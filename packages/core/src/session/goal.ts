export * as SessionGoal from "./goal.js"
export {
  ID,
  Info,
  Ref,
  RoundRef,
  Budget,
  Condition,
  Evidence,
  Accounting,
  Attempt,
  AttemptRef,
  AttemptKind,
  Status,
  PauseReason,
  CreateInput,
  EditInput,
  RevisionInput,
  ConfirmInput,
  Events,
} from "@aigcfroge/schema/session-goal"

import { and, asc, eq } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"
import { SessionGoal } from "@aigcfroge/schema/session-goal"
import { Session } from "@aigcfroge/schema/session"
import { SessionMessage } from "@aigcfroge/schema/session-message"
import { SessionTask } from "@aigcfroge/schema/session-task"
import { Agent } from "@aigcfroge/schema/agent"
import { SessionEvent } from "@aigcfroge/schema/session-event"
import { TokenUsage } from "@aigcfroge/schema/token-usage"
import { Shell } from "@aigcfroge/schema/shell"
import { Event } from "@aigcfroge/schema/event"
import { Identifier } from "@aigcfroge/schema/identifier"
import { makeGlobalNode } from "@aigcfroge/util/effect/app-node"
import { Bus } from "../bus.js"
import { CompositionDigest } from "../composition/digest.js"
import { Database } from "../database/database.js"
import { EventTable } from "../event/sql.js"
import { MetaAgentService } from "../meta-agent/service.js"
import { WorkArtifact } from "./artifact.js"
import { SessionInbox } from "./inbox.js"
import { SessionInputResult } from "./input-result.js"
import { SessionGoalTable, SessionInputResultTable, SessionTable } from "./sql.js"
import { TaskOperation } from "./task-operation.js"

export class GoalError extends Schema.TaggedError<GoalError>()("SessionGoal.Error", {
  sessionID: Session.ID,
  goalID: SessionGoal.ID.pipe(Schema.optionalKey),
  reason: Schema.String,
  message: Schema.String,
}) {}

export class BudgetError extends Schema.TaggedError<BudgetError>()("SessionGoal.BudgetError", {
  sessionID: Session.ID,
  goalID: SessionGoal.ID,
  reason: Schema.String,
}) {}

export interface AdvanceResult {
  readonly state: "admitted" | "waiting" | "blocked" | "skipped"
  readonly reason?: string
  readonly round?: SessionGoal.RoundRef
}

type AttemptInput = {
  readonly sessionID: Session.ID
  readonly assistantMessageID?: SessionMessage.ID
  readonly inputID?: SessionMessage.ID
  readonly kind: SessionGoal.AttemptKind
  readonly attemptID?: string
}

export type Interface = Effect.Success<ReturnType<typeof make>>
export class Service extends Context.Service<Service, Interface>()("@aigcfroge/SessionGoal") {}

const now = DateTime.nowAsDate.pipe(Effect.map((date) => date.getTime()))
const encode = Schema.encodeSync(SessionGoal.Info)
const decode = Schema.decodeUnknownSync(SessionGoal.Info)
const normalizeCommand = (command: string) => command.replace(/\r\n/g, "\n").trim()
const sameOperation = (
  left: SessionTask.OperationReadonlyRef | undefined,
  right: SessionTask.OperationReadonlyRef | undefined,
) => left?.sourceSessionID === right?.sourceSessionID && left?.operationID === right?.operationID

const digest = (value: unknown) => SessionGoal.Digest.make(CompositionDigest.computeDigest(value))
const elapsed = (goal: SessionGoal.Info, time: number) =>
  goal.activeMilliseconds + (goal.activeSince === undefined ? 0 : Math.max(0, time - goal.activeSince))

function count(attempts: readonly SessionGoal.Attempt[], kind: SessionGoal.AttemptKind): SessionGoal.Count {
  const selected = attempts.filter((attempt) => attempt.kind === kind)
  return {
    steps:
      kind === "coordinator" || kind === "worker"
        ? new Set(
            selected.flatMap((attempt) =>
              attempt.assistantMessageID ? [attempt.sessionID + ":" + attempt.assistantMessageID] : [],
            ),
          ).size
        : 0,
    attempts: selected.length,
    recordedTokens: selected.reduce((sum, attempt) => sum + (attempt.usage ? TokenUsage.total(attempt.usage) : 0), 0),
    sharedTokens: selected.reduce(
      (sum, attempt) =>
        sum +
        (attempt.usage && new Set(attempt.rounds.map((round) => round.goalID)).size > 1
          ? TokenUsage.total(attempt.usage)
          : 0),
      0,
    ),
    unknownAttempts: selected.filter((attempt) => attempt.settledAt !== undefined && attempt.usage === undefined)
      .length,
    pendingAttempts: selected.filter((attempt) => attempt.settledAt === undefined).length,
  }
}

function evidenceDigest(evidence: readonly SessionGoal.Evidence[]) {
  return digest(
    evidence
      .toSorted((left, right) => left.id.localeCompare(right.id))
      .map((item) => ({
        ...Schema.encodeSync(SessionGoal.Evidence)(item),
        acceptedRevisions: [],
      })),
  )
}

function satisfies(condition: SessionGoal.Condition, evidence: SessionGoal.Evidence, revision?: number) {
  if (condition.id !== evidence.conditionID || condition.kind !== evidence.kind) return false
  if (revision !== undefined && evidence.revision !== revision && !evidence.acceptedRevisions.includes(revision))
    return false
  if (
    condition.operation &&
    !(evidence.operations ?? (evidence.operation ? [evidence.operation] : [])).some((operation) =>
      sameOperation(condition.operation, operation),
    )
  )
    return false
  if (condition.kind === "command_result" && evidence.kind === "command_result")
    return (
      normalizeCommand(condition.command) === normalizeCommand(evidence.result.command) &&
      path.normalize(condition.cwd) === path.normalize(evidence.result.cwd) &&
      condition.exit === evidence.result.exit &&
      !evidence.result.timeout &&
      evidence.result.signal === undefined &&
      condition.outputIncludes.every((expected) => evidence.outputIncludes.includes(expected)) &&
      (condition.sourceSnapshot === undefined || condition.sourceSnapshot === evidence.producer.sourceSnapshot) &&
      (condition.producer === undefined ||
        (condition.producer.sessionID === evidence.producer.sessionID &&
          condition.producer.assistantMessageID === evidence.producer.assistantMessageID &&
          condition.producer.toolCallID === evidence.producer.toolCallID))
    )
  if (condition.kind === "artifact" && evidence.kind === "artifact")
    return (
      condition.sessionID === evidence.producer.sessionID &&
      condition.artifactID === evidence.producer.artifactID &&
      condition.revision === evidence.producer.revision &&
      condition.relativePath === evidence.producer.relativePath
    )
  return (
    condition.kind === "human_acceptance" &&
    evidence.kind === "human_acceptance" &&
    evidence.source === "authenticated_user"
  )
}

function currentEvidence(goal: SessionGoal.Info) {
  return goal.evidence.filter(
    (evidence) =>
      evidence.kind !== "human_acceptance" &&
      (evidence.revision === goal.revision || evidence.acceptedRevisions.includes(goal.revision)) &&
      goal.conditions.some((condition) => satisfies(condition, evidence, goal.revision)),
  )
}

function view(goal: SessionGoal.Info, time: number): SessionGoal.Info {
  const evidence = currentEvidence(goal)
  const evidenceSetDigest = evidenceDigest(evidence)
  return {
    ...goal,
    currentEvidenceIDs: evidence.map((item) => item.id).toSorted(),
    evidenceSetDigest,
    satisfiedConditionIDs: goal.conditions
      .filter((condition) =>
        goal.evidence.some(
          (evidence) =>
            satisfies(condition, evidence, goal.revision) &&
            (evidence.kind !== "human_acceptance" || evidence.evidenceSetDigest === evidenceSetDigest),
        ),
      )
      .map((condition) => condition.id),
    accounting: {
      rounds: goal.rounds.length,
      activeMilliseconds: elapsed(goal, time),
      coordinator: count(goal.attempts, "coordinator"),
      worker: count(goal.attempts, "worker"),
      compaction: count(goal.attempts, "compaction"),
      auxiliary: count(goal.attempts, "auxiliary"),
    },
  }
}

function stop(goal: SessionGoal.Info, time: number, reason: SessionGoal.PauseReason, code: string): SessionGoal.Info {
  if (goal.status !== "active" && goal.pauseReason === reason && goal.pauseCode === code) return goal
  return view(
    {
      ...goal,
      status: "paused",
      pauseReason: reason,
      pauseCode: code,
      pauseVersion: goal.pauseVersion + 1,
      activeMilliseconds: elapsed(goal, time),
      activeSince: undefined,
      updatedAt: time,
    },
    time,
  )
}

function finished(goal: SessionGoal.Info, time: number) {
  const projected = view(goal, time)
  if (projected.status === "cancelled") return projected
  if (budgetReason(projected, time) === "budget_unverified") return stop(projected, time, "budget", "budget_unverified")
  if (
    projected.conditions.some((condition) => !projected.satisfiedConditionIDs.includes(condition.id)) ||
    (projected.budget.tokens !== undefined && projected.attempts.some((attempt) => attempt.settledAt === undefined))
  )
    return projected
  return {
    ...projected,
    status: "completed" as const,
    activeMilliseconds: elapsed(goal, time),
    activeSince: undefined,
    pauseReason: undefined,
    pauseCode: undefined,
    updatedAt: time,
  }
}

function budgetReason(
  goal: SessionGoal.Info,
  time: number,
  input?: { newRound?: boolean; newStep?: boolean; newAttempt?: boolean },
) {
  const accounting = view(goal, time).accounting
  const counts = [accounting.coordinator, accounting.worker, accounting.compaction, accounting.auxiliary]
  if (
    goal.budget.tokens !== undefined &&
    counts.some(
      (count) => count.unknownAttempts > 0 || (goal.pauseCode === "budget_unverified" && count.pendingAttempts > 0),
    )
  )
    return "budget_unverified"
  if (goal.budget.activeMilliseconds !== undefined && accounting.activeMilliseconds >= goal.budget.activeMilliseconds)
    return "time_budget"
  if (
    goal.budget.tokens !== undefined &&
    counts.reduce((sum, count) => sum + count.recordedTokens, 0) >= goal.budget.tokens
  )
    return "token_budget"
  if (input?.newRound && goal.budget.rounds !== undefined && accounting.rounds >= goal.budget.rounds)
    return "round_budget"
  if (
    (input?.newRound || input?.newStep) &&
    goal.budget.steps !== undefined &&
    counts.reduce((sum, count) => sum + count.steps, 0) >= goal.budget.steps
  )
    return "step_budget"
  if (
    (input?.newRound || input?.newAttempt) &&
    goal.budget.attempts !== undefined &&
    counts.reduce((sum, count) => sum + count.attempts, 0) >= goal.budget.attempts
  )
    return "attempt_budget"
  return undefined
}

const inputID = (goalID: SessionGoal.ID, revision: number, number: number) =>
  SessionMessage.ID.make("msg_" + CompositionDigest.computeDigest({ goalID, revision, number }).slice(0, 32))

/** Acquire the existing Session locks in a fixed order for shared request accounting. */
const serializedGoals = <A, E, R>(sessionIDs: readonly Session.ID[], effect: Effect.Effect<A, E, R>) =>
  Array.from(new Set(sessionIDs))
    .toSorted()
    .reduceRight((effect, sessionID) => SessionInbox.serialized(sessionID, effect), effect)

export const make = Effect.fn("SessionGoal.make")(function* () {
  const database = yield* Database.Service
  const db = database.db
  const bus = yield* Bus.Service
  const metas = yield* MetaAgentService.Service
  const inbox = yield* SessionInbox.Service

  const list = Effect.fn("SessionGoal.list")(function* (sessionID: Session.ID) {
    const rows = yield* db
      .select()
      .from(SessionGoalTable)
      .where(eq(SessionGoalTable.session_id, sessionID))
      .orderBy(asc(SessionGoalTable.time_created), asc(SessionGoalTable.id))
      .all()
      .pipe(Effect.orDie)
    const time = yield* now
    return rows.map((row) => view(decode(row.data), time))
  })

  const get = Effect.fn("SessionGoal.get")(function* (ref: SessionGoal.Ref) {
    const row = yield* db
      .select()
      .from(SessionGoalTable)
      .where(and(eq(SessionGoalTable.id, ref.goalID), eq(SessionGoalTable.session_id, ref.sessionID)))
      .get()
      .pipe(Effect.orDie)
    return row ? view(decode(row.data), yield* now) : undefined
  })

  const requireGoal = Effect.fnUntraced(function* (ref: SessionGoal.Ref, expectedRevision?: number) {
    const goal = yield* get(ref)
    if (!goal) return yield* new GoalError({ ...ref, reason: "not_found", message: "Goal not found in this Session" })
    if (expectedRevision !== undefined && goal.revision !== expectedRevision)
      return yield* new GoalError({ ...ref, reason: "stale_revision", message: "Goal revision has changed" })
    return goal
  })

  const store = Effect.fnUntraced(function* (goal: SessionGoal.Info) {
    const stored = yield* db
      .insert(SessionGoalTable)
      .values({
        id: goal.id,
        session_id: goal.sessionID,
        revision: goal.revision,
        status: goal.status,
        last_round_input_id: goal.lastRoundInputID,
        data: encode(goal),
        time_created: goal.createdAt,
        time_updated: goal.updatedAt,
      })
      .onConflictDoUpdate({
        target: SessionGoalTable.id,
        setWhere: eq(SessionGoalTable.session_id, goal.sessionID),
        set: {
          revision: goal.revision,
          status: goal.status,
          last_round_input_id: goal.lastRoundInputID ?? null,
          data: encode(goal),
          time_updated: goal.updatedAt,
        },
      })
      .returning({ id: SessionGoalTable.id })
      .get()
      .pipe(Effect.orDie)
    if (!stored)
      return yield* new GoalError({
        sessionID: goal.sessionID,
        goalID: goal.id,
        reason: "goal_conflict",
        message: "Goal ID belongs to another Session",
      })
    return goal
  })

  const save = Effect.fnUntraced(function* (goal: SessionGoal.Info) {
    const result = yield* store(view(goal, yield* now))
    yield* bus.publish(SessionGoal.Events.Updated, { sessionID: goal.sessionID, goal: result })
    return result
  })

  const editable = (goal: SessionGoal.Info) =>
    goal.status === "completed" || goal.status === "cancelled"
      ? new GoalError({
          sessionID: goal.sessionID,
          goalID: goal.id,
          reason: "terminal",
          message: "Create a new Goal to start new work after a terminal Goal",
        })
      : undefined

  const assertConditions = (conditions: readonly SessionGoal.Condition[], sessionID: Session.ID) => {
    if (new Set(conditions.map((condition) => condition.id)).size !== conditions.length)
      return new GoalError({ sessionID, reason: "duplicate_condition", message: "Condition IDs must be unique" })
    if (
      conditions.some(
        (condition) =>
          condition.kind === "command_result" &&
          (normalizeCommand(condition.command) === "" || !path.isAbsolute(condition.cwd)),
      )
    )
      return new GoalError({
        sessionID,
        reason: "invalid_command_condition",
        message: "Command conditions require a command and an absolute working directory",
      })
    return undefined
  }

  const set = Effect.fn("SessionGoal.set")(
    (input: SessionGoal.CreateInput & { sessionID: Session.ID }, capture?: MetaAgentService.CoordinationCapture) =>
      SessionInbox.serialized(
        input.sessionID,
        Effect.gen(function* () {
          const invalid = assertConditions(input.conditions, input.sessionID)
          if (invalid) return yield* invalid
          const capability = yield* metas.assertCoordination(input.sessionID, capture)
          const stored = input.goalID
            ? yield* db
                .select()
                .from(SessionGoalTable)
                .where(eq(SessionGoalTable.id, input.goalID))
                .get()
                .pipe(Effect.orDie)
            : undefined
          if (stored && stored.session_id !== input.sessionID)
            return yield* new GoalError({
              sessionID: input.sessionID,
              goalID: stored.id,
              reason: "goal_conflict",
              message: "Goal ID belongs to another Session",
            })
          const existing = stored ? view(decode(stored.data), yield* now) : undefined
          if (existing) {
            if (
              digest({ objective: existing.objective, conditions: existing.conditions, budget: existing.budget }) !==
              digest({ objective: input.objective, conditions: input.conditions, budget: input.budget })
            )
              return yield* new GoalError({
                sessionID: input.sessionID,
                goalID: existing.id,
                reason: "goal_conflict",
                message: "Goal ID already belongs to a different configuration",
              })
            return existing
          }
          if ((yield* list(input.sessionID)).some((goal) => goal.status === "active"))
            return yield* new GoalError({
              sessionID: input.sessionID,
              reason: "active_goal_exists",
              message: "Pause the running Goal before starting another Goal",
            })
          const session = yield* db
            .select({ controller: SessionTable.controller })
            .from(SessionTable)
            .where(eq(SessionTable.id, input.sessionID))
            .get()
            .pipe(Effect.orDie)
          if (session?.controller?.kind !== "root")
            return yield* new GoalError({
              sessionID: input.sessionID,
              reason: "meta_root_required",
              message: "Goal coordination requires its actual Meta root",
            })
          const time = yield* now
          const goal: SessionGoal.Info = {
            id: input.goalID ?? SessionGoal.ID.create(),
            sessionID: input.sessionID,
            metaAgentID: session.controller.metaAgentID,
            agent: Agent.ID.make("meta"),
            selection: capability.selection,
            objective: input.objective,
            conditions: input.conditions,
            taskRefs: [],
            revision: 1,
            revisionCreatedAt: time,
            status: "active",
            pauseVersion: 0,
            budget: input.budget,
            rounds: [],
            attempts: [],
            evidence: [],
            currentEvidenceIDs: [],
            evidenceSetDigest: evidenceDigest([]),
            satisfiedConditionIDs: [],
            activeSince: time,
            activeMilliseconds: 0,
            accounting: {
              rounds: 0,
              activeMilliseconds: 0,
              coordinator: count([], "coordinator"),
              worker: count([], "worker"),
              compaction: count([], "compaction"),
              auxiliary: count([], "auxiliary"),
            },
            createdAt: time,
            updatedAt: time,
          }
          return yield* save(goal)
        }),
      ),
  )

  const edit = Effect.fn("SessionGoal.edit")(
    (input: SessionGoal.Ref & SessionGoal.EditInput, capture?: MetaAgentService.CoordinationCapture) =>
      SessionInbox.serialized(
        input.sessionID,
        Effect.gen(function* () {
          const goal = yield* requireGoal(input, input.expectedRevision)
          const terminal = editable(goal)
          if (terminal) return yield* terminal
          yield* metas.assertCoordination(input.sessionID, capture)
          const invalid = assertConditions(input.conditions ?? goal.conditions, input.sessionID)
          if (invalid) return yield* invalid
          const time = yield* now
          return yield* save({
            ...goal,
            objective: input.objective ?? goal.objective,
            conditions: input.conditions ?? goal.conditions,
            budget: input.budget ?? goal.budget,
            revision: goal.revision + 1,
            revisionCreatedAt: time,
            updatedAt: time,
          })
        }),
      ),
  )

  const pause = Effect.fn("SessionGoal.pause")((input: SessionGoal.Ref & SessionGoal.RevisionInput) =>
    SessionInbox.serialized(
      input.sessionID,
      Effect.gen(function* () {
        const goal = yield* requireGoal(input, input.expectedRevision)
        if (goal.status === "completed" || goal.status === "cancelled") return goal
        return yield* save(stop(goal, yield* now, "user", "user_pause"))
      }),
    ),
  )

  const resume = Effect.fn("SessionGoal.resume")(
    (input: SessionGoal.Ref & SessionGoal.RevisionInput, capture?: MetaAgentService.CoordinationCapture) =>
      SessionInbox.serialized(
        input.sessionID,
        Effect.gen(function* () {
          const goal = yield* requireGoal(input, input.expectedRevision)
          const terminal = editable(goal)
          if (terminal) return yield* terminal
          const capability = yield* metas.assertCoordination(input.sessionID, capture)
          if ((yield* list(input.sessionID)).some((other) => other.status === "active" && other.id !== goal.id))
            return yield* new GoalError({
              ...input,
              reason: "active_goal_exists",
              message: "Pause the running Goal before resuming this Goal",
            })
          const time = yield* now
          const reason = budgetReason(goal, time)
          if (reason) return yield* save(stop(goal, time, "budget", reason))
          return yield* save({
            ...goal,
            status: "active",
            selection: capability.selection,
            agent: Agent.ID.make("meta"),
            pauseReason: undefined,
            pauseCode: undefined,
            activeSince: goal.status === "active" ? goal.activeSince : time,
            updatedAt: time,
          })
        }),
      ),
  )

  const cancel = Effect.fn("SessionGoal.cancel")((input: SessionGoal.Ref & SessionGoal.RevisionInput) =>
    SessionInbox.serialized(
      input.sessionID,
      Effect.gen(function* () {
        const goal = yield* requireGoal(input, input.expectedRevision)
        if (goal.status === "completed" || goal.status === "cancelled") return goal
        const time = yield* now
        return yield* save({
          ...goal,
          status: "cancelled",
          activeMilliseconds: elapsed(goal, time),
          activeSince: undefined,
          pauseReason: undefined,
          pauseCode: undefined,
          updatedAt: time,
        })
      }),
    ),
  )

  const confirm = Effect.fn("SessionGoal.confirm")((input: SessionGoal.Ref & SessionGoal.ConfirmInput) =>
    SessionInbox.serialized(
      input.sessionID,
      Effect.gen(function* () {
        const goal = yield* requireGoal(input, input.expectedRevision)
        if (goal.status === "cancelled") return goal
        const selected = goal.evidence.filter(
          (item) => item.kind !== "human_acceptance" && input.evidenceIDs.includes(item.id),
        )
        if (
          selected.length !== new Set(input.evidenceIDs).size ||
          input.evidenceIDs.length !== selected.length ||
          selected.some((item) => !goal.conditions.some((condition) => satisfies(condition, item))) ||
          currentEvidence(goal).some((item) => !input.evidenceIDs.includes(item.id)) ||
          evidenceDigest(selected) !== input.evidenceSetDigest
        )
          return yield* new GoalError({
            ...input,
            reason: "stale_evidence_set",
            message: "Confirm the exact current revision and selected producer evidence set",
          })
        const time = yield* now
        const evidence = goal.evidence.map((item) =>
          input.evidenceIDs.includes(item.id)
            ? { ...item, acceptedRevisions: Array.from(new Set([...item.acceptedRevisions, goal.revision])) }
            : item,
        )
        const acceptances = goal.conditions
          .filter((condition) => condition.kind === "human_acceptance")
          .map(
            (condition): SessionGoal.HumanEvidence => ({
              id: "human:" + goal.id + ":" + goal.revision + ":" + condition.id + ":" + input.evidenceSetDigest,
              conditionID: condition.id,
              revision: goal.revision,
              acceptedRevisions: [],
              kind: "human_acceptance",
              evidenceSetDigest: input.evidenceSetDigest,
              evidenceIDs: input.evidenceIDs.toSorted(),
              source: "authenticated_user",
              recordedAt: time,
            }),
          )
        return yield* save(
          finished(
            {
              ...goal,
              evidence: [...evidence, ...acceptances.filter((item) => !evidence.some((old) => old.id === item.id))],
              updatedAt: time,
            },
            time,
          ),
        )
      }),
    ),
  )

  const operationRounds = (operation: SessionTask.OperationInfo): readonly SessionGoal.RoundRef[] => {
    if (operation.goalRounds?.length) return operation.goalRounds
    if (operation.source.type !== "goal_round") return []
    return [
      {
        goalID: SessionGoal.ID.make(operation.source.goalID),
        sessionID: operation.source.sessionID,
        revision: operation.source.revision,
        roundID: operation.source.roundID,
        inputID: operation.inputID,
      },
    ]
  }

  const attributionForInputs = Effect.fnUntraced(function* (
    sessionID: Session.ID,
    inputs: readonly SessionMessage.ID[],
  ) {
    const owned = (yield* list(sessionID)).flatMap((goal) =>
      goal.rounds.filter((round) => inputs.includes(round.inputID)),
    )
    const rows = yield* db
      .select({ operation: SessionInputResultTable.operation_ref })
      .from(SessionInputResultTable)
      .where(eq(SessionInputResultTable.session_id, sessionID))
      .all()
      .pipe(Effect.orDie)
    const operations = (yield* Effect.forEach(
      rows.flatMap((row) => (row.operation ? [row.operation] : [])),
      (ref) => TaskOperation.get(db, { sessionID: ref.sourceSessionID, operationID: ref.operationID }),
    )).flatMap((operation) => (operation && inputs.includes(operation.inputID) ? [operation] : []))
    const candidate = [...owned, ...operations.flatMap(operationRounds)]
    const unique = candidate.filter(
      (round, index) =>
        candidate.findIndex((other) => other.goalID === round.goalID && other.roundID === round.roundID) === index,
    )
    const verified = yield* Effect.forEach(unique, (round) =>
      get({ sessionID: round.sessionID, goalID: round.goalID }).pipe(
        Effect.map((goal) =>
          goal?.rounds.find((saved) => saved.roundID === round.roundID && saved.revision === round.revision),
        ),
      ),
    )
    const rounds = verified.filter((round): round is SessionGoal.Round => round !== undefined)
    return {
      rounds,
      operations: operations.map((operation) => ({
        ref: new SessionTask.OperationReadonlyRef({
          sourceSessionID: operation.sourceSessionID,
          operationID: operation.operationID,
        }),
        rounds: rounds.filter((saved) =>
          operationRounds(operation).some(
            (round) =>
              round.goalID === saved.goalID &&
              round.sessionID === saved.sessionID &&
              round.roundID === saved.roundID &&
              round.revision === saved.revision,
          ),
        ),
      })),
    }
  })

  const roundsForMessage = Effect.fn("SessionGoal.roundsForMessage")(function* (input: {
    sessionID: Session.ID
    assistantMessageID: SessionMessage.ID
  }) {
    const rows = yield* db.select().from(SessionGoalTable).all().pipe(Effect.orDie)
    const rounds = rows.flatMap((row) =>
      decode(row.data)
        .attempts.filter(
          (attempt) => attempt.sessionID === input.sessionID && attempt.assistantMessageID === input.assistantMessageID,
        )
        .flatMap((attempt) => attempt.rounds),
    )
    return rounds.filter(
      (round, index) =>
        rounds.findIndex((other) => other.goalID === round.goalID && other.roundID === round.roundID) === index,
    )
  })

  const beforeAttempt = Effect.fn("SessionGoal.beforeAttempt")(function* (input: AttemptInput) {
    const membership =
      input.kind === "auxiliary" && input.inputID === undefined
        ? undefined
        : yield* SessionInputResult.current(db, input.sessionID)
    const attribution = yield* attributionForInputs(
      input.sessionID,
      input.inputID ? [input.inputID] : (membership?.inputs.map((item) => item.inputID) ?? []),
    )
    // Persisted attempts own RoundRef identities; mutable round metadata is outside dispatch equivalence.
    const refs = attribution.rounds.map((round) => ({
      goalID: round.goalID,
      sessionID: round.sessionID,
      revision: round.revision,
      roundID: round.roundID,
      inputID: round.inputID,
    }))
    if (refs.length === 0) return []
    const attemptID = input.attemptID ?? "gatt_" + Identifier.ascending()
    const owners = refs.filter((ref, index) => refs.findIndex((other) => other.goalID === ref.goalID) === index)
    const kind =
      input.kind === "compaction" || input.kind === "auxiliary"
        ? input.kind
        : refs.every((ref) => ref.sessionID === input.sessionID)
          ? "coordinator"
          : "worker"
    return yield* serializedGoals(
      owners.map((ref) => ref.sessionID),
      db
        .transaction(() =>
          Effect.gen(function* () {
            const goals = yield* Effect.forEach(owners, (ref) => requireGoal(ref))
            const time = yield* now
            const blocked = goals
              .map((goal) => {
                const sameStep =
                  input.assistantMessageID !== undefined &&
                  goal.attempts.some(
                    (attempt) =>
                      attempt.sessionID === input.sessionID &&
                      attempt.assistantMessageID === input.assistantMessageID &&
                      attempt.kind === kind,
                  )
                const existing = goal.attempts.find((attempt) => attempt.id === attemptID)
                if (existing) return undefined
                const origin = refs.find((ref) => ref.goalID === goal.id)
                // Pausing Goal continuation does not cancel its already admitted worker.
                if (kind !== "worker" && goal.status !== "active")
                  return { goal, reason: goal.pauseCode ?? goal.status }
                if (kind !== "worker" && origin?.revision !== goal.revision) return { goal, reason: "stale_revision" }
                const reason = budgetReason(goal, time, {
                  newStep: !sameStep && (kind === "coordinator" || kind === "worker"),
                  newAttempt: true,
                })
                return reason ? { goal, reason } : undefined
              })
              .find((blocked) => blocked !== undefined)
            if (blocked) {
              const paused =
                blocked.goal.status === "active"
                  ? stop(blocked.goal, time, blocked.reason === "stale_revision" ? "blocked" : "budget", blocked.reason)
                  : blocked.goal
              if (paused !== blocked.goal) yield* store(paused)
              return {
                _tag: "Blocked" as const,
                error: new BudgetError({ sessionID: paused.sessionID, goalID: paused.id, reason: blocked.reason }),
              }
            }
            const conflict = goals.find((goal) =>
              goal.attempts.some(
                (attempt) =>
                  attempt.id === attemptID &&
                  (attempt.sessionID !== input.sessionID ||
                    attempt.assistantMessageID !== input.assistantMessageID ||
                    attempt.kind !== kind ||
                    digest(attempt.rounds) !== digest(refs)),
              ),
            )
            if (conflict)
              return yield* new GoalError({
                sessionID: conflict.sessionID,
                goalID: conflict.id,
                reason: "attempt_conflict",
                message: "Attempt ID belongs to a different physical dispatch",
              })
            yield* Effect.forEach(
              goals,
              (goal) => {
                if (goal.attempts.some((attempt) => attempt.id === attemptID)) return Effect.void
                const operations = attribution.operations
                  .filter((operation) =>
                    operation.rounds.some((round) => round.goalID === goal.id && round.sessionID === goal.sessionID),
                  )
                  .map((operation) => operation.ref)
                return store({
                  ...goal,
                  attempts: [
                    ...goal.attempts,
                    {
                      id: attemptID,
                      sessionID: input.sessionID,
                      assistantMessageID: input.assistantMessageID,
                      kind,
                      rounds: [refs[0], ...refs.slice(1)],
                      operation: operations.length === 1 ? operations[0] : undefined,
                      operations,
                      dispatchedAt: time,
                    },
                  ],
                  updatedAt: time,
                })
              },
              { discard: true },
            )
            return {
              _tag: "Admitted" as const,
              refs: goals.map(
                (goal): SessionGoal.AttemptRef => ({ goalID: goal.id, sessionID: goal.sessionID, attemptID }),
              ),
            }
          }),
        )
        .pipe(
          Effect.catchTag("SqlError", Effect.die),
          Effect.flatMap((result) =>
            result._tag === "Blocked" ? Effect.fail(result.error) : Effect.succeed(result.refs),
          ),
        ),
    )
  })

  const settleAttempt = Effect.fn("SessionGoal.settleAttempt")(function* (input: {
    refs: readonly SessionGoal.AttemptRef[]
    usage?: TokenUsage.Info
  }) {
    return yield* Effect.forEach(input.refs, (ref) =>
      SessionInbox.serialized(
        ref.sessionID,
        Effect.gen(function* () {
          const goal = yield* requireGoal(ref)
          const attempt = goal.attempts.find((attempt) => attempt.id === ref.attemptID)
          if (!attempt)
            return yield* new GoalError({
              ...ref,
              reason: "attempt_not_found",
              message: "No persisted dispatch owns this usage",
            })
          if (attempt.usage !== undefined && input.usage !== undefined && !isDeepStrictEqual(attempt.usage, input.usage))
            return yield* new GoalError({ ...ref, reason: "usage_conflict", message: "Physical attempt usage conflicts with its persisted settlement" })
          if (attempt.settledAt !== undefined && (attempt.usage !== undefined || input.usage === undefined)) return goal
          const time = yield* now
          const settled = {
            ...goal,
            attempts: goal.attempts.map((item) =>
              item.id === ref.attemptID
                ? {
                    ...item,
                    settledAt: item.settledAt ?? time,
                    usage: input.usage,
                  }
                : item,
            ),
            updatedAt: time,
          }
          const projected = finished(settled, time)
          const reason = budgetReason(projected, time)
          return yield* save(
            reason && projected.status === "active" ? stop(projected, time, "budget", reason) : projected,
          )
        }),
      ),
    )
  })

  const beforeTask = Effect.fn("SessionGoal.beforeTask")(function* (
    input: SessionTask.OperationGoalSource | { readonly rounds: readonly SessionGoal.RoundRef[] },
  ) {
    const rounds =
      "rounds" in input
        ? input.rounds
        : (yield* list(input.sessionID)).flatMap((goal) =>
            goal.id === input.goalID
              ? goal.rounds.filter((round) => round.roundID === input.roundID && round.revision === input.revision)
              : [],
          )
    if (!("rounds" in input) && rounds.length === 0)
      return yield* new GoalError({
        sessionID: input.sessionID,
        reason: "round_not_found",
        message: "Goal source must refer to its saved round",
      })
    yield* Effect.forEach(
      rounds,
      (round) =>
        Effect.gen(function* () {
          const goal = yield* requireGoal(round, round.revision)
          if (!goal.rounds.some((saved) => saved.roundID === round.roundID && saved.inputID === round.inputID))
            return yield* new GoalError({
              ...round,
              reason: "round_not_found",
              message: "Goal attribution must use its saved input identity",
            })
          const reason =
            goal.status !== "active"
              ? (goal.pauseCode ?? goal.status)
              : budgetReason(goal, yield* now, { newStep: true, newAttempt: true })
          if (reason) return yield* new BudgetError({ sessionID: round.sessionID, goalID: round.goalID, reason })
        }),
      { discard: true },
    )
  })

  const beforeRoundDelivery = Effect.fn("SessionGoal.beforeRoundDelivery")(function* (input: {
    sessionID: Session.ID
    inputID: SessionMessage.ID
  }) {
    const goals = yield* list(input.sessionID)
    const goal = goals.find((goal) => goal.rounds.some((round) => round.inputID === input.inputID))
    if (!goal) return true
    const round = goal.rounds.find((round) => round.inputID === input.inputID)
    if (!round || goal.status !== "active" || round.revision !== goal.revision) return false
    const capability = yield* metas.coordination(input.sessionID, { selection: round.selection })
    if (!capability.available) {
      yield* save(stop(goal, yield* now, "blocked", "agent_changed"))
      return false
    }
    return true
  })

  const observeTool = Effect.fn("SessionGoal.observeTool")(function* (eventID: Event.ID) {
    const stored = yield* db.select().from(EventTable).where(eq(EventTable.id, eventID)).get().pipe(Effect.orDie)
    if (
      !stored ||
      stored.type !== Event.versionedType(SessionEvent.Tool.Success.type, SessionEvent.Tool.Success.durable.version)
    )
      return
    const event = Schema.decodeUnknownSync(SessionEvent.Tool.Success.data)(stored.data)
    // `executed` identifies provider-hosted execution. Shell evidence is produced locally.
    if (event.executed) return
    const result = Schema.decodeUnknownOption(Shell.CommandResult)(event.metadata?.commandResult)
    if (Option.isNone(result)) return
    const names = yield* db
      .select()
      .from(EventTable)
      .where(
        and(
          eq(EventTable.aggregate_id, event.sessionID),
          eq(
            EventTable.type,
            Event.versionedType(SessionEvent.Tool.Input.Started.type, SessionEvent.Tool.Input.Started.durable.version),
          ),
        ),
      )
      .all()
      .pipe(Effect.orDie)
    if (
      !names.some((row) => {
        const name = Schema.decodeUnknownSync(SessionEvent.Tool.Input.Started.data)(row.data)
        return name.assistantMessageID === event.assistantMessageID && name.id === event.id && name.name === "shell"
      })
    )
      return
    const starts = yield* db
      .select()
      .from(EventTable)
      .where(
        and(
          eq(EventTable.aggregate_id, event.sessionID),
          eq(
            EventTable.type,
            Event.versionedType(SessionEvent.Step.Started.type, SessionEvent.Step.Started.durable.version),
          ),
        ),
      )
      .all()
      .pipe(Effect.orDie)
    const source = starts
      .map((row) => Schema.decodeUnknownSync(SessionEvent.Step.Started.data)(row.data))
      .find((start) => start.assistantMessageID === event.assistantMessageID)
    const refs = yield* roundsForMessage({ sessionID: event.sessionID, assistantMessageID: event.assistantMessageID })
    const text = event.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n\n")
    yield* Effect.forEach(
      refs,
      (ref) =>
        SessionInbox.serialized(
          ref.sessionID,
          Effect.gen(function* () {
            const goal = yield* requireGoal(ref)
            if (goal.status === "cancelled") return
            const attempt = goal.attempts.find(
              (attempt) =>
                attempt.sessionID === event.sessionID && attempt.assistantMessageID === event.assistantMessageID,
            )
            const operations = attempt?.operations ?? (attempt?.operation ? [attempt.operation] : [])
            const time = yield* now
            const candidates = goal.conditions.flatMap((condition): SessionGoal.CommandEvidence[] => {
              if (condition.kind !== "command_result" || result.value.started < goal.revisionCreatedAt) return []
              const evidence: SessionGoal.CommandEvidence = {
                id: "command:" + eventID + ":" + condition.id,
                conditionID: condition.id,
                revision: ref.revision,
                acceptedRevisions: [],
                kind: "command_result",
                producer: {
                  eventID,
                  sessionID: event.sessionID,
                  assistantMessageID: event.assistantMessageID,
                  toolCallID: event.id,
                  sourceSnapshot: source?.snapshot,
                },
                result: result.value,
                outputIncludes: condition.outputIncludes.filter((expected) => text.includes(expected)),
                operation:
                  condition.operation === undefined
                    ? operations.length === 1
                      ? operations[0]
                      : undefined
                    : operations.find((operation) => sameOperation(condition.operation, operation)),
                operations,
                recordedAt: time,
              }
              return satisfies(condition, evidence) && !goal.evidence.some((old) => old.id === evidence.id)
                ? [evidence]
                : []
            })
            if (candidates.length === 0) return
            yield* save(finished({ ...goal, evidence: [...goal.evidence, ...candidates], updatedAt: time }, time))
          }),
        ),
      { discard: true },
    )
  })

  const observeArtifact = Effect.fn("SessionGoal.observeArtifact")(function* (sessionID: Session.ID) {
    const artifacts = yield* WorkArtifact.Service
    const artifact = yield* artifacts.get(sessionID)
    if (!artifact || artifact.artifact.status !== "available") return
    const membership = yield* SessionInputResult.current(db, sessionID)
    const settled = membership
      ? []
      : yield* db
          .select({ inputID: SessionInputResultTable.input_id })
          .from(SessionInputResultTable)
          .where(eq(SessionInputResultTable.session_id, sessionID))
          .all()
          .pipe(Effect.orDie)
    const attribution = yield* attributionForInputs(
      sessionID,
      membership?.inputs.map((item) => item.inputID) ?? settled.map((item) => item.inputID),
    )
    const refs = attribution.rounds
    yield* Effect.forEach(
      refs,
      (ref) =>
        SessionInbox.serialized(
          ref.sessionID,
          Effect.gen(function* () {
            const goal = yield* requireGoal(ref)
            if (goal.status === "cancelled") return
            const original = goal.evidence.find(
              (evidence) =>
                evidence.kind === "artifact" &&
                evidence.producer.sessionID === sessionID &&
                evidence.producer.artifactID === artifact.artifact.id &&
                evidence.producer.revision === artifact.revision &&
                evidence.producer.relativePath === artifact.artifact.relativePath,
            )
            const time = yield* now
            const operations = attribution.operations
              .filter((operation) =>
                operation.rounds.some((round) => round.goalID === goal.id && round.sessionID === goal.sessionID),
              )
              .map((operation) => operation.ref)
            const candidates = goal.conditions.flatMap((condition): SessionGoal.ArtifactEvidence[] => {
              if (condition.kind !== "artifact") return []
              const evidence: SessionGoal.ArtifactEvidence = {
                id:
                  "artifact:" +
                  artifact.artifact.id +
                  ":" +
                  artifact.revision +
                  ":" +
                  (original?.revision ?? ref.revision) +
                  ":" +
                  condition.id,
                conditionID: condition.id,
                revision: original?.revision ?? ref.revision,
                acceptedRevisions: [],
                kind: "artifact",
                producer: {
                  sessionID,
                  artifactID: artifact.artifact.id,
                  revision: artifact.revision,
                  relativePath: artifact.artifact.relativePath,
                },
                operation:
                  condition.operation === undefined
                    ? operations.length === 1
                      ? operations[0]
                      : undefined
                    : operations.find((operation) => sameOperation(condition.operation, operation)),
                operations,
                recordedAt: time,
              }
              return satisfies(condition, evidence) && !goal.evidence.some((old) => old.id === evidence.id)
                ? [evidence]
                : []
            })
            if (candidates.length === 0) return
            yield* save(finished({ ...goal, evidence: [...goal.evidence, ...candidates], updatedAt: time }, time))
          }),
        ),
      { discard: true },
    )
  })

  const advance = Effect.fn("SessionGoal.advance")(
    (input: { sessionID: Session.ID; goalID?: SessionGoal.ID; trigger?: string }) =>
      SessionInbox.serialized(
        input.sessionID,
        Effect.gen(function* (): Effect.fn.Return<AdvanceResult, GoalError> {
          const goal = input.goalID
            ? yield* requireGoal({ sessionID: input.sessionID, goalID: input.goalID })
            : (yield* list(input.sessionID)).find((goal) => goal.status === "active")
          if (!goal) return { state: "skipped", reason: "no_active_goal" }
          if (goal.status !== "active")
            return { state: goal.status === "paused" ? "blocked" : "skipped", reason: goal.pauseCode ?? goal.status }
          const capability = yield* metas
            .coordination(input.sessionID, { selection: goal.selection })
            .pipe(Effect.catchTag("Session.NotFoundError", () => Effect.succeed(undefined)))
          const time = yield* now
          if (!capability?.available) {
            yield* save(stop(goal, time, "blocked", "agent_changed"))
            return { state: "blocked", reason: "agent_changed" }
          }
          const projected = finished(goal, time)
          if (projected.status === "completed") {
            yield* save(projected)
            return { state: "skipped", reason: "completed" }
          }
          const totalBudget = budgetReason(goal, time)
          if (totalBudget) {
            yield* save(stop(goal, time, "budget", totalBudget))
            return { state: "blocked", reason: totalBudget }
          }
          const operations = (yield* TaskOperation.list(db, { sessionID: input.sessionID })).filter((operation) =>
            operationRounds(operation).some((round) => round.goalID === goal.id && round.revision === goal.revision),
          )
          const taskRefs = operations.map(
            (operation) =>
              new SessionTask.OperationReadonlyRef({
                sourceSessionID: input.sessionID,
                operationID: operation.operationID,
              }),
          )
          if (operations.some((operation) => operation.phase === "recovery_required")) {
            yield* save(stop({ ...goal, taskRefs }, time, "recovery_required", "worker_recovery_required"))
            return { state: "blocked", reason: "worker_recovery_required" }
          }
          if (
            operations.some((operation) =>
              ["waiting", "reserved", "permission_pending", "prepared", "created", "admitted", "running"].includes(
                operation.phase,
              ),
            )
          ) {
            if (digest(taskRefs) !== digest(goal.taskRefs)) yield* save({ ...goal, taskRefs, updatedAt: time })
            return { state: "waiting", reason: "worker_running", round: goal.rounds.at(-1) }
          }
          const previous = goal.rounds.at(-1)
          const outcome = previous
            ? yield* SessionInputResult.read(db, { sessionID: input.sessionID, inputID: previous.inputID }).pipe(
                Effect.orDie,
              )
            : undefined
          if (outcome?.status === "pending" || outcome?.status === "processing")
            return { state: "waiting", reason: "round_running", round: previous }
          if (
            previous?.revision === goal.revision &&
            (outcome?.status === "failed" || outcome?.status === "interrupted" || outcome?.status === "unverified")
          ) {
            yield* save(stop({ ...goal, taskRefs }, time, "recovery_required", "round_" + outcome.status))
            return { state: "blocked", reason: "round_" + outcome.status, round: previous }
          }
          if (
            previous?.revision === goal.revision &&
            outcome?.status === "completed" &&
            goal.conditions.every(
              (condition) =>
                condition.kind === "human_acceptance" || projected.satisfiedConditionIDs.includes(condition.id),
            )
          )
            return { state: "waiting", reason: "human_acceptance_required", round: previous }
          // Recover a reservation only under its frozen selection. Explicit Meta resume after an Agent switch owns a new round.
          const recoverPrevious =
            outcome?.status === "missing" &&
            previous?.revision === goal.revision &&
            (yield* metas
              .coordination(input.sessionID, { selection: previous.selection })
              .pipe(Effect.catchTag("Session.NotFoundError", () => Effect.succeed(undefined))))?.available === true
          const reason = budgetReason(goal, time, { newRound: !recoverPrevious })
          if (reason) {
            yield* save(stop({ ...goal, taskRefs }, time, "budget", reason))
            return { state: "blocked", reason }
          }
          const trigger =
            input.trigger ??
            (outcome?.resultEventID
              ? "result:" + outcome.resultEventID
              : "start:" + goal.revision + ":" + goal.pauseVersion)
          const repeat = goal.rounds.find((round) => round.revision === goal.revision && round.trigger === trigger)
          const round: SessionGoal.Round = recoverPrevious
            ? previous
            : (repeat ?? {
                goalID: goal.id,
                sessionID: input.sessionID,
                revision: goal.revision,
                roundID: goal.id + ":" + goal.revision + ":" + (goal.rounds.length + 1),
                inputID: inputID(goal.id, goal.revision, goal.rounds.length + 1),
                selection: capability.selection,
                trigger,
                createdAt: time,
              })
          const renewed = {
            ...goal,
            rounds: goal.rounds.some((old) => old.roundID === round.roundID)
              ? goal.rounds
              : [
                  ...goal.rounds.map((old) =>
                    old.roundID === previous?.roundID && outcome?.status === "completed"
                      ? { ...old, settledAt: old.settledAt ?? time, outcome: "completed" as const }
                      : old,
                  ),
                  round,
                ],
            taskRefs,
            lastRoundInputID: round.inputID,
            updatedAt: time,
          }
          // Reserve the immutable identity before admission. A crash resumes this same round.
          yield* store(view(renewed, time))
          yield* inbox
            .admit({
              id: round.inputID,
              sessionID: input.sessionID,
              item: {
                type: "synthetic",
                delivery: "queue",
                payload: {
                  text:
                    "Continue Goal " +
                    goal.id +
                    " revision " +
                    goal.revision +
                    ".\nObjective: " +
                    goal.objective +
                    "\nRequired conditions: " +
                    JSON.stringify(goal.conditions) +
                    "\nSatisfied conditions: " +
                    JSON.stringify(projected.satisfiedConditionIDs) +
                    "\nUse the existing tasks and original tool results. Completion requires every saved condition to be verified.",
                  description: "Goal: " + goal.objective,
                  metadata: { source: "goal", goalRound: Schema.encodeSync(SessionGoal.RoundRef)(round) },
                },
              },
              beforeCommit: Effect.gen(function* () {
                const latest = yield* requireGoal({ sessionID: input.sessionID, goalID: goal.id }, round.revision).pipe(
                  Effect.orDie,
                )
                if (latest.status !== "active")
                  return yield* Effect.die(
                    new GoalError({
                      sessionID: input.sessionID,
                      goalID: goal.id,
                      reason: latest.status,
                      message: "Goal stopped before its round admission",
                    }),
                  )
                yield* metas.assertCoordination(input.sessionID, { selection: round.selection }).pipe(Effect.orDie)
              }),
            })
            .pipe(Effect.orDie)
          yield* bus.publish(SessionGoal.Events.Updated, { sessionID: input.sessionID, goal: view(renewed, time) })
          return { state: "admitted", round }
        }),
      ),
  )

  const scheduleWake = Effect.fn("SessionGoal.scheduleWake")(function* (
    input: SessionGoal.Ref & {
      readonly scheduleID: string
      readonly occurrenceID: string
      readonly revision: number
      readonly userResume?: { readonly goalRevision: number; readonly pauseVersion: number }
    },
  ): Effect.fn.Return<AdvanceResult, GoalError> {
    const goal = yield* requireGoal(input)
    const trigger = "schedule:" + input.scheduleID + ":" + input.occurrenceID + ":" + input.revision
    const existing = goal.rounds.find((round) => round.trigger === trigger)
    if (existing) return { state: "admitted", round: existing }
    if (goal.status === "completed" || goal.status === "cancelled") return { state: "skipped", reason: goal.status }
    if (goal.status === "paused") {
      if (
        goal.pauseReason !== "user" ||
        input.userResume?.goalRevision !== goal.revision ||
        input.userResume.pauseVersion !== goal.pauseVersion
      )
        return { state: "blocked", reason: goal.pauseCode ?? goal.pauseReason }
      const resumed = yield* resume({ ...input, expectedRevision: goal.revision }).pipe(Effect.orDie)
      if (resumed.status !== "active") return { state: "blocked", reason: resumed.pauseCode }
    }
    return yield* advance({ ...input, trigger })
  })

  const recover = Effect.fn("SessionGoal.recover")(function* () {
    const rows = yield* db
      .select()
      .from(SessionGoalTable)
      .where(eq(SessionGoalTable.status, "active"))
      .all()
      .pipe(Effect.orDie)
    const wake = yield* Effect.forEach(rows, (row) =>
      Effect.gen(function* () {
        const admitted = yield* SessionInbox.serialized(
          row.session_id,
          Effect.gen(function* () {
            const goal = yield* requireGoal({ sessionID: row.session_id, goalID: row.id })
            if (goal.status !== "active") return undefined
            if (goal.attempts.some((attempt) => attempt.settledAt === undefined)) {
              yield* save(
                stop(
                  goal,
                  yield* now,
                  goal.budget.tokens === undefined ? "recovery_required" : "budget",
                  goal.budget.tokens === undefined ? "attempt_settlement_unknown" : "budget_unverified",
                ),
              )
              return undefined
            }
            const pending = goal.lastRoundInputID ? yield* SessionInbox.find(db, goal.lastRoundInputID) : undefined
            if (pending?.sessionID === goal.sessionID) return true
            const previous = goal.rounds.at(-1)
            const outcome = previous
              ? yield* SessionInputResult.read(db, { sessionID: goal.sessionID, inputID: previous.inputID }).pipe(
                  Effect.orDie,
                )
              : undefined
            if (previous && outcome?.status !== "missing" && outcome?.status !== "completed") return undefined
            return false
          }),
        )
        if (admitted === undefined) return undefined
        if (admitted) return row.session_id
        // advance owns the same admission lock and restores the frozen reservation.
        const restored = yield* advance({ sessionID: row.session_id, goalID: row.id }).pipe(Effect.orDie)
        return restored.state === "admitted" ? row.session_id : undefined
      }),
    )
    return Array.from(new Set(wake.filter((sessionID): sessionID is Session.ID => sessionID !== undefined)))
  })

  return {
    get,
    list,
    set,
    edit,
    pause,
    resume,
    cancel,
    confirm,
    advance,
    scheduleWake,
    recover,
    beforeAttempt,
    settleAttempt,
    beforeTask,
    beforeRoundDelivery,
    roundsForMessage,
    observeTool,
    observeArtifact,
  }
})

export const layer = Layer.effect(Service, make())
export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, Bus.node, MetaAgentService.node, SessionInbox.node],
})
