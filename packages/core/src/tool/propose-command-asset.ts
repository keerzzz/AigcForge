export * as ProposeCommandAssetTool from "./propose-command-asset"

import { ToolFailure } from "@aigcfroge/llm"
import { Effect, Layer, Schema } from "effect"
import { Flag } from "../flag/flag"
import { CommandAsset } from "@aigcfroge/schema/command-asset"
import { CommandAssetService } from "../command-asset-service"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "propose_command_asset"

export const description = `Propose a new command asset to be saved as a reusable slash command.

Call this tool after discussing the command requirements with the user. It validates the
candidate and checks for conflicts with existing command assets.

Usage:
- name: Short descriptive name (1-80 chars)
- description: What this command does (max 300 chars)
- invocation: The slash command invocation string (1-200 chars)
- args: Optional argument description
- source: Optional source documentation (max 5000 chars)`

export const Input = Schema.Struct({
  name: CommandAsset.Name,
  description: CommandAsset.Description,
  invocation: CommandAsset.Invocation,
  args: Schema.optional(Schema.String),
  source: CommandAsset.Source,
})

export const Output = Schema.Struct({
  relativePath: Schema.String,
  exists: Schema.Boolean,
  revision: Schema.optional(Schema.String),
  nameConflict: Schema.Boolean,
  pathConflict: Schema.Boolean,
})

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    if (!Flag.AIGCFROGE_EXPERIMENTAL_CHAT_PROMPT_ASSET) return

    const tools = yield* Tools.Service
    const service = yield* CommandAssetService.Service

    const tool = Tool.make({
      description,
      input: Input,
      output: Output,
      execute: (input) =>
        Effect.gen(function* () {
          const candidate = CommandAsset.Candidate.make({ ...input, relativePath: "" })
          const result = yield* service.propose(candidate)
          return {
            relativePath: result.relativePath,
            exists: result.exists,
            revision: result.revision ?? undefined,
            nameConflict: result.nameConflict,
            pathConflict: result.pathConflict,
          }
        }).pipe(
          Effect.catch((err) =>
            Effect.fail(new ToolFailure({ message: `Proposal failed: ${(err as Error).message}` })),
          ),
        ),
      toModelOutput: ({ output }) => [
        {
          type: "text" as const,
          text: output.nameConflict
            ? `Name conflicts with an existing command. Choose a different name.`
            : output.pathConflict
              ? `Path conflict. Choose a different name.`
              : output.exists
                ? `Command exists at "${output.relativePath}". Ask user to review before overwriting.`
                : `Candidate is valid at "${output.relativePath}". Ask user to apply.`,
        },
      ],
    })

    yield* tools.register({ [name]: tool }).pipe(
      Effect.catch((err) => Effect.die(err)),
    )
  }),
)
