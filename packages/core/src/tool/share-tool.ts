export * as SessionShareTool from "./share-tool"

import { Tool } from "./tool"
import { Effect, Schema } from "effect"
import { SessionV2 } from "../session"
import { SessionShareV2 } from "../session/share-v2"

const ShareInput = Schema.Struct({
  sourceSessionID: Schema.String.annotate({
    description: "The session ID to share content from",
  }),
  targetSessionID: Schema.String.annotate({
    description: "The session ID to share content into",
  }),
  scope: Schema.Literals(["reference", "output", "full"]).annotate({
    description: "What to share: reference (session link), output (last result), full (entire history)",
  }),
})

export const make = (sessions: SessionV2.Interface, share: SessionShareV2.Interface) =>
  Tool.make({
    description:
      "Share context from one session into another session. Use this to pass analysis results, conversation history, or references between sessions.",
    input: ShareInput,
    output: Schema.String,
    execute: (input, context) =>
      Effect.gen(function* () {
        yield* sessions
          .get(context.sessionID)
          .pipe(Effect.mapError((error) => new Tool.Failure({ message: `Session not found: ${error.sessionID}` })))
        yield* share
          .share({
            sourceSessionID: SessionV2.ID.make(input.sourceSessionID),
            targetSessionID: SessionV2.ID.make(input.targetSessionID),
            scope: input.scope,
            trigger: true,
          })
          .pipe(Effect.mapError((error) => new Tool.Failure({ message: `Session not found: ${error.sessionID}` })))
        return `Shared ${input.scope} from session ${input.sourceSessionID} to ${input.targetSessionID}`
      }),
    toModelOutput: ({ output }) => [{ type: "text", text: output }],
  })
