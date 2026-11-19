export * as Question from "./question.js"

import { Schema } from "effect"
import { ascending } from "./identifier.js"
import { optional, statics } from "./schema.js"
import { Session } from "./session.js"
import { SessionMessage } from "./session-message.js"

const Option = Schema.Struct({
  label: Schema.String.annotate({ description: "Display text (1-5 words, concise)" }),
  description: Schema.String.annotate({ description: "Explanation of choice" }),
})

const base = {
  question: Schema.String.annotate({ description: "Complete question" }),
  header: Schema.String.annotate({ description: "Very short label (max 30 chars)" }),
  options: Schema.Array(Option).annotate({ description: "Available choices" }),
  multiple: Schema.Boolean.pipe(optional).annotate({ description: "Allow selecting multiple choices" }),
}

export const Prompt = Schema.Struct(base).annotate({ identifier: "Question.Prompt" })
export interface Prompt extends Schema.Schema.Type<typeof Prompt> {}

export const Answer = Schema.Array(Schema.String).annotate({ identifier: "Question.Answer" })
export type Answer = typeof Answer.Type

/**
 * Fork-retained question surface (lifted from the entry package). The legacy
 * loose "que" prefix validator is kept (AGENTS: do not tighten legacy loose ID
 * validators without a migration decision); generated ids emit the canonical
 * "que_" form.
 */
export const ID = Schema.String.check(Schema.isStartingWith("que")).pipe(
  Schema.brand("QuestionID"),
  Schema.annotate({ identifier: "Question.ID" }),
  statics((schema) => ({
    create: () => schema.make("que_" + ascending()),
    ascending: (id?: string) => (id === undefined ? schema.make("que_" + ascending()) : schema.make(id)),
  })),
)
export type ID = typeof ID.Type

export const Info = Schema.Struct({
  ...base,
  custom: Schema.Boolean.pipe(optional).annotate({
    description: "Allow typing a custom answer (default: true)",
  }),
}).annotate({ identifier: "Question.Info" })
export type Info = typeof Info.Type

export const Tool = Schema.Struct({
  messageID: SessionMessage.ID,
  callID: Schema.String,
}).annotate({ identifier: "Question.Tool" })
export type Tool = typeof Tool.Type

export const Request = Schema.Struct({
  id: ID,
  sessionID: Session.ID,
  questions: Schema.Array(Info).annotate({
    description: "Questions to ask",
  }),
  tool: Tool.pipe(optional),
}).annotate({ identifier: "Question.Request" })
export type Request = typeof Request.Type
