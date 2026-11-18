import type { Message } from "@aigcfroge/ai"
import { and, desc, eq, inArray, lt } from "drizzle-orm"
import { Effect, Option, Schema, Stream } from "effect"
import path from "node:path"
import { Event } from "@aigcfroge/schema/event"
import { SessionTask } from "@aigcfroge/schema/session-task"
import type { FSUtil } from "@aigcfroge/util/fs-util"
import { Bus } from "../bus.js"
import type { Database } from "../database/database.js"
import { EventTable } from "../event/sql.js"
import type { Session } from "../session.js"
import { SessionEvent } from "./event.js"
import { SessionHistory } from "./history.js"
import { SessionInbox } from "./inbox.js"
import type { SessionMessage } from "./message.js"
import { SessionMessageTable } from "./sql.js"
import type { SessionStore } from "./store.js"
import type { Interface } from "./task.js"
import { TaskOperation } from "./task-operation.js"
import { CompositionDigest } from "../composition/digest.js"

/** Inspect the durable notification marker before admitting it or waking its Session. */
export const inspect = Effect.fn("SessionNotification.inspect")(function* (
  db: Database.Interface["db"],
  bus: Bus.Interface,
  store: SessionStore.Interface,
  input: { readonly sessionID: Session.ID; readonly inboxID: SessionMessage.ID },
) {
  if (yield* store.message(input.inboxID)) return { admit: false, wake: false }
  const lifecycle = yield* bus.log({ aggregateID: input.sessionID }).pipe(
    Stream.runFold(
      () => ({ admitted: false, cancelled: false, blocked: false }),
      (state, event) => {
        if (Bus.isSynced(event)) return state
        if (event.type === SessionEvent.InboxEnqueued.type) {
          const data = Schema.decodeUnknownOption(SessionEvent.InboxEnqueued.data)(event.data)
          return Option.isSome(data) && data.value.inboxID === input.inboxID ? { ...state, admitted: true } : state
        }
        // Earlier Session failures do not revoke a newly admitted notification.
        if (!state.admitted) return state
        if (event.type === SessionEvent.InboxCancelled.type) {
          const data = Schema.decodeUnknownOption(SessionEvent.InboxCancelled.data)(event.data)
          return Option.isSome(data) && data.value.inboxID === input.inboxID ? { ...state, cancelled: true } : state
        }
        if (event.type === SessionEvent.Execution.Failed.type) return { ...state, blocked: true }
        if (event.type === SessionEvent.Execution.Interrupted.type) {
          const data = Schema.decodeUnknownOption(SessionEvent.Execution.Interrupted.data)(event.data)
          if (Option.isSome(data) && data.value.reason !== "shutdown") return { ...state, blocked: true }
        }
        return state
      },
    ),
  )
  const pending = yield* SessionInbox.find(db, input.inboxID)
  if (lifecycle.cancelled || (lifecycle.admitted && pending === undefined)) return { admit: false, wake: false }
  return {
    admit: pending === undefined,
    wake: !lifecycle.blocked && !(yield* store.get(input.sessionID))?.revert,
  }
})

