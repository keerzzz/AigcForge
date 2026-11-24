export * as SessionProjector from "./projector.js"

import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm"
import { DateTime, Effect, Layer, Schema, Stream } from "effect"
import path from "path"
import { Database } from "../database/database.js"
import { Bus } from "../bus.js"
import { makeGlobalNode } from "@omnixa/util/effect/app-node"
import { Agent } from "@omnixa/schema/agent"
import { Model } from "@omnixa/schema/model"
import { SessionEvent } from "./event.js"
import { SessionTaskEvent } from "@omnixa/schema/session-task-event"
import { SessionTask } from "@omnixa/schema/session-task"
import { TaskOperation } from "./task-operation.js"
import { CommunicationRecord } from "./communication-record.js"
import { SessionCommunication } from "@omnixa/schema/session-communication"
import { SessionInputResult } from "./input-result.js"
import { SessionMessage } from "./message.js"
import { SessionMessageUpdater } from "./message-updater.js"
import { SessionUsage } from "./usage.js"
import { SessionComposition } from "./composition.js"
import type { SessionAttempt } from "@omnixa/schema/session-attempt"
import { isDeepStrictEqual } from "node:util"
import { SessionInbox } from "./inbox.js"
import { Consultation } from "./consultation.js"
import { Workspace } from "@omnixa/schema/workspace"
import { InstructionState } from "./instruction-state.js"
import { SessionInboxTable, SessionMessageTable, SessionTable } from "./sql.js"
import { InstructionEntry } from "./instruction-entry.js"
import { Slug } from "../util/slug.js"
import { FSUtil } from "@omnixa/util/fs-util"
import { Money } from "@omnixa/schema/money"
import { Worktree } from "@omnixa/schema/worktree"
import { Project } from "@omnixa/schema/project"
import { AbsolutePath, RelativePath } from "../schema.js"
import type { SessionSchema } from "./schema.js"
import { ProjectTable } from "../project/sql.js"
import { MetaAgentService } from "../meta-agent/service.js"
import { ControllerConflictError } from "./error.js"
import { fromRow } from "./info.js"

type DatabaseService = Database.Interface["db"]
type MessageEvent = Exclude<
  SessionEvent.DurableEvent,
  typeof SessionEvent.Forked.Type | typeof SessionEvent.Deleted.Type
>

const decodeMessage = Schema.decodeUnknownSync(SessionMessage.Info)
const encodeMessage = Schema.encodeSync(SessionMessage.Info)

export class SessionAlreadyProjected extends Error {}

type Usage = {
  cost: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
} & SessionAttempt.Accounting

const ForkBatchSize = 500

