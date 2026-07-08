export * as SessionShareTool from "./share-tool"

import { Tool } from "./tool"
import { Schema } from "effect"
import { SessionV2 } from "../session"
import { SessionShareV2 } from "../session/share-v2"

const ShareInput = Schema.Struct({
  sourceSessionID: Schema.String.annotate({
    description: "The session ID to share content from",
  }),
  targetSessionID: Schema.String.annotate({
    description: "The session ID to share content into",
  }),
  scope: Schema.Literal("reference", "output", "full").annotate({
    description:
      "What to share: reference (session link), output (last result), full (entire history)",
  }),
})

export const ShareTool = Tool.make({
  description: "Share context from one session into another session. Use this to pass analysis results, conversation history, or references between sessions.",
  input: ShareInput,
  output: Schema.String,
  execute: (input, ctx) =>
    SessionV2.Service.pipe(
      Effect.flatMap((sessions) => sessions.get(ctx.sessionID)),
      Effect.flatMap(() =>
        SessionShareV2.Service.pipe(
          Effect.flatMap((share) =>
            share.share({
              sourceSessionID: input.sourceSessionID as any,
              targetSessionID: input.targetSessionID as any,
              scope: input.scope,
              trigger: true,
            }),
          ),
        ),
      ),
      Effect.flatMap(() =>
        Effect.succeed(`Shared ${input.scope} from session ${input.sourceSessionID} to ${input.targetSessionID}`),
      ),
    ),
  toModelOutput: ({ output }) => [{ type: "text", text: output }],
})
