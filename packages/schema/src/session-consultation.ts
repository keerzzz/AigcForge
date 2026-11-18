import { Schema } from "effect"
import { Agent } from "./agent.js"
import { Event } from "./event.js"
import { Model } from "./model.js"
import { FileAttachment } from "./prompt.js"
import { PromptInput } from "./prompt-input.js"
import { optional } from "./schema.js"
import { Session } from "./session.js"
import { SessionFork } from "./session-fork.js"
import { SessionID } from "./session-id.js"
import { SessionInbox } from "./session-inbox.js"
import { SessionMessage } from "./session-message.js"

export interface Prompt extends Schema.Schema.Type<typeof Prompt> {}
export const Prompt = Schema.Struct({
  id: SessionMessage.ID,
  ...PromptInput.Prompt.fields,
  metadata: SessionInbox.UserPayload.fields.metadata,
  delivery: SessionInbox.Delivery.pipe(optional),
}).annotate({ identifier: "SessionConsultation.Prompt" })

export interface Input extends Schema.Schema.Type<typeof Input> {}
export const Input = Schema.Struct({
  id: SessionID,
  boundary: SessionFork.Boundary,
  agent: Agent.ID,
  model: Model.Selection.pipe(optional),
  title: Schema.String.pipe(optional),
  prompt: Prompt,
  resume: Schema.Boolean.pipe(optional).annotate({
    description: "Schedule execution while the first input is pending. Defaults to true.",
  }),
}).annotate({ identifier: "SessionConsultation.Input" })

export interface Omission extends Schema.Schema.Type<typeof Omission> {}
export const Omission = Schema.Struct({
  messageID: SessionMessage.ID,
  type: Schema.String.annotate({ description: "Arbitrary kind of source content omitted by the renderer." }),
  reason: Schema.String.annotate({ description: "Arbitrary explanation of why this source content was omitted." }),
}).annotate({ identifier: "SessionConsultation.Omission" })

export interface Reference extends Schema.Schema.Type<typeof Reference> {}
export const Reference = Schema.Struct({
  sourceSessionID: SessionID,
  boundary: SessionFork.Boundary,
  boundarySeq: Event.Seq,
  sourceMessageIDs: Schema.Array(SessionMessage.ID),
  digest: Schema.String,
  omissions: Schema.Array(Omission),
  file: FileAttachment,
}).annotate({ identifier: "SessionConsultation.Reference" })

export const Admission = Schema.Union([
  Schema.Struct({ state: Schema.Literal("pending"), input: SessionInbox.User }),
  Schema.Struct({ state: Schema.Literal("promoted"), input: SessionMessage.User }),
  Schema.Struct({ state: Schema.Literal("cancelled"), id: SessionMessage.ID }),
])
  .pipe(Schema.toTaggedUnion("state"))
  .annotate({ identifier: "SessionConsultation.Admission" })
export type Admission = typeof Admission.Type

/** Read the frozen reference without preparing or admitting another input. */
export interface Read extends Schema.Schema.Type<typeof Read> {}
export const Read = Schema.Struct({
  reference: Reference,
  admission: Schema.Union([Schema.Struct({ state: Schema.Literal("reserved"), id: SessionMessage.ID }), Admission]),
}).annotate({ identifier: "SessionConsultation.Read" })

export interface Data extends Schema.Schema.Type<typeof Data> {}
export const Data = Schema.Struct({
  // Created events persist Reference while Session.Info also depends on those events.
  session: Schema.suspend(() => Session.Info),
  reference: Reference,
  admission: Admission,
}).annotate({ identifier: "SessionConsultation.Data" })

export * as SessionConsultation from "./session-consultation.js"
