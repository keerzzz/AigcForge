export * as ProposeMemoryTool from "./propose-memory"

import { ToolFailure } from "@aigcfroge/llm"
import { Effect, Layer, Schema } from "effect"
import { PersonalMemory as PersonalMemorySchema } from "@aigcfroge/schema/personal-memory"
import { PersonalMemory } from "../session/personal-memory"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "memory_propose"

export const description = `Propose a personal memory entry for the user. The entry stays PENDING until the
user confirms it in the Memory Inspector — you can only propose, never write
memory directly. Confirmed entries may be injected into future assistant
conversations.

Call this tool when the user states a stable personal preference or fact worth
remembering across sessions (e.g. "always answer in Chinese", "I work at
Acme"). Do NOT propose one-off facts, conversation details, or anything
sensitive (passwords, tokens, secrets, private identifiers) — sensitive
information is never stored in long-term memory.

Input:
- content: the memory to remember (a stable, reusable fact)
- source: "explicit" when the user said it directly, "derived" when you
  inferred it (derived entries are reviewed more carefully by the user)
- trustLevel: how confident you are (high/medium/low)
- sensitivityLevel: how sensitive the content is (high/medium/low); high is rejected`

export const Input = Schema.Struct({
  content: Schema.String,
  source: PersonalMemorySchema.Source,
  trustLevel: PersonalMemorySchema.TrustLevel,
  sensitivityLevel: PersonalMemorySchema.SensitivityLevel,
})

export const Output = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  content: Schema.String,
  source: Schema.String,
  sensitivityLevel: Schema.String,
})

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const memories = yield* PersonalMemory.Service

    const tool = Tool.make({
      description,
      input: Input,
      output: Output,
      execute: (input, context) =>
        Effect.gen(function* () {
          if (input.sensitivityLevel === "high") {
            return yield* Effect.fail(
              new ToolFailure({
                message:
                  "Sensitive information is never stored in long-term memory (PRD §9). Ask the user to rephrase or drop it.",
              }),
            )
          }
          const created = yield* memories.propose({
            content: input.content,
            source: input.source,
            trustLevel: input.trustLevel,
            sensitivityLevel: input.sensitivityLevel,
            sourceSessionID: context.sessionID,
            sourceMessageID: context.assistantMessageID,
            createdBy: "assistant",
          })
          return {
            id: created.id,
            status: created.status,
            content: created.content,
            source: created.source,
            sensitivityLevel: created.sensitivityLevel,
          }
        }).pipe(
          Effect.catch((err) =>
            Effect.fail(new ToolFailure({ message: `Memory proposal failed: ${(err as Error).message}` })),
          ),
        ),
      toModelOutput: ({ output }) => [
        {
          type: "text" as const,
          text:
            output.status === "pending"
              ? `Memory proposed (pending review): "${output.content}". The user can confirm or reject it in the Memory Inspector.`
              : `Memory recorded: "${output.content}".`,
        },
      ],
    })

    yield* tools.register({ [name]: tool }).pipe(Effect.catch((err) => Effect.die(err)))
  }),
)
