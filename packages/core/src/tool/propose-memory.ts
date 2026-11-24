export * as ProposeMemoryTool from "./propose-memory.js"

import type { Context } from "@omnixa/plugin/effect/plugin"
import { ToolFailure } from "@omnixa/ai"
import { Effect, Schema } from "effect"
import { PersonalMemory as PersonalMemorySchema } from "@omnixa/schema/personal-memory"
import { Permission } from "../permission.js"
import { PersonalMemory } from "../session/personal-memory.js"

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

export const Plugin = {
  id: "omnixa.tool.memory_propose",
  effect: Effect.fn("ProposeMemoryTool.Plugin")(function* (ctx: Context) {
    const memories = yield* PersonalMemory.Service
    const permission = yield* Permission.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            permission
              .assert({
                action: name,
                resources: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool" as const, messageID: context.messageID, id: context.id },
              })
              .pipe(
                Effect.mapError(() => new ToolFailure({ message: "Permission denied: memory_propose" })),
                Effect.andThen(
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
                      sourceMessageID: context.messageID,
                      createdBy: "assistant",
                    })
                    return {
                      output: {
                        id: created.id,
                        status: created.status,
                        content: created.content,
                        source: created.source,
                        sensitivityLevel: created.sensitivityLevel,
                      },
                      content:
                        created.status === "pending"
                          ? `Memory proposed (pending review): "${created.content}". The user can confirm or reject it in the Memory Inspector.`
                          : `Memory recorded: "${created.content}".`,
                    }
                  }),
                ),
              ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
