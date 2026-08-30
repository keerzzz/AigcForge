import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { MetaContextBuilder } from "../agent/meta/context-builder"
import { getAgentCard } from "../agent/protocol"
import { readFileSync, existsSync } from "fs"
import path from "path"

const DESCRIPTION = [
  "Generate a structured delegation protocol document for subagent or CLI task assignment.",
  "Call this tool BEFORE using the task tool when delegating work to a subagent or external CLI.",
  "The output is a formatted protocol document that you must pass as the prompt parameter to the task tool.",
  "This ensures every delegation has consistent context structure.",
].join("\n")

export const Parameters = Schema.Struct({
  engine: Schema.String.annotate({
    description: "Target engine name: build, explore, general, plan, claude-code, gemini",
  }),
  task_description: Schema.String.annotate({ description: "Clear description of what the target engine should do" }),
  project: Schema.optional(Schema.String).annotate({ description: "Project root path" }),
  files: Schema.optional(Schema.String).annotate({ description: "Relevant file paths, comma-separated" }),
  constraints: Schema.optional(Schema.String).annotate({ description: "Constraints or requirements for the target" }),
  include_protocol: Schema.optional(Schema.Boolean).annotate({
    description: "Set to true for complex tasks to inject the engine's protocol card. Defaults to false.",
  }),
})

function loadProtocolCard(engine: string): string {
  const card = getAgentCard(engine)
  if (!card?.protocol) return ""
  const mdPath = path.join(import.meta.dir, "..", "agent", engine, "protocol.md")
  if (!existsSync(mdPath)) return ""
  const content = readFileSync(mdPath, "utf-8").trim()
  if (!content) return ""
  return ["", `--- ${engine} protocol ---`, content].join("\n")
}

export const DelegationProtocolTool = Tool.define(
  "generate_delegation_protocol",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const protocol = MetaContextBuilder.build({
            project: params.project ?? process.cwd(),
            taskDescription: params.task_description,
            engine: params.engine,
            delegationId: `deleg_${Date.now()}`,
            files: params.files ?? "",
            constraints: params.constraints ?? "",
            history: [],
          })

          let output = protocol

          if (params.include_protocol) {
            const card = loadProtocolCard(params.engine)
            if (card) output += card
          }

          return {
            title: `Delegation protocol for ${params.engine}`,
            output,
            metadata: { engine: params.engine, protocolIncluded: params.include_protocol === true },
          }
        }),
    }
  }),
)
