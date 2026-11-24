export * as ProposeMCPAssetTool from "./propose-mcp-asset.js"

import type { Context } from "@omnixa/plugin/effect/plugin"
import { ToolFailure } from "@omnixa/ai"
import { Effect, Schema } from "effect"
import { MCPAsset } from "@omnixa/schema/mcp-asset"
import { Flag } from "../flag/flag.js"
import { MCPAssetService } from "../mcp-asset-service.js"

export const name = "propose_mcp_asset"

export const description = `Propose a new MCP asset to be saved as a reusable MCP server configuration.

Call this tool after discussing the MCP setup requirements with the user. It validates the
candidate and checks for conflicts with existing MCP assets.

Usage:
- name: Short descriptive name (1-80 chars)
- description: What this MCP does (max 300 chars)
- command: The command to run (1-200 chars)
- args: Command arguments (array of strings)
- env: Environment variables (record of string key-value pairs)
- configJson: Full JSON configuration string`

export const Input = Schema.Struct({
  name: MCPAsset.Name,
  description: MCPAsset.Description,
  command: MCPAsset.Command,
  args: Schema.Array(Schema.String),
  env: Schema.Record(Schema.String, Schema.String),
  configJson: MCPAsset.ConfigJson,
})

export const Output = Schema.Struct({
  relativePath: Schema.String,
  exists: Schema.Boolean,
  revision: Schema.optional(Schema.String),
  nameConflict: Schema.Boolean,
  pathConflict: Schema.Boolean,
})

export const Plugin = {
  id: "omnixa.tool.propose_mcp_asset",
  effect: Effect.fn("ProposeMCPAssetTool.Plugin")(function* (ctx: Context) {
    if (!Flag.OMNIXA_EXPERIMENTAL_CHAT_ASSET) return

    const service = yield* MCPAssetService.Service

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
              const candidate = MCPAsset.Candidate.make({ ...input, relativePath: "" })
              const result = yield* service.propose(candidate)
              const output = {
                relativePath: result.relativePath,
                exists: result.exists,
                revision: result.revision ?? undefined,
                nameConflict: result.nameConflict,
                pathConflict: result.pathConflict,
              }
              return {
                output,
                metadata: { ...output, revision: result.revision },
                content: output.nameConflict
                  ? `Name conflicts with an existing MCP. Choose a different name.`
                  : output.pathConflict
                    ? `Path conflict. Choose a different name.`
                    : output.exists
                      ? `MCP exists at "${output.relativePath}". Ask user to review before overwriting.`
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
