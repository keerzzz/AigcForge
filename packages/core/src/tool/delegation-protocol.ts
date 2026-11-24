export * as DelegationProtocolTool from "./delegation-protocol.js"

import { ToolFailure } from "@omnixa/ai"
import type { Context } from "@omnixa/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Agent } from "../agent.js"
import { Location } from "../location.js"
import { Permission } from "../permission.js"
import { Session } from "../session.js"
import { SessionComposition } from "../session/composition.js"

export const name = "generate_delegation_protocol"
const NonEmpty = Schema.String.check(Schema.isPattern(/\S/))

export const Input = Schema.Struct({
  engine: NonEmpty,
  task_description: NonEmpty,
  project: Schema.optionalKey(NonEmpty),
  files: Schema.optionalKey(Schema.String),
  constraints: NonEmpty,
  include_protocol: Schema.optionalKey(Schema.Boolean),
  context: NonEmpty,
  success_criteria: NonEmpty,
  unknowns: NonEmpty,
  verification: NonEmpty,
})

export const Output = Schema.Struct({
  protocol: Schema.String,
  engine: Agent.ID,
  cardStatus: Schema.Literals(["present", "absent"]),
  protocolStatus: Schema.Literals(["included", "not_requested", "absent"]),
  protocolIncluded: Schema.Boolean,
  source: Schema.Struct({
    scope: Schema.Literals(["live", "frozen"]),
    location: Schema.String,
    snapshotDigest: Schema.optionalKey(Schema.String),
    consumerKey: Schema.optionalKey(Schema.String),
    originRelativePath: Schema.optionalKey(Schema.String),
    originRevision: Schema.optionalKey(Schema.String),
  }),
})

export const Plugin = {
  id: "omnixa.tool.generate_delegation_protocol",
  effect: Effect.fn("DelegationProtocolTool.Plugin")(function* (ctx: Context) {
    const agents = yield* Agent.Service
    const sessions = yield* Session.Service
    const compositions = yield* SessionComposition.Service
    const permission = yield* Permission.Service
    const location = yield* Location.Service
    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description:
            "Generate the complete seven-section specification before delegating with task. Pass output.protocol verbatim as task.prompt. Cards are guidance; this tool does not execute or authorize delegation. Set include_protocol for the target's declared protocol. Explicitly record unknowns and verification; do not invent missing information.",
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const parent = yield* sessions.get(context.sessionID)
              const selected =
                parent.mode === "custom"
                  ? yield* compositions.selectAgent(parent.id, input.engine).pipe(
                      Effect.mapError(
                        (error) =>
                          new ToolFailure({
                            message: `Cannot select frozen delegation target: target=${input.engine} reason=${error._tag}`,
                          }),
                      ),
                    )
                  : undefined
              const agent =
                selected?.info ?? (parent.mode === "custom" ? undefined : yield* agents.resolve(input.engine))
              if (agent === undefined)
                return yield* new ToolFailure({ message: `Unknown delegation target: ${input.engine}` })
              if (selected === undefined)
                yield* Agent.assertOrdinaryMode(agent, parent.mode).pipe(
                  Effect.mapError((error) => new ToolFailure({ message: error.message, error })),
                )
              if (agent.mode === "primary")
                return yield* new ToolFailure({ message: `Ineligible delegation target: ${agent.id}` })
              yield* permission.assert({
                action: name,
                resources: [agent.id],
                sessionID: parent.id,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              const scope = selected === undefined ? "live" : "frozen"
              if (agent.card && "_tag" in agent.card)
                return yield* new ToolFailure({
                  message: `Invalid delegation card: target=${agent.id} scope=${scope} reason=${agent.card.reason}`,
                })
              const card = agent.card
              const declaredProtocol = input.include_protocol === true ? card?.protocol : undefined
              const protocolStatus =
                input.include_protocol !== true
                  ? "not_requested"
                  : declaredProtocol === undefined
                    ? "absent"
                    : "included"
              const protocol = [
                "# Project",
                input.project ?? location.directory,
                "",
                "# Context",
                input.context,
                ...(input.files ? ["Relevant files:", input.files] : []),
                "",
                "# Task",
                input.task_description,
                "Success criteria:",
                input.success_criteria,
                "",
                "# Engine",
                `${agent.id}: ${agent.description ?? agent.name}`,
                ...(card ? ["Capabilities:", ...card.capabilities.map((value) => `- ${value}`)] : ["Card: absent"]),
                ...(declaredProtocol === undefined ? [] : ["Declared protocol:", declaredProtocol]),
                "",
                "# Constraints",
                input.constraints,
                ...(card ? card.constraints.map((value) => `- ${value}`) : []),
                "",
                "# Unknowns",
                input.unknowns,
                "",
                "# Verify",
                input.verification,
              ].join("\n")
              const output = {
                protocol,
                engine: agent.id,
                cardStatus: card === undefined ? "absent" : "present",
                protocolStatus,
                protocolIncluded: declaredProtocol !== undefined,
                source: {
                  scope,
                  location: location.directory,
                  ...(selected === undefined ? {} : { snapshotDigest: selected.snapshot.digest }),
                  ...(selected?.scope._tag === "scoped" ? { consumerKey: selected.scope.key } : {}),
                  ...(agent.originRelativePath === undefined ? {} : { originRelativePath: agent.originRelativePath }),
                  ...(agent.originRevision === undefined ? {} : { originRevision: agent.originRevision }),
                },
              } satisfies typeof Output.Type
              return {
                output,
                content: protocol,
                metadata: {
                  engine: output.engine,
                  cardStatus: output.cardStatus,
                  protocolStatus: output.protocolStatus,
                  protocolIncluded: output.protocolIncluded,
                  source: output.source,
                },
              }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure ? error : new ToolFailure({ message: error.message, error }),
              ),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
