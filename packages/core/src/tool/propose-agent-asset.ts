export * as ProposeAgentAssetTool from "./propose-agent-asset.js"

import type { Context } from "@aigcfroge/plugin/effect/plugin"
import { ToolFailure } from "@aigcfroge/ai"
import { Effect, Schema } from "effect"
import { AgentAsset } from "@aigcfroge/schema/agent-asset"
import { Agent } from "../agent.js"
import { Config } from "../config.js"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { Global } from "@aigcfroge/util/global"
import { optional } from "@aigcfroge/schema/schema"
import { AgentAssetService } from "../agent-asset-service.js"
import { ConfigAgentPlugin } from "../config/plugin/agent.js"
import { Flag } from "../flag/flag.js"

export const name = "propose_agent_asset"

export const description = `Propose a new agent asset to be saved as a reusable agent configuration.

Call this tool after discussing the agent requirements with the user. It validates the
candidate and checks for conflicts with existing agent assets.

Usage:
- name: Short descriptive name (1-80 chars)
- description: What this agent does (max 300 chars)
- config: Full agent configuration content (max 100000 bytes)
- source: Optional source documentation string

To import an existing user-defined Config agent, pass only configAgentID. The tool
loads and merges its declarations and captures the complete candidate for review.`

export const Input = Schema.Union([
  Schema.Struct({
    name: AgentAsset.Name,
    description: AgentAsset.Description,
    config: AgentAsset.Config,
    source: AgentAsset.Source,
  }),
  Schema.Struct({ configAgentID: Agent.ID }),
])

export const Output = Schema.Struct({
  relativePath: Schema.String,
  exists: Schema.Boolean,
  revision: Schema.optional(Schema.String),
  nameConflict: Schema.Boolean,
  pathConflict: Schema.Boolean,
  warnings: Schema.Array(AgentAsset.Warning),
  candidate: optional(AgentAsset.Candidate),
})

export const Plugin = {
  id: "aigcfroge.tool.propose_agent_asset",
  effect: Effect.fn("ProposeAgentAssetTool.Plugin")(function* (ctx: Context) {
    if (!Flag.AIGCFROGE_EXPERIMENTAL_CHAT_ASSET) return

    const service = yield* AgentAssetService.Service
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service

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
              const candidate =
                "configAgentID" in input
                  ? yield* ConfigAgentPlugin.candidate(input.configAgentID).pipe(
                      Effect.provideService(Agent.Service, agents),
                      Effect.provideService(Config.Service, config),
                      Effect.provideService(FSUtil.Service, fs),
                      Effect.provideService(Global.Service, global),
                    )
                  : AgentAsset.Candidate.make({ ...input, relativePath: "" })
              if (!candidate)
                return yield* new ToolFailure({
                  message: "The user-defined Config agent is unavailable or cannot be imported",
                })
              const result = yield* service.propose(candidate)
              const output = {
                relativePath: result.relativePath,
                exists: result.exists,
                revision: result.revision ?? undefined,
                nameConflict: result.nameConflict,
                pathConflict: result.pathConflict,
                warnings: result.warnings.map((warning) => new AgentAsset.Warning(warning)),
                ...("configAgentID" in input
                  ? { candidate: new AgentAsset.Candidate({ ...candidate, relativePath: result.relativePath }) }
                  : {}),
              }
              return {
                output,
                // Durable metadata needs JSON objects, not Warning class instances.
                metadata: { ...Schema.encodeSync(Output)(output), revision: result.revision },
                content: output.nameConflict
                  ? `Name conflicts with an existing agent. Choose a different name.`
                  : output.pathConflict
                    ? `Path conflict. Choose a different name.`
                    : output.exists
                      ? `Agent exists at "${output.relativePath}". Ask user to review before overwriting.`
                      : `Candidate is valid at "${output.relativePath}". Ask user to apply.`,
              }
            }).pipe(
              Effect.catch((err) =>
                Effect.fail(
                  new ToolFailure({ message: `Proposal failed: ${err instanceof Error ? err.message : String(err)}` }),
                ),
              ),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