const forkTitle = (value?: string) => {
  if (value === undefined) return
  const match = value.match(/^(.+) \(fork #(\d+)\)$/)
  if (match) return `${match[1]} (fork #${Number.parseInt(match[2], 10) + 1})`
  return `${value} (fork #1)`
}

function applyUsage(db: DatabaseService, sessionID: SessionSchema.ID, value: Usage, timeUpdated?: number) {
  return db
    .update(SessionTable)
    .set({
      cost: sql`${SessionTable.cost} + ${value.cost}`,
      tokens_input: sql`${SessionTable.tokens_input} + ${value.tokens.input}`,
      tokens_output: sql`${SessionTable.tokens_output} + ${value.tokens.output}`,
      tokens_reasoning: sql`${SessionTable.tokens_reasoning} + ${value.tokens.reasoning}`,
      tokens_cache_read: sql`${SessionTable.tokens_cache_read} + ${value.tokens.cache.read}`,
      tokens_cache_write: sql`${SessionTable.tokens_cache_write} + ${value.tokens.cache.write}`,
      unknown_price_attempts:
        value.unknownPriceAttempts === undefined
          ? sql`${SessionTable.unknown_price_attempts}`
          : sql`coalesce(${SessionTable.unknown_price_attempts}, 0) + ${value.unknownPriceAttempts}`,
      missing_usage_attempts:
        value.missingUsageAttempts === undefined
          ? sql`${SessionTable.missing_usage_attempts}`
          : sql`coalesce(${SessionTable.missing_usage_attempts}, 0) + ${value.missingUsageAttempts}`,
      time_updated: timeUpdated ?? sql`${SessionTable.time_updated}`,
    })
    .where(eq(SessionTable.id, sessionID))
    .run()
    .pipe(Effect.orDie)
}

function touch(db: DatabaseService, event: MessageEvent) {
  return db
    .update(SessionTable)
    .set({ time_updated: event.created })
    .where(eq(SessionTable.id, event.data.sessionID))
    .run()
    .pipe(Effect.orDie)
}

const publishSessionUsage = Effect.fn("SessionProjector.publishUsage")(function* (
  db: DatabaseService,
  bus: Bus.Interface,
  sessionID: SessionSchema.ID,
) {
  const row = yield* db
    .select({
      cost: SessionTable.cost,
      input: SessionTable.tokens_input,
      output: SessionTable.tokens_output,
      reasoning: SessionTable.tokens_reasoning,
      cacheRead: SessionTable.tokens_cache_read,
      cacheWrite: SessionTable.tokens_cache_write,
      unknownPriceAttempts: SessionTable.unknown_price_attempts,
      missingUsageAttempts: SessionTable.missing_usage_attempts,
    })
    .from(SessionTable)
    .where(eq(SessionTable.id, sessionID))
    .get()
    .pipe(Effect.orDie)
  if (!row) return
  yield* bus.publish(SessionEvent.UsageUpdated, {
    sessionID,
    cost: Money.USD.make(row.cost),
    unknownPriceAttempts: row.unknownPriceAttempts ?? undefined,
    missingUsageAttempts: row.missingUsageAttempts ?? undefined,
    tokens: {
      input: row.input,
      output: row.output,
      reasoning: row.reasoning,
      cache: { read: row.cacheRead, write: row.cacheWrite },
    },
  })
})

const projectFork = Effect.fn("SessionProjector.projectFork")(function* (
  db: DatabaseService,
  event: typeof SessionEvent.Forked.Type,
) {
  const parent = yield* db
    .select()
    .from(SessionTable)
    .where(eq(SessionTable.id, event.data.parentID))
    .get()
    .pipe(Effect.orDie)
  if (!parent) return yield* Effect.die(new Error(`Fork parent session not found: ${event.data.parentID}`))
  const boundary = yield* db
    .select({ seq: SessionMessageTable.seq })
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, event.data.parentID),
        eq(SessionMessageTable.id, event.data.boundary.messageID),
      ),
    )
    .get()
    .pipe(Effect.orDie)
  if (!boundary)
    return yield* Effect.die(new Error(`Fork boundary message not found: ${event.data.boundary.messageID}`))
  const copied = yield* db
    .select({ seq: SessionMessageTable.seq })
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, event.data.parentID),
        event.data.boundary.type === "before"
          ? lt(SessionMessageTable.seq, boundary.seq)
          : lte(SessionMessageTable.seq, boundary.seq),
      ),
    )
    .orderBy(desc(SessionMessageTable.seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  const copiedSeq = copied?.seq

  const stored = yield* db
    .insert(SessionTable)
    .values({
      id: event.data.sessionID,
      parent_id: event.data.child ? parent.id : null,
      fork_session_id: event.data.parentID,
      fork_boundary: event.data.boundary,
      project_id: parent.project_id,
      mode: parent.mode,
      workspace_id: parent.workspace_id,
      slug: Slug.create(),
      directory: parent.directory,
      path: parent.path,
      title: forkTitle(parent.title ?? undefined),
      agent: event.data.controller?.kind === "root" ? Agent.ID.make("meta") : (event.data.agent ?? parent.agent),
      model: event.data.model ?? parent.model,
      controller: event.data.controller,
      executor_preference: event.data.executorPreference,
      metadata: parent.metadata,
      permission: parent.permission,
      version: parent.version,
      attended: event.data.child ? 0 : null,
      cost: 0,
      tokens_input: 0,
      tokens_output: 0,
      tokens_reasoning: 0,
      tokens_cache_read: 0,
      tokens_cache_write: 0,
      time_created: event.created,
      time_updated: event.created,
    })
    .onConflictDoNothing()
    .returning({ sessionID: SessionTable.id })
    .get()
    .pipe(Effect.orDie)
  if (!stored) return yield* Effect.die(new SessionAlreadyProjected())

  if (event.data.instructionEntries)
    yield* InstructionEntry.initialize(db, event.data.sessionID, event.data.instructionEntries, event.created)

  let cursor = -1
  while (copiedSeq !== undefined) {
    const rows = yield* db
      .select()
      .from(SessionMessageTable)
      .where(
        and(
          eq(SessionMessageTable.session_id, event.data.parentID),
          gt(SessionMessageTable.seq, cursor),
          lt(SessionMessageTable.seq, copiedSeq + 1),
          // Terminal events for active projections stay on the parent, so forks copy only settled history.
          sql`${SessionMessageTable.type} != 'assistant' or json_extract(${SessionMessageTable.data}, '$.time.completed') is not null`,
          sql`${SessionMessageTable.type} != 'shell' or json_extract(${SessionMessageTable.data}, '$.status') != 'running'`,
          sql`${SessionMessageTable.type} != 'compaction' or json_extract(${SessionMessageTable.data}, '$.status') != 'running'`,
        ),
      )
      .orderBy(asc(SessionMessageTable.seq))
      .limit(ForkBatchSize)
      .all()
      .pipe(Effect.orDie)
    if (rows.length === 0) break

    yield* db
      .insert(SessionMessageTable)
      .values(
        rows.map((row) => ({
          id: SessionMessage.ID.make(`${SessionMessage.ID.fromEvent(event.id)}_${row.seq}`),
          session_id: event.data.sessionID,
          type: row.type,
          seq: row.seq,
          time_created: row.time_created,
          time_updated: row.time_updated,
          data: {
            ...row.data,
            origin: { kind: "historical" as const },
            ...(row.type === "assistant" ? { completion: undefined } : {}),
          },
        })),
      )
      .run()
      .pipe(Effect.orDie)

    cursor = rows.at(-1)!.seq
  }
  if (copiedSeq !== undefined) yield* Bus.reserveSequence(db, event.data.sessionID, copiedSeq)
  if (event.data.instructions)
    yield* InstructionState.initialize(db, event.data.sessionID, event.durable.seq, event.data.instructions)
})

