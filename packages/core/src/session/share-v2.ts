export * as SessionShareV2 from "./share-v2.js"

import { Context, DateTime, Effect, Layer, Option, Schema, Stream } from "effect"
import { SessionCommunication } from "@aigcfroge/schema/session-communication"
import { Hash } from "@aigcfroge/util/hash"
import { CompositionDigest } from "../composition/digest.js"
import { Session } from "../session.js"
import type { SessionSchema } from "./schema.js"
import { SessionMessage } from "./message.js"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { SessionExecution } from "./execution.js"
import { SessionInbox } from "./inbox.js"
import { SessionNotification } from "./notification.js"
import { SessionStore } from "./store.js"
import { CommunicationRecord } from "./communication-record.js"
import { MetaAgentService } from "../meta-agent/service.js"
import { KV } from "../kv.js"
import { SessionEvent } from "./event.js"
import { ControllerConflictError } from "./error.js"
import { serializedSelection } from "./session.js"
import { Node } from "@aigcfroge/util/effect/app-node"
import type { LayerNode } from "@aigcfroge/util/effect/layer-node"

/**
 * Share scope: what content from the source session to share.
 *
 * - `text`: caller-supplied feedback, question, or reply
 * - `reference`: only the source session ID
 * - `output`: the last assistant message text (the "result")
 * - `full`: the entire projected conversation history
 * - `result`: an exact saved Task result selected at the share Tool boundary
 */
export const Scope = Schema.Literals(["text", "reference", "output", "full", "result"])
export type ShareScope = typeof Scope.Type

export const ResultSource = SessionCommunication.ResultSource
export type ResultSource = SessionCommunication.ResultSource

export class ResultContent extends Schema.Class<ResultContent>("SessionShareV2.ResultContent")({
  result_source: ResultSource,
  basis: Schema.Literals(["summary", "summary_partial", "original"]),
  text: Schema.String,
}) {}

export class ResultOutput extends Schema.Class<ResultOutput>("SessionShareV2.ResultOutput")({
  actorSessionID: Schema.optionalKey(Session.ID),
  sourceSessionID: Session.ID,
  targetSessionID: Session.ID,
  scope: Schema.Literal("result"),
  result_source: ResultSource,
  basis: ResultContent.fields.basis,
  inboxID: SessionMessage.ID,
  admission: Schema.Literals(["admitted", "retained", "suppressed", "unavailable"]),
  wake: Schema.Literals(["requested", "not_requested", "suppressed"]),
  reason: Schema.optionalKey(Schema.String),
  text: Schema.String,
  communication: Schema.optionalKey(SessionCommunication.Record),
}) {}

type ShareBase = {
  readonly actorSessionID?: SessionSchema.ID
  readonly sourceSessionID: SessionSchema.ID
  readonly targetSessionID: SessionSchema.ID
  readonly trigger?: boolean
  readonly actor?: SessionCommunication.ToolActor
  readonly communicationID?: SessionCommunication.ID
  readonly delivery?: "queue" | "steer"
  readonly replyTo?: SessionCommunication.ID
}

export type ShareInput = ShareBase &
  (
    | { readonly scope: Exclude<ShareScope, "text" | "result"> }
    | { readonly scope: "text"; readonly text: string }
    | { readonly scope: "result"; readonly result: ResultContent; readonly inboxID: SessionMessage.ID }
  )

