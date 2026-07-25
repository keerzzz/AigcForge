export * as ProposeAgentAssetTool from "./propose-agent-asset"

import { ToolFailure } from "@aigcfroge/llm"
import { Effect, Layer, Schema } from "effect"
import { Flag } from "../flag/flag"
import { AgentAsset } from "@aigcfroge/schema/agent-asset"
import { AgentAssetService } from "../agent-asset-service"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "propose_agent_asset"

export const description = `Propose a new agent asset to be saved as a reusable agent configuration.

Call this tool after discussing the agent requirements with the user. It validates the
candidate and checks for conflicts with existing agent assets.

Usage:
- name: Short descriptive name (1-80 chars)
- description: What this agent does (max 300 chars)
- config: Full agent configuration content (max 100000 bytes)
- source: Optional source documentation string`

export const Input = Schema.Struct({
  name: AgentAsset.Name,
  description: AgentAsset.Description,
  config: AgentAsset.Config,
  source: AgentAsset.Source,
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
    const service = yield* AgentAssetService.Service

    const tool = Tool.make({
      description,
      input: Input,
      output: Output,
      execute: (input) =>
        Effect.gen(function* () {
          const candidate = AgentAsset.Candidate.make({ ...input, relativePath: "" })
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
            ? `Name conflicts with an existing agent. Choose a different name.`
            : output.pathConflict
              ? `Path conflict. Choose a different name.`
              : output.exists
                ? `Agent exists at "${output.relativePath}". Ask user to review before overwriting.`
                : `Candidate is valid at "${output.relativePath}". Ask user to apply.`,
        },
      ],
    })

    yield* tools.register({ [name]: tool }).pipe(
      Effect.catch((err) => Effect.die(err)),
    )
  }),
)