function run(db: DatabaseService, event: MessageEvent) {
  return Effect.gen(function* () {
    const decodeRow = (row: typeof SessionMessageTable.$inferSelect) =>
      decodeMessage({ ...row.data, id: row.id, type: row.type })
    const updateMessage = (message: SessionMessage.Info) => {
      const encoded = encodeMessage(message)
      const { id, type, ...data } = encoded
      return db
        .update(SessionMessageTable)
        .set({ type, time_created: DateTime.toEpochMillis(message.time.created), data })
        .where(
          and(
            eq(SessionMessageTable.id, SessionMessage.ID.make(id)),
            eq(SessionMessageTable.session_id, event.data.sessionID),
          ),
        )
        .run()
        .pipe(Effect.orDie)
    }
    const appendMessage = (message: SessionMessage.Info) => insertMessage(db, event, message)
    const adapter: SessionMessageUpdater.Adapter = {
      getAgent() {
        return db
          .select({ agent: SessionTable.agent })
          .from(SessionTable)
          .where(eq(SessionTable.id, event.data.sessionID))
          .get()
          .pipe(
            Effect.orDie,
            Effect.map((row) => (row?.agent ? Agent.ID.make(row.agent) : undefined)),
          )
      },
      getModel() {
        return db
          .select({ model: SessionTable.model })
          .from(SessionTable)
          .where(eq(SessionTable.id, event.data.sessionID))
          .get()
          .pipe(
            Effect.orDie,
            Effect.map((row) => (row?.model ? Schema.decodeUnknownSync(Model.Selection)(row.model) : undefined)),
          )
      },
      getLocation() {
        return db
          .select({
            directory: SessionTable.directory,
            workspaceID: SessionTable.workspace_id,
            projectID: SessionTable.project_id,
            subpath: SessionTable.path,
          })
          .from(SessionTable)
          .where(eq(SessionTable.id, event.data.sessionID))
          .get()
          .pipe(
            Effect.orDie,
            Effect.map((row) =>
              row
                ? {
                    location: {
                      directory: AbsolutePath.make(row.directory),
                      workspaceID: row.workspaceID ? Workspace.ID.make(row.workspaceID) : undefined,
                    },
                    projectID: row.projectID,
                    subpath: row.subpath === null ? undefined : RelativePath.make(row.subpath),
                  }
                : undefined,
            ),
          )
      },
      getCurrentAssistant() {
        return Effect.gen(function* () {
          // A newer step supersedes stale incomplete rows; never resume an older assistant projection.
          const row = yield* db
            .select()
            .from(SessionMessageTable)
            .where(
              and(eq(SessionMessageTable.session_id, event.data.sessionID), eq(SessionMessageTable.type, "assistant")),
            )
            .orderBy(desc(SessionMessageTable.seq))
            .limit(1)
            .get()
            .pipe(Effect.orDie)
          if (!row) return
          const message = decodeRow(row)
          return message.type === "assistant" && !message.time.completed ? message : undefined
        })
      },
      getAssistant(messageID) {
        return Effect.gen(function* () {
          const row = yield* db
            .select()
            .from(SessionMessageTable)
            .where(
              and(
                eq(SessionMessageTable.id, messageID),
                eq(SessionMessageTable.session_id, event.data.sessionID),
                eq(SessionMessageTable.type, "assistant"),
              ),
            )
            .get()
            .pipe(Effect.orDie)
          if (!row) return
          const message = decodeRow(row)
          return message.type === "assistant" ? message : undefined
        })
      },
      getShell(shellID) {
        return Effect.gen(function* () {
          const row = yield* db
            .select()
            .from(SessionMessageTable)
            .where(
              and(
                eq(SessionMessageTable.session_id, event.data.sessionID),
                eq(SessionMessageTable.type, "shell"),
                sql`json_extract(${SessionMessageTable.data}, '$.shellID') = ${shellID}`,
              ),
            )
            .orderBy(desc(SessionMessageTable.seq))
            .limit(1)
            .get()
            .pipe(Effect.orDie)
          if (!row) return
          const message = decodeRow(row)
          return message.type === "shell" ? message : undefined
        })
      },
      getCompaction() {
        return Effect.gen(function* () {
          const row = yield* db
            .select()
            .from(SessionMessageTable)
            .where(
              and(
                eq(SessionMessageTable.session_id, event.data.sessionID),
                eq(SessionMessageTable.type, "compaction"),
                sql`json_extract(${SessionMessageTable.data}, '$.status') = 'running'`,
              ),
            )
            .orderBy(desc(SessionMessageTable.seq))
            .limit(1)
            .get()
            .pipe(Effect.orDie)
          if (!row) return
          const message = decodeRow(row)
          return message.type === "compaction" ? message : undefined
        })
      },
      updateAssistant: updateMessage,
      updateShell: updateMessage,
      updateCompaction: updateMessage,
      appendMessage,
    }
    yield* SessionMessageUpdater.update(adapter, event)
  })
}

function insertMessage(
  db: DatabaseService,
  event: SessionEvent.DurableEvent | typeof SessionTaskEvent.OperationReserved.Type,
  message: SessionMessage.Info,
) {
  const encoded = encodeMessage(message)
  const { id, type, ...data } = encoded
  return db
    .insert(SessionMessageTable)
    .values({
      id: SessionMessage.ID.make(id),
      session_id: event.data.sessionID,
      type,
      seq: event.durable.seq,
      time_created: DateTime.toEpochMillis(message.time.created),
      data,
    })
    .run()
    .pipe(Effect.orDie)
}