export interface Interface {
  readonly share: (
    input: ShareInput,
  ) => Effect.Effect<
    void | ResultOutput | SessionCommunication.Receipt,
    Session.NotFoundError | Session.MessageDecodeError | Session.SyntheticConflictError | ControllerConflictError | SessionCommunication.Error
  >
  readonly send: (input: SessionCommunication.Send & { readonly sessionID: SessionSchema.ID }) => Effect.Effect<
    SessionCommunication.Receipt, Session.NotFoundError | Session.MessageDecodeError | ControllerConflictError | SessionCommunication.Error
  >
  readonly reply: (input: SessionCommunication.Reply & { readonly sessionID: SessionSchema.ID; readonly communicationID: SessionCommunication.ID }) => Effect.Effect<
    SessionCommunication.Receipt, Session.NotFoundError | Session.MessageDecodeError | ControllerConflictError | SessionCommunication.Error
  >
  readonly read: (input: { readonly sessionID: SessionSchema.ID; readonly communicationID: SessionCommunication.ID }) => Effect.Effect<
    SessionCommunication.Message | undefined, Session.NotFoundError | Session.MessageDecodeError | SessionCommunication.Error
  >
  readonly list: (input: SessionCommunication.ListInput & { readonly sessionID: SessionSchema.ID }) => Effect.Effect<
    SessionCommunication.Page, Session.NotFoundError | Session.MessageDecodeError | SessionCommunication.Error
  >
  readonly capability: (sessionID: SessionSchema.ID) => Effect.Effect<SessionCommunication.Capability, Session.NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/SessionShare") {}

/** Exported for share-summary.ts to use without duplicating. */
export function formatMessages(messages: ReadonlyArray<SessionMessage.Info>): string {
  return messages
    .flatMap((message) => {
      if (message.type === "user") return [`[User] ${message.text}`]
      if (message.type === "assistant")
        return message.content.flatMap((part) => (part.type === "text" ? [`[Assistant] ${part.text}`] : []))
      if (message.type === "system") return [`[System] ${message.text}`]
      if (message.type === "synthetic") return [`[Synthetic] ${message.text}`]
      if (message.type === "shell") return [`[Shell] ${message.command}`]
      return []
    })
    .join("\n\n")
}

function lastAssistantText(messages: ReadonlyArray<SessionMessage.Info>): string | undefined {
  const message = messages.findLast(
    (message) => message.type === "assistant" && message.content.some((part) => part.type === "text"),
  )
  if (message?.type !== "assistant") return undefined
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const database = yield* Database.Service
    const bus = yield* Bus.Service
    const store = yield* SessionStore.Service
    const execution = yield* SessionExecution.Service
    const inbox = yield* SessionInbox.Service
    const metas = yield* MetaAgentService.Service
    const kv = yield* KV.Service

    const available = (sessionID: SessionSchema.ID) => bus.retainsEvents ? Effect.void : new SessionCommunication.Error({
      sessionID, reason: "unavailable", message: "Durable communication requires retained Session events",
    })
    const message = Effect.fn("SessionShareV2.communicationMessage")(function* (saved: CommunicationRecord.Stored) {
      const visible = yield* store.message(saved.record.body.inputID)
      const pending = yield* SessionInbox.find(database.db, saved.record.body.inputID)
      if (visible && visible.sessionID !== saved.record.targetSessionID || pending && pending.sessionID !== saved.record.targetSessionID)
        return yield* new SessionCommunication.Error({ sessionID: saved.record.actor.sessionID, communicationID: saved.record.id,
          reason: "invalid_carrier", message: "The saved communication carrier belongs to another Session" })
      const cancelled = !visible && !pending ? yield* bus.log({ aggregateID: saved.record.targetSessionID }).pipe(
        Stream.runFold(() => false, (cancelled, event) => {
          if (cancelled || event.type !== SessionEvent.InboxCancelled.type) return cancelled
          const data = Schema.decodeUnknownOption(SessionEvent.InboxCancelled.data)(event.data)
          return Option.isSome(data) && data.value.inboxID === saved.record.body.inputID
        }),
      ) : false
      return new SessionCommunication.Message({ ...saved.record, text: saved.text,
        state: visible ? "visible" : pending ? "pending" : cancelled ? "cancelled" : "removed" })
    })
    const receipt = Effect.fn("SessionShareV2.communicationReceipt")(function* (saved: CommunicationRecord.Stored, admitted = false, trigger = saved.record.trigger) {
      const current = yield* message(saved)
      const notification = yield* SessionNotification.inspect(database.db, bus, store,
        { sessionID: saved.record.targetSessionID, inboxID: saved.record.body.inputID })
      const wake = trigger && notification.wake
      if (wake) yield* execution.wake(saved.record.targetSessionID)
      return new SessionCommunication.Receipt({ ...current,
        admission: admitted ? "admitted" : current.state === "pending" || current.state === "visible" ? "retained" : "suppressed",
        wake: wake ? "requested" : trigger ? "suppressed" : "not_requested" })
    })
    const deliver = Effect.fn("SessionShareV2.deliverCommunication")(function* (input: {
      readonly id: SessionCommunication.ID
      readonly actor: SessionCommunication.Actor
      readonly targetSessionID: SessionSchema.ID
      readonly contentSource: SessionCommunication.ContentSource
      readonly request: SessionCommunication.Content | { readonly scope: ShareScope; readonly sourceSessionID: SessionSchema.ID; readonly result_source?: ResultSource }
      readonly text: Effect.Effect<string, Session.NotFoundError | Session.MessageDecodeError>
      readonly inputID?: SessionMessage.ID
      readonly replyTo?: SessionCommunication.ID
      readonly delivery: "queue" | "steer"
      readonly trigger: boolean
    }) {
      yield* available(input.actor.sessionID)
      const inputID = input.inputID ?? SessionMessage.ID.make(`msg_communication_${Hash.sha256(input.id)}`)
      const requestDigest = SessionCommunication.Digest.make(CompositionDigest.computeDigest({
        actor: Schema.encodeSync(SessionCommunication.Actor)(input.actor), targetSessionID: input.targetSessionID,
        contentSource: { sessionID: input.contentSource.sessionID, scope: input.contentSource.scope, result_source: input.contentSource.result_source },
        request: input.request, replyTo: input.replyTo, inputID, delivery: input.delivery,
      }))
      const previous = yield* CommunicationRecord.get(database.db, input.id)
      if (previous) {
        if (previous.record.requestDigest !== requestDigest)
          return yield* new SessionCommunication.Error({ sessionID: input.actor.sessionID, communicationID: input.id,
            reason: "conflicting_retry", message: "The communication ID belongs to a different saved request" })
        return yield* receipt(previous, false, input.trigger)
      }
      yield* sessions.get(input.actor.sessionID)
      yield* sessions.get(input.targetSessionID)
      if (input.replyTo) {
        const parent = yield* CommunicationRecord.get(database.db, input.replyTo)
        if (!parent || parent.record.targetSessionID !== input.actor.sessionID || parent.record.actor.sessionID !== input.targetSessionID || input.replyTo === input.id)
          return yield* new SessionCommunication.Error({ sessionID: input.actor.sessionID, communicationID: input.id,
            reason: "invalid_reply", message: "Only the receiving Session may reply to the exact saved sender" })
      }
      const selection = input.actor.type === "user" ? yield* metas.assertCoordination(input.actor.sessionID) : undefined
      const admit = Effect.gen(function* () {
        const retained = yield* CommunicationRecord.get(database.db, input.id)
        if (retained) {
          if (retained.record.requestDigest !== requestDigest)
            return yield* new SessionCommunication.Error({ sessionID: input.actor.sessionID, communicationID: input.id,
              reason: "conflicting_retry", message: "The communication ID belongs to a different saved request" })
          return yield* receipt(retained, false, input.trigger)
        }
        const text = yield* input.text
        const record = new SessionCommunication.Record({ id: input.id, actor: input.actor, targetSessionID: input.targetSessionID,
          contentSource: input.contentSource, replyTo: input.replyTo, requestDigest,
          body: new SessionCommunication.BodyRef({ sessionID: input.targetSessionID, inputID, digest: SessionCommunication.Digest.make(Hash.sha256(text)) }),
          delivery: input.delivery, trigger: input.trigger, createdAt: (yield* DateTime.nowAsDate).getTime() })
        yield* inbox.admit({ id: inputID, sessionID: input.targetSessionID, communication: record,
          beforeCommit: selection ? metas.assertCoordination(input.actor.sessionID, { selection: selection.selection }).pipe(Effect.asVoid, Effect.orDie) : undefined,
          item: { type: "synthetic", delivery: input.delivery, payload: SessionInbox.SyntheticPayload.make({ text,
            metadata: { source: "share", communication: { id: input.id }, actorSessionID: input.actor.sessionID,
              contentSourceSessionID: input.contentSource.sessionID, sourceSessionID: input.contentSource.sessionID, scope: input.contentSource.scope,
              ...(input.contentSource.result_source ? { result_source: Schema.encodeSync(SessionCommunication.ResultSource)(input.contentSource.result_source) } : {}),
              ...(input.contentSource.basis ? { basis: input.contentSource.basis } : {}),
            } }) },
        }).pipe(
          Effect.catchTag("SessionInbox.LifecycleConflict", () => new SessionCommunication.Error({ sessionID: input.actor.sessionID,
            communicationID: input.id, reason: "invalid_carrier", message: "The communication input belongs to another retained admission" })),
          Effect.catchDefect((defect) => defect instanceof SessionCommunication.Error || defect instanceof ControllerConflictError
            ? Effect.fail(defect) : Effect.die(defect)),
        )
        const saved = yield* CommunicationRecord.get(database.db, input.id)
        if (!saved) return yield* new SessionCommunication.Error({ sessionID: input.actor.sessionID, communicationID: input.id,
          reason: "invalid_carrier", message: "The original Inbox transaction did not save the communication" })
        return yield* receipt(saved, true, input.trigger)
      }).pipe(Effect.catchTag("SessionCommunication.Error", (error) => Effect.gen(function* () {
        const saved = yield* CommunicationRecord.get(database.db, input.id)
        if (error.reason === "conflicting_retry" && saved?.record.requestDigest === requestDigest) return yield* receipt(saved, false, input.trigger)
        return yield* error
      })))
      return yield* selection ? serializedSelection(input.actor.sessionID, admit) : admit
    })
    const contentText = (content: SessionCommunication.Content) => Effect.gen(function* () {
      if (content.type === "text") return content.text
      yield* sessions.get(content.sessionID)
      if (content.scope === "reference") return `[Shared reference] Source session: ${content.sessionID}.`
      if (content.scope === "full") return `[Shared history from session ${content.sessionID}]\n\n${formatMessages(yield* sessions.context(content.sessionID))}`
      const text = lastAssistantText(yield* sessions.messages({ sessionID: content.sessionID, order: "asc" }))
      return text ? `[Shared output from session ${content.sessionID}]\n\n${text}` : `[Shared output] Source session ${content.sessionID} has no assistant output yet.`
    })
    const send = Effect.fn("SessionShareV2.send")(function* (input: SessionCommunication.Send & { readonly sessionID: SessionSchema.ID }) {
      return yield* deliver({ id: input.id, actor: new SessionCommunication.UserActor({ type: "user", sessionID: input.sessionID }),
        contentSource: new SessionCommunication.ContentSource({ sessionID: input.content.type === "session" ? input.content.sessionID : input.sessionID,
          scope: input.content.type === "session" ? input.content.scope : "text" }),
        targetSessionID: input.targetSessionID, request: input.content, text: contentText(input.content),
        delivery: input.delivery ?? "queue", trigger: input.trigger ?? true })
    })
    const reply = Effect.fn("SessionShareV2.reply")(function* (input: SessionCommunication.Reply & { readonly sessionID: SessionSchema.ID; readonly communicationID: SessionCommunication.ID }) {
      yield* available(input.sessionID)
      const parent = yield* CommunicationRecord.get(database.db, input.communicationID)
      if (!parent || parent.record.targetSessionID !== input.sessionID)
        return yield* new SessionCommunication.Error({ sessionID: input.sessionID, communicationID: input.communicationID,
          reason: "invalid_reply", message: "Only the receiving Session may reply to this communication" })
      return yield* deliver({ id: input.id, actor: new SessionCommunication.UserActor({ type: "user", sessionID: input.sessionID }),
        targetSessionID: parent.record.actor.sessionID, replyTo: parent.record.id,
        contentSource: new SessionCommunication.ContentSource({ sessionID: input.content.type === "session" ? input.content.sessionID : input.sessionID,
          scope: input.content.type === "session" ? input.content.scope : "text" }), request: input.content, text: contentText(input.content),
        delivery: input.delivery ?? "queue", trigger: input.trigger ?? true })
    })
    const read = Effect.fn("SessionShareV2.readCommunication")(function* (input: { readonly sessionID: SessionSchema.ID; readonly communicationID: SessionCommunication.ID }) {
      yield* available(input.sessionID)
      yield* sessions.get(input.sessionID)
      const saved = yield* CommunicationRecord.get(database.db, input.communicationID)
      if (!saved) return undefined
      if (saved.record.actor.sessionID !== input.sessionID && saved.record.targetSessionID !== input.sessionID)
        return yield* new SessionCommunication.Error({ sessionID: input.sessionID, communicationID: input.communicationID,
          reason: "not_participant", message: "The Session is not a participant in this communication" })
      return yield* message(saved)
    })
    const capability = Effect.fn("SessionShareV2.communicationCapability")(function* (sessionID: SessionSchema.ID) {
      const coordination = yield* metas.coordination(sessionID)
      return new SessionCommunication.Capability({ read: bus.retainsEvents, list: bus.retainsEvents,
        send: bus.retainsEvents && coordination.available, reply: bus.retainsEvents && coordination.available,
        reasons: [...(!bus.retainsEvents ? ["retained-events-required"] : []), ...coordination.reasons.map((reason) => reason.code)] })
    })
    const list = Effect.fn("SessionShareV2.listCommunications")(function* (input: SessionCommunication.ListInput & { readonly sessionID: SessionSchema.ID }) {
      yield* sessions.get(input.sessionID)
      const capabilities = yield* capability(input.sessionID)
      if (!capabilities.list) return new SessionCommunication.Page({ items: [], capability: capabilities })
      const page = yield* CommunicationRecord.page(kv, input.sessionID, input)
      const messages = yield* Effect.forEach(page.entries, (entry) => read({ sessionID: input.sessionID,
        communicationID: Schema.decodeUnknownSync(SessionCommunication.ID)(entry.value) }))
      return new SessionCommunication.Page({ items: messages.filter((message): message is SessionCommunication.Message => message !== undefined),
        next: page.next, capability: capabilities })
    })

    const share = Effect.fn("SessionShareV2.share")(function* (input: ShareInput) {
      if (input.actor && input.communicationID && (input.scope !== "result" || bus.retainsEvents)) {
        const delivered = yield* deliver({ id: input.communicationID, actor: input.actor, targetSessionID: input.targetSessionID,
          contentSource: new SessionCommunication.ContentSource({ sessionID: input.sourceSessionID, scope: input.scope,
            result_source: input.scope === "result" ? input.result.result_source : undefined,
            basis: input.scope === "result" ? input.result.basis : undefined }),
          request: input.scope === "text" ? new SessionCommunication.TextContent({ type: "text", text: input.text })
            : { sourceSessionID: input.sourceSessionID, scope: input.scope, result_source: input.scope === "result" ? input.result.result_source : undefined },
          replyTo: input.replyTo,
          inputID: input.scope === "result" ? input.inboxID : undefined, delivery: input.delivery ?? "queue", trigger: input.trigger ?? true,
          text: Effect.gen(function* () {
            yield* sessions.get(input.sourceSessionID)
            if (input.scope === "text") return input.text
            const body = input.scope === "result" ? input.result.text : yield* contentText(new SessionCommunication.SessionContent({
              type: "session", sessionID: input.sourceSessionID, scope: input.scope }))
            return `[Shared by ${input.actor?.agent === "meta" ? "Meta session" : `agent ${input.actor?.agent} in session`} ${input.actor?.sessionID}, content from session ${input.sourceSessionID}]\n${body}`
          }),
        })
        if (input.scope !== "result") return delivered
        return new ResultOutput({ actorSessionID: delivered.actor.sessionID, sourceSessionID: delivered.contentSource.sessionID,
          targetSessionID: delivered.targetSessionID, scope: "result", result_source: delivered.contentSource.result_source ?? input.result.result_source,
          basis: delivered.contentSource.basis ?? input.result.basis, inboxID: delivered.body.inputID, admission: delivered.admission,
          wake: delivered.wake, text: delivered.text, communication: new SessionCommunication.Record(delivered) })
      }
      yield* sessions.get(input.sourceSessionID)
      yield* sessions.get(input.targetSessionID)
      const attribution = input.actorSessionID
        ? { actorSessionID: input.actorSessionID, contentSourceSessionID: input.sourceSessionID }
        : {}
      const prefix = input.actorSessionID
        ? `[Shared by Meta session ${input.actorSessionID}, content from session ${input.sourceSessionID}]\n`
        : ""

      if (input.scope === "result") {
        // Like persistent Delegations, exact retry suppression needs retained lifecycle events.
        if (!bus.retainsEvents)
          return new ResultOutput({
            actorSessionID: input.actorSessionID,
            sourceSessionID: input.sourceSessionID,
            targetSessionID: input.targetSessionID,
            scope: "result",
            result_source: input.result.result_source,
            basis: input.result.basis,
            inboxID: input.inboxID,
            admission: "unavailable",
            wake: input.trigger === true ? "suppressed" : "not_requested",
            reason: "Exact result sharing requires retained Bus events, as persistent Delegations do.",
            text: prefix + input.result.text,
          })
        const notification = { sessionID: input.targetSessionID, inboxID: input.inboxID }
        const decision = yield* SessionNotification.inspect(database.db, bus, store, notification)
        if (decision.admit)
          yield* sessions.synthetic({
            id: input.inboxID,
            sessionID: input.targetSessionID,
            text: prefix + input.result.text,
            metadata: {
              ...attribution,
              source: "share",
              sourceSessionID: input.sourceSessionID,
              scope: input.scope,
              result_source: input.result.result_source,
              basis: input.result.basis,
            },
            resume: false,
          })
        const admitted = decision.admit
          ? yield* SessionNotification.inspect(database.db, bus, store, notification)
          : decision
        const pending = yield* SessionInbox.find(database.db, input.inboxID)
        const visible = yield* sessions.message({ sessionID: input.targetSessionID, messageID: input.inboxID })
        const text =
          pending?.type === "synthetic"
            ? pending.payload.text
            : visible?.type === "synthetic"
              ? visible.text
              : prefix + input.result.text
        const wake = input.trigger === true && admitted.wake
        if (wake) yield* execution.wake(input.targetSessionID)
        return new ResultOutput({
          actorSessionID: input.actorSessionID,
          sourceSessionID: input.sourceSessionID,
          targetSessionID: input.targetSessionID,
          scope: "result",
          result_source: input.result.result_source,
          basis: input.result.basis,
          inboxID: input.inboxID,
          admission: decision.admit ? "admitted" : pending || visible ? "retained" : "suppressed",
          wake: wake ? "requested" : input.trigger === true ? "suppressed" : "not_requested",
          text,
        })
      }

      const text = yield* Effect.gen(function* () {
        if (input.scope === "text") return input.text
        if (input.scope === "reference") return `[Shared reference] Source session: ${input.sourceSessionID}.`
        if (input.scope === "full")
          return `[Shared history from session ${input.sourceSessionID}]\n\n${formatMessages(yield* sessions.context(input.sourceSessionID))}`
        const output = lastAssistantText(yield* sessions.messages({ sessionID: input.sourceSessionID, order: "asc" }))
        return output
          ? `[Shared output from session ${input.sourceSessionID}]\n\n${output}`
          : `[Shared output] Source session ${input.sourceSessionID} has no assistant output yet.`
      })

      // Session owns durable admission and wakes only after the inbox commit.
      yield* sessions.synthetic({
        sessionID: input.targetSessionID,
        text: prefix + text,
        metadata: { source: "share", sourceSessionID: input.sourceSessionID, scope: input.scope, ...attribution },
        resume: input.trigger === true,
      })
    })

    return Service.of({ share, send, reply, read, list, capability })
  }),
)

export const node: LayerNode.Provider<Service, never, typeof Node.tags.values.global> = Node.makeGlobalNode({
  service: Service,
  layer,
  deps: [Session.node, Database.node, Bus.node, SessionStore.node, SessionExecution.node, SessionInbox.node, MetaAgentService.node, KV.node],
})
