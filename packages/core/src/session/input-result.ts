export * as SessionInputResult from "./input-result.js"

import { and, asc, desc, eq, gt, inArray } from "drizzle-orm"
import { Effect } from "effect"
import type { Event } from "@omnixa/schema/event"
import type { SessionTask } from "@omnixa/schema/session-task"
import type { Database } from "../database/database.js"
import type { Session } from "@omnixa/schema/session"
import type { SessionError } from "@omnixa/schema/session-error"
import type { SessionMessage } from "./message.js"
import { SessionHistory } from "./history.js"
import type { MessageDecodeError } from "./error.js"
import { SessionInbox } from "./inbox.js"
import { SessionEvent } from "./event.js"
import { TaskOperation } from "./task-operation.js"
import {
  SessionGoalTable,
  SessionInputResultTable,
  SessionMessageTable,
  SessionTable,
  TaskOperationTable,
} from "./sql.js"

type Evidence = {
  readonly sharedInputs?: ReadonlyArray<SessionMessage.ID>
  readonly resultEventID?: Event.ID
}

export type Result = Evidence &
  (
    | { readonly status: "missing" | "pending" | "processing" | "unverified" }
    | { readonly status: "completed"; readonly assistant: SessionMessage.Assistant }
    | { readonly status: "failed"; readonly error: SessionError.Error | undefined }
    | { readonly status: "interrupted" }
  )

export type Membership = {
  readonly anchorInputID: SessionMessage.ID
  readonly inputs: ReadonlyArray<{
    readonly inputID: SessionMessage.ID
    readonly operationRef?: SessionTask.OperationReadonlyRef
  }>
}

/** An active input group is determined by its pending result projection, not by the Session's latest message. */
export const current = Effect.fn("SessionInputResult.current")(function* (
  db: Database.Interface["db"],
  sessionID: Session.ID,
): Effect.fn.Return<Membership | undefined> {
  const rows = yield* db
    .select()
    .from(SessionInputResultTable)
    .where(and(eq(SessionInputResultTable.session_id, sessionID), eq(SessionInputResultTable.status, "processing")))
    .orderBy(asc(SessionInputResultTable.joined_event_seq))
    .all()
    .pipe(Effect.orDie)
  if (rows.length === 0 || new Set(rows.map((row) => row.anchor_input_id)).size !== 1) return
  return {
    anchorInputID: rows[0].anchor_input_id,
    inputs: rows.map((row) => ({ inputID: row.input_id, operationRef: row.operation_ref ?? undefined })),
  }
})

/** Automatic recovery follows actual input ownership; ordinary members retain their original continuation. */
export const automaticState = Effect.fn("SessionInputResult.automaticState")(function* (
  db: Database.Interface["db"],
  sessionID: Session.ID,
): Effect.fn.Return<"ready" | "completed" | "deferred"> {
  const active = yield* current(db, sessionID)
  const latest = active
    ? undefined
    : yield* db
        .select({ anchorInputID: SessionInputResultTable.anchor_input_id })
        .from(SessionInputResultTable)
        .where(eq(SessionInputResultTable.session_id, sessionID))
        .orderBy(desc(SessionInputResultTable.joined_event_seq))
        .limit(1)
        .get()
        .pipe(Effect.orDie)
  const members =
    active?.inputs ??
    (latest
      ? yield* db
          .select({ inputID: SessionInputResultTable.input_id, operationRef: SessionInputResultTable.operation_ref })
          .from(SessionInputResultTable)
          .where(
            and(
              eq(SessionInputResultTable.session_id, sessionID),
              eq(SessionInputResultTable.anchor_input_id, latest.anchorInputID),
            ),
          )
          .all()
          .pipe(Effect.orDie)
      : [])
  const pending = yield* SessionInbox.list(db, sessionID)
  const ids = [...members.map((member) => member.inputID), ...pending.map((item) => item.id)]
  if (ids.length === 0) return "ready"
  const operations = yield* db
    .select({ inputID: TaskOperationTable.input_id, deferred: TaskOperation.inputDeferred })
    .from(TaskOperationTable)
    .where(and(eq(TaskOperationTable.target_session_id, sessionID), inArray(TaskOperationTable.input_id, ids)))
    .all()
    .pipe(Effect.orDie)
  const goals = yield* db
    .select()
    .from(SessionGoalTable)
    .where(eq(SessionGoalTable.session_id, sessionID))
    .all()
    .pipe(Effect.orDie)
  const ownership = (inputID: SessionMessage.ID, operationRef?: SessionTask.OperationReadonlyRef | null) => {
    const operation = operations.find((operation) => operation.inputID === inputID)
    if (operation?.deferred) return "deferred"
    const goal = goals.find((goal) => goal.data.rounds.some((round) => round.inputID === inputID))
    if (
      goal &&
      (goal.status !== "active" ||
        !goal.data.rounds.some((round) => round.inputID === inputID && round.revision === goal.revision))
    )
      return "deferred"
    if (operation || goal) return "owned"
    return operationRef ? "deferred" : "ordinary"
  }
  if (
    members.some((member) => ownership(member.inputID, member.operationRef) === "ordinary") ||
    pending.some((item) => ownership(item.id) === "ordinary")
  )
    return "ready"
  if (pending.some((item) => ownership(item.id) === "owned")) return "ready"
  if (
    members.some((member) => ownership(member.inputID, member.operationRef) === "deferred") ||
    pending.some((item) => ownership(item.id) === "deferred")
  )
    return "deferred"
  if (active) return "ready"
  const results = yield* Effect.forEach(members, (member) =>
    read(db, { sessionID, inputID: member.inputID }).pipe(Effect.orDie),
  )
  return results.every(
    (result) => result.status === "completed" || result.status === "failed" || result.status === "interrupted",
  )
    ? "completed"
    : "deferred"
})