/** Record actual model-visible result consumption after the original request has started. */
export const observeConsumption = Effect.fn("SessionNotification.observeConsumption")(function* (
  db: Database.Interface["db"],
  tasks: Interface,
  fs: FSUtil.Interface,
  input: {
    readonly sessionID: Session.ID
    readonly assistantMessageID: SessionMessage.ID
    readonly started: number
    readonly messages: ReadonlyArray<Message>
  },
) {
  const operations = (yield* tasks.operations({ sessionID: input.sessionID })).filter(
    (operation) => operation.result?.text !== undefined && operation.result.digest !== undefined,
  )
  if (operations.length === 0) return
  const starts = yield* db
    .select()
    .from(EventTable)
    .where(
      and(
        eq(EventTable.aggregate_id, input.sessionID),
        eq(
          EventTable.type,
          Event.versionedType(SessionEvent.Step.Started.type, SessionEvent.Step.Started.durable.version),
        ),
      ),
    )
    .orderBy(desc(EventTable.seq))
    .all()
    .pipe(Effect.orDie)
  const started = starts.find((row) => {
    const event = Schema.decodeUnknownOption(SessionEvent.Step.Started.data)(row.data)
    return (
      Option.isSome(event) &&
      event.value.assistantMessageID === input.assistantMessageID &&
      event.value.started === input.started
    )
  })
  if (!started) return
  const rows = yield* db
    .select()
    .from(EventTable)
    .where(
      and(
        eq(EventTable.aggregate_id, input.sessionID),
        lt(EventTable.seq, started.seq),
        inArray(EventTable.type, [
          Event.versionedType(SessionEvent.Tool.Success.type, SessionEvent.Tool.Success.durable.version),
          Event.versionedType(SessionEvent.Tool.Called.type, SessionEvent.Tool.Called.durable.version),
          Event.versionedType(SessionEvent.Tool.Input.Started.type, SessionEvent.Tool.Input.Started.durable.version),
        ]),
      ),
    )
    .all()
    .pipe(Effect.orDie)
  const successes = rows.flatMap((row) =>
    row.type === Event.versionedType(SessionEvent.Tool.Success.type, SessionEvent.Tool.Success.durable.version)
      ? [Schema.decodeUnknownSync(SessionEvent.Tool.Success.data)(row.data)]
      : [],
  )
  const calls = rows.flatMap((row) =>
    row.type === Event.versionedType(SessionEvent.Tool.Called.type, SessionEvent.Tool.Called.durable.version)
      ? [Schema.decodeUnknownSync(SessionEvent.Tool.Called.data)(row.data)]
      : [],
  )
  const names = rows.flatMap((row) =>
    row.type ===
    Event.versionedType(SessionEvent.Tool.Input.Started.type, SessionEvent.Tool.Input.Started.durable.version)
      ? [Schema.decodeUnknownSync(SessionEvent.Tool.Input.Started.data)(row.data)]
      : [],
  )
  const { OperationOutput } = yield* Effect.promise(() => import("../tool/plugin/task.js"))
  const decodeOutput = Schema.decodeUnknownOption(Schema.fromJsonString(OperationOutput))
  const complete = (text: string, operation: SessionTask.OperationInfo) => {
    const output = decodeOutput(text)
    return (
      Option.isSome(output) &&
      output.value.operationRef.sourceSessionID === operation.sourceSessionID &&
      output.value.operationRef.operationID === operation.operationID &&
      output.value.operation.inputID === operation.inputID &&
      output.value.operation.result?.digest === operation.result?.digest &&
      output.value.output === operation.result?.text
    )
  }
  yield* Effect.forEach(
    operations,
    (operation) =>
      Effect.gen(function* () {
        const resultDigest = operation.result?.digest
        if (
          resultDigest === undefined ||
          operation.consumers?.some(
            (consumer) =>
              consumer.eventID === started.id &&
              consumer.consumerSessionID === input.sessionID &&
              consumer.assistantMessageID === input.assistantMessageID &&
              consumer.resultDigest === resultDigest,
          )
        )
          return
        const noticeID = TaskOperation.notificationID({
          sessionID: operation.sourceSessionID,
          operationID: operation.operationID,
        })
        const notice = input.messages.find(
          (message) =>
            message.role === "user" &&
            message.id === noticeID &&
            message.content.some(
              (part) =>
                part.type === "text" &&
                part.text ===
                  `<task operation="${operation.operationID}" state="${operation.phase}">\n${operation.result?.text}\n</task>`,
            ),
        )
        const delivered = notice
          ? yield* db
              .select()
              .from(SessionMessageTable)
              .where(
                and(
                  eq(SessionMessageTable.id, noticeID),
                  eq(SessionMessageTable.session_id, input.sessionID),
                  lt(SessionMessageTable.seq, started.seq),
                ),
              )
              .get()
              .pipe(Effect.orDie)
          : undefined
        const saved = delivered ? yield* SessionHistory.decodeMessageRow(delivered).pipe(Effect.orDie) : undefined
        const notified =
          saved?.type === "synthetic" &&
          notice?.content.some((part) => part.type === "text" && part.text === saved.text)
        const source = operation.source
        const producer =
          source.type === "model_tool"
            ? successes.find((event) => {
                const ref = Schema.decodeUnknownOption(SessionTask.OperationReadonlyRef)(event.metadata?.operationRef)
                return (
                  !event.executed &&
                  event.assistantMessageID === source.messageID &&
                  event.id === source.id &&
                  Option.isSome(ref) &&
                  ref.value.sourceSessionID === operation.sourceSessionID &&
                  ref.value.operationID === operation.operationID
                )
              })
            : undefined
        const foreground =
          producer &&
          producer.metadata?.truncated !== true &&
          containsToolResult(input.messages, producer) &&
          complete(
            producer.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n"),
            operation,
          )
        const outputPath =
          producer?.metadata?.truncated === true && typeof producer.metadata.outputPath === "string"
            ? producer.metadata.outputPath
            : undefined
        const read =
          !notified && !foreground && outputPath !== undefined
            ? yield* Effect.gen(function* () {
                const { ReadTool } = yield* Effect.promise(() => import("../tool/plugin/read.js"))
                const readings = successes.flatMap((event) => {
                  if (
                    event.executed ||
                    !containsToolResult(input.messages, event) ||
                    !names.some(
                      (name) =>
                        name.name === "read" &&
                        name.assistantMessageID === event.assistantMessageID &&
                        name.id === event.id,
                    )
                  )
                    return []
                  const call = calls.find(
                    (call) => call.assistantMessageID === event.assistantMessageID && call.id === event.id,
                  )
                  const readInput = Schema.decodeUnknownOption(ReadTool.Input)(call?.input)
                  return Option.isSome(readInput) && path.normalize(readInput.value.path) === path.normalize(outputPath)
                    ? [{ event, input: readInput.value }]
                    : []
                })
                if (readings.length === 0) return false
                const text = yield* fs.readFileStringSafe(outputPath).pipe(Effect.orElseSucceed(() => undefined))
                if (text === undefined || !complete(text, operation)) return false
                const lines = (text.endsWith("\n") ? text.slice(0, -1) : text)
                  .split("\n")
                  .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
                const covered = new Set(
                  readings.flatMap((reading) =>
                    reading.event.content.flatMap((part) => {
                      if (part.type !== "text") return []
                      const content = part.text.split("\n")
                      if (!content[0]?.startsWith(`Read file ${reading.input.path}, lines `)) return []
                      return content.slice(1).flatMap((line) => {
                        const numbered = /^([1-9]\d*): (.*)$/.exec(line)
                        return numbered && lines[Number(numbered[1]) - 1] === numbered[2] ? [Number(numbered[1])] : []
                      })
                    }),
                  ),
                )
                return covered.size === lines.length
              })
            : false
        if (!notified && !foreground && !read) return
        yield* tasks
          .advanceOperation({
            sessionID: operation.sourceSessionID,
            operationID: operation.operationID,
            change: new SessionTask.OperationChange({
              consumers: [
                new SessionTask.OperationConsumer({
                  consumerSessionID: input.sessionID,
                  assistantMessageID: input.assistantMessageID,
                  eventID: started.id,
                  resultDigest,
                }),
              ],
            }),
          })
          .pipe(
            Effect.catchTag("SessionTask.OperationConflictError", (error) =>
              error.reason === "operation_missing" ? Effect.void : Effect.fail(error),
            ),
          )
      }),
    { discard: true },
  )
})

function containsToolResult(messages: ReadonlyArray<Message>, producer: typeof SessionEvent.Tool.Success.Type.data) {
  return messages.some(
    (message) =>
      message.role === "tool" &&
      message.content.some(
        (part) =>
          part.type === "tool-result" &&
          part.id === producer.id &&
          ((part.result.type === "text" &&
            producer.content.length === 1 &&
            producer.content[0]?.type === "text" &&
            producer.content[0].text === part.result.value) ||
            (part.result.type === "content" &&
              CompositionDigest.computeDigest(part.result.value) ===
                CompositionDigest.computeDigest(producer.content))),
      ),
  )
}

export * as SessionNotification from "./notification.js"
