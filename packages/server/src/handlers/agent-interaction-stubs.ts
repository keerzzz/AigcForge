import { InvalidRequestError } from "@omnixa/protocol/errors"
import { HttpApiBuilder } from "effect/http-api"
import { Effect } from "effect"
import { Api } from "../api"

/**
 * R1b transitional stubs (agent interaction + delegation): contracts are live
 * and the client is generated; handlers arrive with the R2 port. Fail closed
 * with kind "not_implemented"; deleted as the R2 slices land implementations.
 */
const failClosed = (group: string, name: string) =>
  Effect.fail(
    new InvalidRequestError({
      message: `${group}.${name} is not implemented until the R2 agent-interaction port`,
      kind: "not_implemented",
    }),
  )

export const QuestionHandler = HttpApiBuilder.group(Api, "question", (handlers) =>
  handlers
    .handle("question.list", () => failClosed("question", "list"))
    .handle("question.reply", () => failClosed("question", "reply"))
    .handle("question.reject", () => failClosed("question", "reject")),
)

export const ProjectCopyNameHandler = HttpApiBuilder.group(Api, "projectCopyName", (handlers) =>
  handlers.handle("projectCopyName.generateName", () => failClosed("projectCopyName", "generateName")),
)
