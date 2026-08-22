export * as SessionInput from "./session-input"

import { Schema } from "effect"
import { Prompt } from "./prompt"
import { DateTimeUtcFromMillis, NonNegativeInt } from "./schema"
import { SessionDelivery } from "./session-delivery"
import { SessionID } from "./session-id"
import { SessionMessageID } from "./session-message-id"

export const Delivery = SessionDelivery.Delivery
export type Delivery = SessionDelivery.Delivery

/** Fields shared by every admitted session input regardless of kind. */
const Base = {
  admittedSeq: NonNegativeInt,
  id: SessionMessageID.ID,
  sessionID: SessionID.ID,
  delivery: Delivery,
  timeCreated: DateTimeUtcFromMillis,
  promotedSeq: NonNegativeInt.pipe(Schema.optional),
}

/** Agent-authored delivery text admitted to the durable inbox. */
export interface AdmittedPrompt extends Schema.Schema.Type<typeof AdmittedPrompt> {}
export const AdmittedPrompt = Schema.Struct({
  kind: Schema.Literal("prompt"),
  ...Base,
  prompt: Prompt,
}).annotate({ identifier: "SessionInput.AdmittedPrompt" })

/** User-run shell command admitted to the durable inbox. */
export interface AdmittedShell extends Schema.Schema.Type<typeof AdmittedShell> {}
export const AdmittedShell = Schema.Struct({
  kind: Schema.Literal("shell"),
  ...Base,
  command: Schema.String,
}).annotate({ identifier: "SessionInput.AdmittedShell" })

/** Slash-command skill invocation admitted to the durable inbox. */
export interface AdmittedSkill extends Schema.Schema.Type<typeof AdmittedSkill> {}
export const AdmittedSkill = Schema.Struct({
  kind: Schema.Literal("skill"),
  ...Base,
  skill: Schema.String,
}).annotate({ identifier: "SessionInput.AdmittedSkill" })

/** Server-authored text admitted for delivery at the next safe provider boundary. */
export interface AdmittedSynthetic extends Schema.Schema.Type<typeof AdmittedSynthetic> {}
export const AdmittedSynthetic = Schema.Struct({
  kind: Schema.Literal("synthetic"),
  ...Base,
  text: Schema.String,
}).annotate({ identifier: "SessionInput.AdmittedSynthetic" })

export type Admitted = AdmittedPrompt | AdmittedShell | AdmittedSkill | AdmittedSynthetic
export const Admitted = Schema.Union([AdmittedPrompt, AdmittedShell, AdmittedSkill, AdmittedSynthetic])
  .pipe(Schema.toTaggedUnion("kind"))
  .annotate({ identifier: "SessionInput.Admitted" })
