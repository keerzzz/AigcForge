export * as ProposePromptAssetTool from "./propose-prompt-asset"

import { ToolFailure } from "@aigcfroge/llm"
import { Effect, Layer, Schema } from "effect"
import { PromptAsset } from "@aigcfroge/schema/prompt-asset"
import { PromptAssetService } from "../prompt-asset-service"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "propose_prompt_asset"

export const description = `Propose a new prompt asset to be saved as a reusable template.

Call this tool after discussing the prompt requirements with the user. It validates the
candidate name and content, checks for conflicts with existing assets, and returns the
proposal result. The user can then review and apply the asset in the Chat right panel.

Usage:
- \`name\`: Short descriptive name (1-80 chars)
- \`description\`: What this prompt does (max 300 chars)
- \`template\`: The full prompt template content (1-100000 bytes)`

export const Input = Schema.Struct({
  name: PromptAsset.Name,
  description: PromptAsset.Description,
  template: PromptAsset.Template,
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
    const tools = yield* Tools.Service
    const service = yield* PromptAssetService.Service

    const tool = Tool.make({
      description,
      input: Input,
      output: Output,
      execute: (input) =>
        Effect.gen(function* () {
          const candidate = PromptAsset.Candidate.make({ ...input, relativePath: "" })
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
            ? `Name conflicts with an existing asset. Choose a different name.`
            : output.pathConflict
              ? `Path conflict. Choose a different name.`
              : output.exists
                ? `Asset exists at "${output.relativePath}". Ask user to review before overwriting.`
                : `Candidate is valid at "${output.relativePath}". Ask user to apply.`,
        },
      ],
    })

    yield* tools.register({ [name]: tool }).pipe(
      Effect.catch((err) => Effect.die(err)),
    )
  }),
)
