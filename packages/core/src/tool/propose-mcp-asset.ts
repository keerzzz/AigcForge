export * as ProposeMCPAssetTool from "./propose-mcp-asset"

import { ToolFailure } from "@aigcfroge/llm"
import { Effect, Layer, Schema } from "effect"
import { Flag } from "../flag/flag"
import { MCPAsset } from "@aigcfroge/schema/mcp-asset"
import { MCPAssetService } from "../mcp-asset-service"
import { Tool } from "./tool"
import { Tools } from "./tools"

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

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    if (!Flag.AIGCFROGE_EXPERIMENTAL_CHAT_ASSET) return

    const tools = yield* Tools.Service
    const service = yield* MCPAssetService.Service

    const tool = Tool.make({
      description,
      input: Input,
      output: Output,
      execute: (input) =>
        Effect.gen(function* () {
          const candidate = MCPAsset.Candidate.make({ ...input, relativePath: "" })
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
            ? `Name conflicts with an existing MCP. Choose a different name.`
            : output.pathConflict
              ? `Path conflict. Choose a different name.`
              : output.exists
                ? `MCP exists at "${output.relativePath}". Ask user to review before overwriting.`
                : `Candidate is valid at "${output.relativePath}". Ask user to apply.`,
        },
      ],
    })

    yield* tools.register({ [name]: tool }).pipe(Effect.catch((err) => Effect.die(err)))
  }),
)
