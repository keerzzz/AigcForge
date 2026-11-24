export * as ProposePromptAssetTool from "./propose-prompt-asset.js"

import type { Context } from "@omnixa/plugin/effect/plugin"
import { ToolFailure } from "@omnixa/ai"
import { Effect, Schema } from "effect"
import { PromptAsset } from "@omnixa/schema/prompt-asset"
import path from "node:path"
import { Flag } from "../flag/flag.js"
import { PromptAssetPath } from "../prompt-asset/path.js"
import { PromptAssetService } from "../prompt-asset-service.js"

export const name = "propose_prompt_asset"

export const description = `Propose a new prompt asset to be saved as a reusable template.

Call this tool after discussing the prompt requirements with the user. It validates the
candidate, checks for conflicts in the current Project, and returns the target and proposal
facts. The user can then choose a target, review and apply the asset in the Chat right panel.

Usage:
- \`name\`: Short descriptive name (1-80 chars)
- \`description\`: What this prompt does (max 300 chars)
- \`template\`: The full prompt template content (1-100000 bytes)`

export const Input = Schema.Struct({
  name: PromptAsset.Name,
  description: PromptAsset.Description,
  template: PromptAsset.Template,
})

export const Output = PromptAsset.Inspection

export const Plugin = {
  id: "omnixa.tool.propose_prompt_asset",
  effect: Effect.fn("ProposePromptAssetTool.Plugin")(function* (ctx: Context) {
    if (!Flag.OMNIXA_EXPERIMENTAL_CHAT_ASSET) return

    const service = yield* PromptAssetService.Service

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
                  PromptAsset.Candidate.make({
                    ...input,
                    relativePath: path.basename(PromptAssetPath.nameToRelativePath(input.name)),
                  }),
                catch: (error) =>
                  new PromptAssetService.InvalidCandidateError({
                    reason: error instanceof Error ? error.message : String(error),
                  }),
              })
              const output = yield* service.inspect({ candidate, scope: "project" })
              return {
                output,
                // Encode the nested Target instance for durable JSON metadata.
                metadata: yield* Schema.encodeEffect(Output)(output),
                content: output.nameConflict
                  ? `Name conflicts with an existing asset. Choose a different name.`
                  : output.pathConflict
                    ? `Path conflict. Choose a different name.`
                    : output.exists
                      ? `Asset exists at "${output.relativePath}". Ask user to review before overwriting.`
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
