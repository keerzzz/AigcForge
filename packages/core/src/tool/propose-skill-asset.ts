export * as ProposeSkillAssetTool from "./propose-skill-asset.js"

import type { Context } from "@omnixa/plugin/effect/plugin"
import { ToolFailure } from "@omnixa/ai"
import { Effect, Schema } from "effect"
import { SkillAsset } from "@omnixa/schema/skill-asset"
import path from "node:path"
import { Flag } from "../flag/flag.js"
import { SkillAssetService } from "../skill-asset-service.js"
import { SkillAssetPath } from "../skill-asset/path.js"

export const name = "propose_skill_asset"

export const description = `Propose a new skill asset to be saved as a reusable skill.

Call this tool after discussing the skill requirements with the user. It validates the
candidate name and content, checks for conflicts in the current Project, and returns
the target and proposal facts. The user can then choose a target, review and apply the
asset in the Chat right panel.

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

export const Output = SkillAsset.Inspection

export const Plugin = {
  id: "omnixa.tool.propose_skill_asset",
  effect: Effect.fn("ProposeSkillAssetTool.Plugin")(function* (ctx: Context) {
    if (!Flag.OMNIXA_EXPERIMENTAL_CHAT_ASSET) return

    const service = yield* SkillAssetService.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input) =>
            Effect.gen(function* () {
              const candidate = yield* Effect.try({
                try: () =>
                  SkillAsset.Candidate.make({
                    ...input,
                    triggers: [],
                    tags: [],
                    relativePath: path.basename(SkillAssetPath.nameToRelativePath(input.name)),
                  }),
                catch: (error) =>
                  new SkillAssetService.InvalidCandidateError({
                    reason: error instanceof Error ? error.message : String(error),
                  }),
              })
              const output = yield* service.inspect({ candidate, scope: "project" })
              return {
                output,
                // Encode the nested Target instance for durable JSON metadata.
                metadata: yield* Schema.encodeEffect(Output)(output),
                content: output.nameConflict
                  ? `Name conflicts with an existing skill. Choose a different name.`
                  : output.pathConflict
                    ? `Path conflict. Choose a different name.`
                    : output.exists
                      ? `Skill exists at "${output.relativePath}". Ask user to review before overwriting.`
                      : `Candidate is valid at "${output.relativePath}". Ask user to apply.`,
              }
            }).pipe(
              Effect.mapError(
                (err) =>
                  new ToolFailure({ message: `Proposal failed: ${err instanceof Error ? err.message : String(err)}` }),
              ),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
