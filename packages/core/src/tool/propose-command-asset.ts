export * as ProposeCommandAssetTool from "./propose-command-asset.js"

import type { Context } from "@omnixa/plugin/effect/plugin"
import { ToolFailure } from "@omnixa/ai"
import { Effect, Schema } from "effect"
import { CommandAsset } from "@omnixa/schema/command-asset"
import path from "node:path"
import { CommandAssetService } from "../command-asset-service.js"
import { CommandAssetPath } from "../command-asset/path.js"
import { Flag } from "../flag/flag.js"

export const name = "propose_command_asset"

export const description = `Propose a new command asset to be saved as a reusable slash command.

Call this tool after discussing the command requirements with the user. It validates the
candidate, checks for conflicts in the current Project, and returns the target and proposal
facts. The user can then choose a target, review and apply the asset in the Chat right panel.

Usage:
- name: Short descriptive name (1-80 chars)
- description: What this command does (max 300 chars)
- invocation: The slash command invocation string (1-200 chars)
- args: Optional argument description
- source: Full command source text, including any $ARGUMENTS placeholders`

export const Input = Schema.Struct({
  name: CommandAsset.Name,
  description: CommandAsset.Description,
  invocation: CommandAsset.Invocation,
  args: Schema.optional(Schema.String),
  source: CommandAsset.Source,
})

export const Output = CommandAsset.Inspection

export const Plugin = {
  id: "omnixa.tool.propose_command_asset",
  effect: Effect.fn("ProposeCommandAssetTool.Plugin")(function* (ctx: Context) {
    if (!Flag.OMNIXA_EXPERIMENTAL_CHAT_ASSET) return

    const service = yield* CommandAssetService.Service

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
                  CommandAsset.Candidate.make({
                    ...input,
                    relativePath: path.basename(CommandAssetPath.nameToRelativePath(input.name)),
                  }),
                catch: (error) =>
                  new CommandAssetService.InvalidCandidateError({
                    reason: error instanceof Error ? error.message : String(error),
                  }),
              })
              const output = yield* service.inspect({ candidate, scope: "project" })
              return {
                output,
                // Encode the nested Target instance for durable JSON metadata.
                metadata: yield* Schema.encodeEffect(Output)(output),
                content: output.nameConflict
                  ? `Name conflicts with an existing command. Choose a different name.`
                  : output.pathConflict
                    ? `Path conflict. Choose a different name.`
                    : output.exists
                      ? `Command exists at "${output.relativePath}". Ask user to review before overwriting.`
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