export const projectMembership = Effect.fn("SessionInputResult.projectMembership")(function* (
  db: Database.Interface["db"],
  event: typeof SessionEvent.InboxDelivered.Type,
) {
  if (!event.data.membership) return
  yield* db
    .insert(SessionInputResultTable)
    .values({
      input_id: event.data.inboxID,
      session_id: event.data.sessionID,
      anchor_input_id: event.data.membership.anchorInputID,
      operation_ref: event.data.membership.operationRef,
      joined_event_id: event.id,
      joined_event_seq: event.durable.seq,
      status: "processing",
    })
    .onConflictDoNothing({ target: SessionInputResultTable.input_id })
    .run()
    .pipe(Effect.orDie)
})

export const projectCompletion = Effect.fn("SessionInputResult.projectCompletion")(function* (
  db: Database.Interface["db"],
  event: typeof SessionEvent.Step.Completed.Type,
) {
  if (!event.data.resultAnchorInputID) return
  yield* db
    .update(SessionInputResultTable)
    .set({
      status: "completed",
      assistant_message_id: event.data.assistantMessageID,
      terminal_event_id: event.id,
      terminal_event_seq: event.durable.seq,
    })
    .where(
      and(
        eq(SessionInputResultTable.session_id, event.data.sessionID),
        eq(SessionInputResultTable.anchor_input_id, event.data.resultAnchorInputID),
        eq(SessionInputResultTable.status, "processing"),
      ),
    )
    .run()
    .pipe(Effect.orDie)
})

export const projectTerminal = Effect.fn("SessionInputResult.projectTerminal")(function* (
  db: Database.Interface["db"],
  event:
    | typeof SessionEvent.Execution.Succeeded.Type
    | typeof SessionEvent.Execution.Failed.Type
    | typeof SessionEvent.Execution.Interrupted.Type,
) {
  if (
    !event.data.resultAnchorInputID ||
    (event.type === SessionEvent.Execution.Interrupted.type && event.data.reason === "shutdown")
  )
    return
  yield* db
    .update(SessionInputResultTable)
    .set({
      status:
        event.type === SessionEvent.Execution.Failed.type
          ? "failed"
          : event.type === SessionEvent.Execution.Interrupted.type
            ? "interrupted"
            : "unverified",
      terminal_event_id: event.id,
      terminal_event_seq: event.durable.seq,
      error: event.type === SessionEvent.Execution.Failed.type ? event.data.error : undefined,
    })
    .where(
      and(
        eq(SessionInputResultTable.session_id, event.data.sessionID),
        eq(SessionInputResultTable.anchor_input_id, event.data.resultAnchorInputID),
        eq(SessionInputResultTable.status, "processing"),
      ),
    )
    .run()
    .pipe(Effect.orDie)
})

