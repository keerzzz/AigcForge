import { Question } from "@aigcfroge/schema/question"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { InvalidRequestError, QuestionNotFoundError } from "../errors.js"
import { Authorization } from "../middleware/authorization.js"
import { InstanceContext, WorkspaceRouting, WorkspaceRoutingQuery } from "../middleware/workspace-routing.js"
import { described } from "./metadata.js"

// Fork-retained instance-scoped surface (see prompt-asset.ts for the conventions).
const root = "/question"

const ReplyPayload = Schema.Struct({
  answers: Schema.Array(Question.Answer).annotate({
    description: "User answers in order of questions (each answer is an array of selected labels)",
  }),
}).annotate({ identifier: "Question.ReplyPayload" })

export const QuestionGroup = HttpApiGroup.make("question")
  .add(
    HttpApiEndpoint.get("question.list", root, {
      query: WorkspaceRoutingQuery,
      success: described(Schema.Array(Question.Request), "List of pending questions"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "question.list",
        summary: "List pending questions",
        description: "Get all pending question requests across all sessions.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("question.reply", `${root}/:requestID/reply`, {
      params: { requestID: Question.ID },
      query: WorkspaceRoutingQuery,
      payload: ReplyPayload,
      success: described(Schema.Boolean, "Question answered successfully"),
      error: [InvalidRequestError, QuestionNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "question.reply",
        summary: "Reply to question request",
        description: "Provide answers to a question request from the AI assistant.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("question.reject", `${root}/:requestID/reject`, {
      params: { requestID: Question.ID },
      query: WorkspaceRoutingQuery,
      success: described(Schema.Boolean, "Question rejected successfully"),
      error: [InvalidRequestError, QuestionNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "question.reject",
        summary: "Reject question request",
        description: "Reject a question request from the AI assistant.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "question",
      description: "Question routes.",
    }),
  )
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(Authorization)
