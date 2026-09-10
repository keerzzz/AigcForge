import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { MetaContextBuilder } from "../agent/meta/context-builder"
import { formatAgentCard, loadProtocolCard } from "../agent/protocol"

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

export function buildProtocol(input: Schema.Schema.Type<typeof Parameters>, project = process.cwd()) {
  return Effect.gen(function* () {
    const protocol = MetaContextBuilder.build({
      project: input.project ?? project,
      taskDescription: input.task_description,
      engine: input.engine,
      delegationId: `deleg_${Date.now()}`,
      files: input.files ?? "",
      constraints: [input.constraints ?? "", formatAgentCard(input.engine) ?? ""].filter(Boolean).join("\n"),
      history: [],
    })
    if (!input.include_protocol) return protocol
    const protocolCard = yield* Effect.promise(() => loadProtocolCard(input.engine))
    if (!protocolCard) return protocol
    return protocol + ["", `--- ${input.engine} protocol ---`, protocolCard].join("\n")
  })
}

export const DelegationProtocolTool = Tool.define(
  "generate_delegation_protocol",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        buildProtocol(params).pipe(
          Effect.map((output) => ({
            title: `Delegation protocol for ${params.engine}`,
            output,
            metadata: { engine: params.engine, protocolIncluded: params.include_protocol === true },
          })),
        ),
    }
  }),
)