/** Resolve one admitted input from authoritative Session projections, without a busy-period or page-size shortcut. */
export const read = Effect.fn("SessionInputResult.read")(function* (
  db: Database.Interface["db"],
  input: { readonly sessionID: Session.ID; readonly inputID: SessionMessage.ID },
): Effect.fn.Return<Result, MessageDecodeError> {
  // Inbox consumption and message insertion commit together; read both from the same snapshot.
  return yield* db
    .transaction(() =>
      Effect.gen(function* (): Effect.fn.Return<Result, MessageDecodeError> {
        const anchor = yield* db
          .select({ seq: SessionMessageTable.seq, type: SessionMessageTable.type })
          .from(SessionMessageTable)
          .where(and(eq(SessionMessageTable.id, input.inputID), eq(SessionMessageTable.session_id, input.sessionID)))
          .get()
          .pipe(Effect.orDie)
        if (!anchor) {
          const pending = yield* SessionInbox.find(db, input.inputID)
          return {
            status:
              pending?.sessionID === input.sessionID && (pending.type === "user" || pending.type === "synthetic")
                ? "pending"
                : "missing",
          }
        }
        if (anchor.type !== "user" && anchor.type !== "synthetic") return { status: "missing" }
        const membership = yield* db
          .select()
          .from(SessionInputResultTable)
          .where(
            and(
              eq(SessionInputResultTable.input_id, input.inputID),
              eq(SessionInputResultTable.session_id, input.sessionID),
            ),
          )
          .get()
          .pipe(Effect.orDie)
        if (membership) {
          const members = yield* db
            .select({ inputID: SessionInputResultTable.input_id })
            .from(SessionInputResultTable)
            .where(
              and(
                eq(SessionInputResultTable.session_id, input.sessionID),
                eq(SessionInputResultTable.anchor_input_id, membership.anchor_input_id),
              ),
            )
            .orderBy(asc(SessionInputResultTable.joined_event_seq))
            .all()
            .pipe(Effect.orDie)
          const evidence = {
            sharedInputs: members.map((member) => member.inputID),
            ...(membership.terminal_event_id ? { resultEventID: membership.terminal_event_id } : {}),
          }
          if (membership.status === "processing") return { status: "processing", ...evidence }
          if (membership.status === "failed")
            return { status: "failed", error: membership.error ?? undefined, ...evidence }
          if (membership.status === "interrupted") return { status: "interrupted", ...evidence }
          if (membership.status !== "completed" || !membership.assistant_message_id)
            return { status: "unverified", ...evidence }
          const row = yield* db
            .select()
            .from(SessionMessageTable)
            .where(
              and(
                eq(SessionMessageTable.id, membership.assistant_message_id),
                eq(SessionMessageTable.session_id, input.sessionID),
              ),
            )
            .get()
            .pipe(Effect.orDie)
          if (!row) return { status: "unverified", ...evidence }
          const assistant = yield* SessionHistory.decodeMessageRow(row)
          if (
            assistant.type !== "assistant" ||
            assistant.time.completed === undefined ||
            assistant.error !== undefined ||
            assistant.needsContinuation !== false ||
            assistant.completion?.id !== membership.terminal_event_id ||
            assistant.completion?.seq !== membership.terminal_event_seq
          )
            return { status: "unverified", ...evidence }
          return { status: "completed", assistant, ...evidence }
        }
        const session = yield* db
          .select({ parentID: SessionTable.parent_id })
          .from(SessionTable)
          .where(eq(SessionTable.id, input.sessionID))
          .get()
          .pipe(Effect.orDie)
        if (!session) return { status: "missing" }
        if (session.parentID === null) return { status: "unverified" }
        // Pre-membership delegated children retain their original receipt contract.
        const rows = yield* db
          .select()
          .from(SessionMessageTable)
          .where(and(eq(SessionMessageTable.session_id, input.sessionID), gt(SessionMessageTable.seq, anchor.seq)))
          .orderBy(asc(SessionMessageTable.seq))
          .all()
          .pipe(Effect.orDie)
        for (const row of rows) {
          const message = yield* SessionHistory.decodeMessageRow(row)
          if (message.type === "idle") {
            if (message.outcome === "failed") return { status: "failed", error: message.error }
            if (message.outcome === "interrupted") return { status: "interrupted" }
            return { status: "unverified" }
          }
          if (message.type !== "assistant" || message.time.completed === undefined || message.error !== undefined)
            continue
          if (message.needsContinuation === undefined) return { status: "unverified" }
          if (!message.needsContinuation) return { status: "completed", assistant: message }
        }
        return { status: "processing" }
      }),
    )
    .pipe(Effect.catchTag("SqlError", Effect.die))
})
