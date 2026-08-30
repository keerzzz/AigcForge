export * as ProposeSkillAssetTool from "./propose-skill-asset"

import { ToolFailure } from "@aigcfroge/llm"
import { Effect, Layer, Schema } from "effect"
import { Flag } from "../flag/flag"
import { SkillAsset } from "@aigcfroge/schema/skill-asset"
import { SkillAssetService } from "../skill-asset-service"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "propose_skill_asset"

export const description = `Propose a new skill asset to be saved as a reusable skill.

Call this tool after discussing the skill requirements with the user. It validates the
candidate name and content, checks for conflicts with existing skills, and returns the
proposal result. The user can then review and apply the asset in the Chat right panel.

Usage:
- name: Short descriptive name (1-80 chars)
- description: What this skill does (max 300 chars)
- slash: Enable as slash command (boolean)
- content: The full skill content (the instructions/code that defines the skill)`

export const Input = Schema.Struct({
  name: SkillAsset.Name,
  description: SkillAsset.Description,
  slash: Schema.Boolean,
  content: Schema.String,
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
    if (!Flag.AIGCFROGE_EXPERIMENTAL_CHAT_ASSET) return

    const tools = yield* Tools.Service
    const service = yield* SkillAssetService.Service

    const tool = Tool.make({
      description,
      input: Input,
      output: Output,
      execute: (input) =>
        Effect.gen(function* () {
          const candidate = SkillAsset.Candidate.make({ ...input, triggers: [], tags: [], relativePath: "" })
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
            ? `Name conflicts with an existing skill. Choose a different name.`
            : output.pathConflict
              ? `Path conflict. Choose a different name.`
              : output.exists
                ? `Skill exists at "${output.relativePath}". Ask user to review before overwriting.`
                : `Candidate is valid at "${output.relativePath}". Ask user to apply.`,
        },
      ],
    })

    yield* tools.register({ [name]: tool }).pipe(Effect.catch((err) => Effect.die(err)))
  }),
)