function projectIdle(
  db: DatabaseService,
  event:
    | typeof SessionEvent.Execution.Succeeded.Type
    | typeof SessionEvent.Execution.Failed.Type
    | typeof SessionEvent.Execution.Interrupted.Type,
) {
  return Effect.gen(function* () {
    yield* run(db, event)
    yield* SessionInputResult.projectTerminal(db, event)
    if (event.type === SessionEvent.Execution.Interrupted.type && event.data.reason === "shutdown") return
    const time = event.created
    const outcome =
      event.type === SessionEvent.Execution.Succeeded.type
        ? "succeeded"
        : event.type === SessionEvent.Execution.Failed.type
          ? "failed"
          : "interrupted"
    yield* db
      .update(SessionTable)
      .set({
        // Unread uses a strict timestamp comparison, so every terminal must advance even within one millisecond.
        time_idle: sql`max(${time}, coalesce(${SessionTable.time_idle} + 1, ${time}))`,
        idle_outcome: outcome,
        time_updated: sql`${SessionTable.time_updated}`,
      })
      .where(eq(SessionTable.id, event.data.sessionID))
      .run()
      .pipe(Effect.orDie)
  })
}

/** The Assistant owns one logical settlement; distinct receipt IDs cannot bill it twice. */
const projectStepTerminal = Effect.fn("SessionProjector.projectStepTerminal")(function* (
  db: DatabaseService,
  event: SessionEvent.Step.Ended | SessionEvent.Step.Failed,
) {
  const row = yield* db
    .select()
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, event.data.sessionID),
        eq(SessionMessageTable.id, event.data.assistantMessageID),
        eq(SessionMessageTable.type, "assistant"),
      ),
    )
    .get()
    .pipe(Effect.orDie)
  const assistant = row === undefined ? undefined : decodeMessage({ ...row.data, id: row.id, type: row.type })
  const accounting = {
    cost: event.data.cost,
    tokens: event.data.tokens,
    unknownPriceAttempts: event.data.unknownPriceAttempts,
    missingUsageAttempts: event.data.missingUsageAttempts,
  }
  if (assistant?.type === "assistant" && assistant.attempts !== undefined) {
    if (assistant.attempts.length === 0 || assistant.attempts.some((attempt) => attempt.terminal === undefined))
      return yield* Effect.die(
        new Bus.InvalidDurableEventError({
          type: event.type,
          message: "Logical settlement requires every physical attempt terminal",
        }),
      )
    if (!isDeepStrictEqual(accounting, SessionUsage.aggregate(assistant.attempts)))
      return yield* Effect.die(
        new Bus.InvalidDurableEventError({
          type: event.type,
          message: "Logical accounting conflicts with persisted physical receipts",
        }),
      )
    if (assistant.unknownPriceAttempts !== undefined || assistant.missingUsageAttempts !== undefined) {
      const terminal =
        event.type === SessionEvent.Step.Ended.type
          ? {
              finish: event.data.finish,
              needsContinuation: event.data.needsContinuation,
              rawFinish: event.data.rawFinish,
              providerState: event.data.providerState,
              error: undefined,
            }
          : {
              finish: event.data.finish ?? "error",
              needsContinuation: undefined,
              rawFinish: event.data.rawFinish,
              providerState: event.data.providerState,
              error: event.data.error,
            }
      if (
        !isDeepStrictEqual(
          {
            ...accounting,
            ...terminal,
          },
          {
            cost: assistant.cost,
            tokens: assistant.tokens,
            unknownPriceAttempts: assistant.unknownPriceAttempts,
            missingUsageAttempts: assistant.missingUsageAttempts,
            finish: assistant.finish,
            needsContinuation: assistant.needsContinuation,
            rawFinish: assistant.rawFinish,
            providerState: assistant.providerState,
            error: assistant.error,
          },
        )
      )
        return yield* Effect.die(
          new Bus.InvalidDurableEventError({ type: event.type, message: "Conflicting logical Step settlement" }),
        )
      return
    }
  }
  if (
    assistant === undefined &&
    (accounting.unknownPriceAttempts !== undefined || accounting.missingUsageAttempts !== undefined)
  )
    return yield* Effect.die(
      new Bus.InvalidDurableEventError({ type: event.type, message: "Logical receipt has no owned Assistant" }),
    )
  yield* run(db, event)
  if (event.data.cost !== undefined && event.data.tokens !== undefined) {
    yield* applyUsage(
      db,
      event.data.sessionID,
      {
        ...accounting,
        cost: event.data.cost,
        tokens: event.data.tokens,
      },
      event.created,
    )
    return
  }
  yield* touch(db, event)
})

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const db = (yield* Database.Service).db
    const metas = yield* MetaAgentService.Service
    const compositions = yield* SessionComposition.Service
    const projectGroupBehavior = Effect.fnUntraced(function* (event: SessionEvent.Created | SessionEvent.Forked) {
      const row = yield* db
        .select()
        .from(SessionTable)
        .where(eq(SessionTable.id, event.data.sessionID))
        .get()
        .pipe(Effect.orDie)
      if (row === undefined) return
      const behavior =
        row.controller?.kind === "child" ? row.controller.executor.groupBehavior : event.data.groupBehavior
      if (yield* compositions.exists(event.data.sessionID))
        yield* compositions
          .updateGroupBehavior(event.data.sessionID, behavior, row.agent ?? undefined)
          .pipe(Effect.orDie)
      if (
        row.controller?.kind === "root" &&
        row.model !== null &&
        (yield* metas.get(row.controller.metaAgentID)) !== undefined
      )
        yield* metas.setModel({
          id: row.controller.metaAgentID,
          model: Schema.decodeUnknownSync(Model.Selection)(row.model),
          groupBehavior: behavior,
          updated: event.created,
        })
    })
    yield* bus.project(SessionEvent.Created, (event) =>
      Effect.gen(function* () {
        const parent = event.data.parentID
          ? yield* db
              .select({ mode: SessionTable.mode })
              .from(SessionTable)
              .where(eq(SessionTable.id, event.data.parentID))
              .get()
              .pipe(Effect.orDie)
          : undefined
        const stored = yield* db
          .insert(SessionTable)
          .values({
            id: event.data.sessionID,
            project_id: event.data.projectID,
            workspace_id: event.data.location.workspaceID ? Workspace.ID.make(event.data.location.workspaceID) : null,
            parent_id: event.data.parentID,
            mode: parent?.mode ?? event.data.mode,
            slug: event.data.slug,
            directory: event.data.location.directory,
            path: event.data.subpath,
            title: event.data.title,
            agent: event.data.agent,
            controller: event.data.controller,
            executor_preference: event.data.executorPreference,
            model: event.data.model,
            metadata: event.data.metadata,
            permission: event.data.permissions,
            version: event.data.version,
            // Root sessions default attended (column default 0 is legacy-migration
            // compatibility only, plan §3.4); children default unattended so
            // background jobs fail fast on ask instead of parking.
            attended: event.data.parentID ? 0 : null,
            time_created: event.created,
            time_updated: event.created,
          })
          .onConflictDoNothing()
          .returning({ sessionID: SessionTable.id })
          .get()
          .pipe(Effect.orDie)
        if (!stored) return yield* Effect.die(new SessionAlreadyProjected())
        if (event.data.consultation)
          yield* Consultation.reserve(db, event.data.sessionID, event.data.consultation).pipe(Effect.orDie)
        yield* projectGroupBehavior(event)
      }),
    )
    yield* bus.project(SessionEvent.Moved, (event) =>
      Effect.gen(function* () {
        yield* run(db, event)
        yield* db
          .update(SessionTable)
          .set({
            directory: event.data.location.directory,
            path: event.data.subpath,
            ...(event.data.projectID ? { project_id: event.data.projectID } : {}),
            workspace_id: event.data.location.workspaceID ? Workspace.ID.make(event.data.location.workspaceID) : null,
            time_updated: event.created,
          })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
      }),
    )
    // Sessions whose ownership came from the directory's previous resolution
    // follow its new identity. Location, transcript, instructions, and recency
    // are untouched: the session did not move, its directory got identified.
    yield* bus.project(Worktree.Event.Resolved, (event) =>
      Effect.gen(function* () {
        const candidates = [
          ...new Set(
            [event.data.previous, Project.ID.global, ...(event.data.adopted ?? [])].filter(
              (id) => id !== event.data.projectID,
            ),
          ),
        ]
        if (candidates.length === 0) return
        const rows = yield* db
          .select({
            id: SessionTable.id,
            directory: SessionTable.directory,
            projectID: SessionTable.project_id,
            canonical: ProjectTable.worktree,
          })
          .from(SessionTable)
          .innerJoin(ProjectTable, eq(SessionTable.project_id, ProjectTable.id))
          .where(
            and(
              inArray(SessionTable.project_id, candidates),
              isNull(SessionTable.workspace_id),
              or(
                event.data.adopted?.length ? inArray(SessionTable.project_id, event.data.adopted) : undefined,
                and(
                  gte(SessionTable.directory, event.data.directory),
                  lte(SessionTable.directory, AbsolutePath.make(event.data.directory + "\uffff")),
                ),
              ),
            ),
          )
          .all()
          .pipe(Effect.orDie)
        yield* Effect.forEach(
          rows,
          (row) => {
            const directory = event.data.adopted?.includes(row.projectID)
              ? row.canonical
              : AbsolutePath.make(path.resolve(row.directory))
            if (!FSUtil.contains(event.data.directory, directory)) return Effect.void
            return db
              .update(SessionTable)
              .set({
                project_id: event.data.projectID,
                path: RelativePath.make(path.relative(event.data.directory, directory).replaceAll("\\", "/")),
                // Self-assignment suppresses the column's $onUpdate: adoption is not activity.
                time_updated: sql`${SessionTable.time_updated}`,
              })
              .where(eq(SessionTable.id, row.id))
              .run()
              .pipe(Effect.orDie)
          },
          { discard: true },
        )
      }),
    )
    yield* bus.project(SessionEvent.Deleted, (event) =>
      db.delete(SessionTable).where(eq(SessionTable.id, event.data.sessionID)).run().pipe(Effect.orDie),
    )
    yield* bus.project(SessionEvent.AgentSelected, (event) =>
      Effect.gen(function* () {
        const row = yield* db
          .select()
          .from(SessionTable)
          .where(eq(SessionTable.id, event.data.sessionID))
          .get()
          .pipe(Effect.orDie)
        const controller = event.data.controller
        if (event.data.model || controller) {
          if (!row || (row.agent ?? undefined) !== event.data.previous)
            return yield* new ControllerConflictError({
              sessionID: event.data.sessionID,
              field: "agent",
              kind: "agent_selection_conflict",
              message: "Session Agent changed before selection committed",
            })
          if (
            controller &&
            (event.data.agent !== "meta" ||
              !event.data.model ||
              controller.rootSessionID !== row.id ||
              row.parent_id !== null ||
              (row.controller &&
                (row.controller.kind !== "root" ||
                  row.controller.metaAgentID !== controller.metaAgentID ||
                  row.controller.rootSessionID !== controller.rootSessionID)))
          )
            return yield* new ControllerConflictError({
              sessionID: row.id,
              field: "controller",
              kind: "meta_activation_conflict",
              message: "Meta activation conflicts with the Session identity or saved ownership",
            })
          if (row.controller) yield* metas.assertOwner(fromRow(row))
        }
        yield* run(db, event)
        yield* db
          .update(SessionTable)
          .set({
            agent: event.data.agent,
            ...(event.data.model ? { model: event.data.model } : {}),
            ...(controller ? { controller } : {}),
            time_updated: event.created,
          })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
        if (controller && !row?.controller && event.data.model) {
          yield* metas.create({
            id: controller.metaAgentID,
            title: row?.title ?? "Meta",
            agent: "meta",
            model: event.data.model,
            created: event.created,
          })
          yield* metas.attach({
            metaID: controller.metaAgentID,
            sessionID: event.data.sessionID,
            role: "orchestrator",
            created: event.created,
          })
        }
      }).pipe(Effect.orDie),
    )
    yield* bus.project(SessionEvent.ModelSelected, (event) =>
      Effect.gen(function* () {
        const row = yield* db
          .select()
          .from(SessionTable)
          .where(eq(SessionTable.id, event.data.sessionID))
          .get()
          .pipe(Effect.orDie)
        yield* run(db, event)
        yield* db
          .update(SessionTable)
          .set({ model: event.data.model, time_updated: event.created })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
        if (row?.controller?.kind === "root" && row.agent === "meta")
          yield* metas.setModel({
            id: row.controller.metaAgentID,
            model: event.data.model,
            groupBehavior: event.data.groupBehavior,
            updated: event.created,
          })
        if (row !== undefined && (yield* compositions.exists(event.data.sessionID)))
          yield* compositions
            .updateGroupBehavior(event.data.sessionID, event.data.groupBehavior, row.agent ?? undefined)
            .pipe(Effect.orDie)
      }),
    )
    yield* bus.project(SessionEvent.ExecutorSelected, (event) =>
      db
        .update(SessionTable)
        .set({ executor_preference: event.data.executorPreference, time_updated: event.created })
        .where(eq(SessionTable.id, event.data.sessionID))
        .run()
        .pipe(Effect.orDie),
    )
    yield* bus.project(SessionEvent.Renamed, (event) =>
      db
        .update(SessionTable)
        .set({ title: event.data.title, time_updated: event.created })
        .where(eq(SessionTable.id, event.data.sessionID))
        .run()
        .pipe(Effect.orDie),
    )
    yield* bus.project(SessionEvent.MetadataUpdated, (event) =>
      db
        .update(SessionTable)
        .set({ metadata: event.data.metadata, time_updated: event.created })
        .where(eq(SessionTable.id, event.data.sessionID))
        .run()
        .pipe(Effect.orDie),
    )
    yield* bus.project(SessionEvent.Permissions, (event) =>
      db
        .update(SessionTable)
        .set({ permission: event.data.permissions, time_updated: event.created })
        .where(eq(SessionTable.id, event.data.sessionID))
        .run()
        .pipe(Effect.orDie),
    )
    yield* bus.project(SessionEvent.Viewed, (event) => {
      const idle = event.data.idle
      return db
        .update(SessionTable)
        .set({
          // Monotone watermark: a duplicate or stale view never regresses, and a terminal event
          // committing after the viewer's observation keeps the newer idle transition unread.
          time_viewed: sql`max(${idle}, coalesce(${SessionTable.time_viewed}, ${idle}))`,
          time_updated: sql`${SessionTable.time_updated}`,
        })
        .where(eq(SessionTable.id, event.data.sessionID))
        .run()
        .pipe(Effect.orDie)
    })
    yield* bus.project(SessionEvent.MessageContentUpdated, (event) => run(db, event))
    yield* bus.project(SessionEvent.UsageRecorded, (event) => applyUsage(db, event.data.sessionID, event.data))
    yield* bus.project(SessionEvent.Forked, (event) =>
      projectFork(db, event).pipe(Effect.andThen(projectGroupBehavior(event))),
    )
    yield* bus.project(SessionEvent.InboxDelivered, (event) =>
      Effect.gen(function* () {
        const input = yield* SessionInbox.projectDelivered(db, {
          id: event.data.inboxID,
          sessionID: event.data.sessionID,
        })
        if (input.type === "compaction" || input.type === "move") return
        yield* insertMessage(
          db,
          event,
          input.type === "user"
            ? {
                id: input.id,
                type: "user",
                origin:
                  event.data.correctionSourceVersion === 1
                    ? new SessionMessage.ProducedOrigin({
                        kind: "inbox-user",
                        sessionID: event.data.sessionID,
                        id: event.id,
                        seq: event.durable.seq,
                      })
                    : { kind: "historical" },
                metadata: input.payload.metadata,
                text: input.payload.text,
                files: input.payload.files,
                agents: input.payload.agents,
                skills: input.payload.skills,
                time: { created: DateTime.makeUnsafe(event.created) },
              }
            : {
                id: input.id,
                type: "synthetic",
                origin: new SessionMessage.ProducedOrigin({
                  kind: "inbox-synthetic",
                  sessionID: event.data.sessionID,
                  id: event.id,
                  seq: event.durable.seq,
                }),
                text: input.payload.text,
                description: input.payload.description,
                metadata: input.payload.metadata,
                time: { created: DateTime.makeUnsafe(event.created) },
              },
        )
        yield* SessionInputResult.projectMembership(db, event)
        if (input.type === "user") yield* Consultation.projectDelivered(db, input).pipe(Effect.orDie)
        yield* metas.materialize(event)
      }),
    )
    yield* bus.project(SessionEvent.InboxEnqueued, (event) =>
      Effect.gen(function* () {
        yield* Consultation.projectAdmitted(db, {
          id: event.data.inboxID,
          sessionID: event.data.sessionID,
          item: event.data.item,
          operation: event.data.consultation,
        }).pipe(Effect.orDie)
        yield* SessionInbox.projectAdmitted(db, {
          enqueuedSeq: event.durable.seq,
          id: event.data.inboxID,
          sessionID: event.data.sessionID,
          item: event.data.item,
          timeCreated: event.created,
        })
        yield* TaskOperation.projectAdmission(db, event).pipe(Effect.orDie)
        if (event.data.communication) {
          if (event.data.item.type !== "synthetic")
            return yield* Effect.die(
              new SessionCommunication.Error({
                sessionID: event.data.sessionID,
                communicationID: event.data.communication.id,
                reason: "invalid_carrier",
                message: "Communication requires its original synthetic Inbox carrier",
              }),
            )
          yield* CommunicationRecord.project(db, {
            record: event.data.communication,
            text: event.data.item.payload.text,
            inputID: event.data.inboxID,
            sessionID: event.data.sessionID,
          }).pipe(Effect.orDie)
        }
        yield* db
          .update(SessionTable)
          .set({ time_updated: event.created })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
      }),
    )
    yield* bus.project(SessionEvent.InboxCancelled, (event) =>
      SessionInbox.projectCancelled(db, {
        id: event.data.inboxID,
        sessionID: event.data.sessionID,
      }),
    )
    yield* bus.project(SessionEvent.InboxDeliveryChanged, (event) =>
      SessionInbox.projectDeliveryChanged(db, {
        id: event.data.inboxID,
        sessionID: event.data.sessionID,
        delivery: event.data.delivery,
      }),
    )
    yield* bus.project(SessionEvent.Execution.Succeeded, (event) => projectIdle(db, event))
    yield* bus.project(SessionEvent.Execution.Failed, (event) => projectIdle(db, event))
    yield* bus.project(SessionEvent.Execution.Interrupted, (event) => projectIdle(db, event))
    yield* bus.project(SessionEvent.InstructionsUpdated, (event) =>
      Effect.gen(function* () {
        yield* run(db, event)
        yield* InstructionState.apply(db, event.data.sessionID, event.durable.seq, event.data.delta)
      }),
    )
    yield* bus.project(SessionEvent.Synthetic, (event) => run(db, event))
    yield* bus.project(SessionEvent.Skill.Activated, (event) => run(db, event))
    yield* bus.project(SessionEvent.Shell.Started, (event) => run(db, event))
    yield* bus.project(SessionEvent.Shell.Ended, (event) => run(db, event))
    yield* bus.project(SessionEvent.Attempt.Started, (event) => run(db, event).pipe(Effect.andThen(touch(db, event))))
    yield* bus.project(SessionEvent.Attempt.Observed, (event) => run(db, event))
    yield* bus.project(SessionEvent.Attempt.Ended, (event) => run(db, event))
    yield* bus.project(SessionEvent.Step.Started, (event) =>
      Effect.gen(function* () {
        yield* run(db, event)
        yield* touch(db, event)
      }),
    )
    yield* bus.project(SessionEvent.Step.Streamed, (event) => run(db, event))
    yield* bus.project(SessionEvent.Step.Completed, (event) =>
      Effect.gen(function* () {
        yield* run(db, event)
        yield* SessionInputResult.projectCompletion(db, event)
      }),
    )
    yield* bus.project(SessionEvent.Step.Ended, (event) => projectStepTerminal(db, event))
    yield* bus.project(SessionEvent.Step.Failed, (event) => projectStepTerminal(db, event))
    yield* bus.project(SessionEvent.Text.Started, (event) => run(db, event))
    yield* bus.project(SessionEvent.Text.Ended, (event) => run(db, event))
    yield* bus.project(SessionEvent.Tool.Input.Started, (event) => run(db, event))
    yield* bus.project(SessionEvent.Tool.Input.Ended, (event) => run(db, event))
    yield* bus.project(SessionEvent.Tool.Called, (event) => run(db, event))
    yield* bus.project(SessionEvent.Tool.Success, (event) => run(db, event))
    yield* bus.project(SessionEvent.Tool.Failed, (event) => run(db, event))
    yield* bus.project(SessionEvent.Reasoning.Started, (event) => run(db, event))
    yield* bus.project(SessionEvent.Reasoning.Ended, (event) => run(db, event))
    yield* bus.project(SessionEvent.RetryScheduled, (event) => run(db, event))
    yield* bus.project(SessionEvent.Compaction.Started, (event) => run(db, event))
    yield* bus.project(SessionEvent.Compaction.Ended, (event) =>
      Effect.gen(function* () {
        yield* run(db, event)
        yield* InstructionState.advanceEpoch(db, event.data.sessionID, event.durable.seq)
      }),
    )
    yield* bus.project(SessionEvent.Compaction.Failed, (event) => run(db, event))
    yield* bus.project(SessionEvent.RevertEvent.Staged, (event) =>
      Effect.gen(function* () {
        const revert = event.data.revert
        yield* db
          .update(SessionTable)
          .set({
            revert: { ...revert, files: revert.files ? [...revert.files] : undefined },
            time_updated: event.created,
          })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
      }),
    )
    yield* bus.project(SessionEvent.RevertEvent.Cleared, (event) =>
      db
        .update(SessionTable)
        .set({ revert: null, time_updated: event.created })
        .where(eq(SessionTable.id, event.data.sessionID))
        .run()
        .pipe(Effect.orDie, Effect.asVoid),
    )
    yield* bus.project(SessionEvent.RevertEvent.Committed, (event) =>
      Effect.gen(function* () {
        const boundary = yield* db
          .select({ seq: SessionMessageTable.seq })
          .from(SessionMessageTable)
          .where(
            and(eq(SessionMessageTable.session_id, event.data.sessionID), eq(SessionMessageTable.id, event.data.to)),
          )
          .get()
          .pipe(Effect.orDie)
        if (!boundary) return yield* Effect.die(new Error(`Revert boundary message not found: ${event.data.to}`))
        if (event.data.boundarySeq !== undefined && event.data.boundarySeq !== boundary.seq)
          return yield* Effect.die(new Error(`Revert boundary sequence changed: ${event.data.to}`))
        yield* Consultation.projectReverted(db, {
          sessionID: event.data.sessionID,
          boundarySeq: boundary.seq,
        }).pipe(Effect.orDie)
        // A retained assistant can finish after the cut even though its insertion precedes it.
        yield* db
          .update(SessionMessageTable)
          .set({ data: sql`json_remove(${SessionMessageTable.data}, '$.completion')` })
          .where(
            and(
              eq(SessionMessageTable.session_id, event.data.sessionID),
              eq(SessionMessageTable.type, "assistant"),
              gte(sql<number>`json_extract(${SessionMessageTable.data}, '$.completion.seq')`, boundary.seq),
            ),
          )
          .run()
          .pipe(Effect.orDie)
        yield* db
          .delete(SessionMessageTable)
          .where(
            and(eq(SessionMessageTable.session_id, event.data.sessionID), gte(SessionMessageTable.seq, boundary.seq)),
          )
          .run()
          .pipe(Effect.orDie)
        yield* db
          .delete(SessionInboxTable)
          .where(
            and(
              eq(SessionInboxTable.session_id, event.data.sessionID),
              gte(SessionInboxTable.enqueued_seq, boundary.seq),
            ),
          )
          .run()
          .pipe(Effect.orDie)
        yield* db
          .update(SessionTable)
          .set({ revert: null, time_updated: event.created })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
        yield* InstructionState.reset(db, event.data.sessionID)
      }),
    )
    yield* bus.project(SessionTaskEvent.OperationReserved, (event) =>
      Effect.gen(function* () {
        yield* TaskOperation.projectReserved(db, event.data, event.created, event.durable.seq)
        if (event.data.source.type === "model_tool") return
        yield* insertMessage(db, event, {
          id: TaskOperation.statusMessageID({
            sessionID: event.data.sessionID,
            operationID: event.data.request.operationID,
          }),
          type: "synthetic",
          origin: new SessionMessage.ProducedOrigin({
            kind: "core-synthetic",
            sessionID: event.data.sessionID,
            id: event.id,
            seq: event.durable.seq,
          }),
          text: `Task coordination: ${event.data.request.description ?? event.data.request.prompt}`,
          description: event.data.request.description,
          metadata: {
            coordination: new SessionTask.TaskCoordination({
              kind: "task",
              operationRef: { sourceSessionID: event.data.sessionID, operationID: event.data.request.operationID },
              actorSessionID: event.data.sessionID,
              actorAgent: event.data.source.agent,
              targetSessionID: event.data.targetSessionID,
            }),
          },
          time: { created: DateTime.makeUnsafe(event.created) },
        })
        yield* db
          .update(SessionTable)
          .set({ time_updated: event.created })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
      }),
    )
    yield* bus.project(SessionTaskEvent.OperationChanged, (event) =>
      TaskOperation.projectChanged(db, event.data, event.created, event.durable.seq),
    )
    yield* Effect.forEach(
      [
        SessionEvent.Attempt.Started,
        SessionEvent.Attempt.Ended,
        SessionEvent.Step.Started,
        SessionEvent.Step.Ended,
        SessionEvent.Step.Failed,
        SessionEvent.Tool.Called,
        SessionEvent.Tool.Success,
        SessionEvent.Tool.Failed,
        SessionEvent.RetryScheduled,
      ],
      (definition) => bus.project(definition, (event) => metas.materialize(event)),
      { discard: true },
    )
    yield* bus.subscribe([SessionEvent.Step.Ended, SessionEvent.Step.Failed, SessionEvent.UsageRecorded]).pipe(
      Stream.runForEach((event) => {
        if (
          event.type === SessionEvent.Step.Failed.type &&
          (event.data.cost === undefined || event.data.tokens === undefined)
        )
          return Effect.void
        return publishSessionUsage(db, bus, event.data.sessionID)
      }),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
)

export const node = makeGlobalNode({
  name: "session-projector",
  layer,
  deps: [Bus.node, Database.node, MetaAgentService.node, SessionComposition.node],
})
