export * as GoalTool from "./goal.js"

import type { Context } from "@omnixa/plugin/effect/plugin"
import { ToolFailure } from "@omnixa/ai"
import { Effect, Schema } from "effect"
import { Hash } from "@omnixa/util/hash"
import { MetaAgentService } from "../../meta-agent/service.js"
import { Permission } from "../../permission.js"
import { SessionGoal } from "../../session/goal.js"
import { SessionExecution } from "../../session/execution.js"

export const name = "goal"
export const Input = Schema.Union([
  Schema.Struct({ action: Schema.Literal("list") }),
  Schema.Struct({ action: Schema.Literal("set"), ...SessionGoal.CreateInput.fields }),
  Schema.Struct({ action: Schema.Literal("edit"), goalID: SessionGoal.ID, ...SessionGoal.EditInput.fields }),
  Schema.Struct({
    action: Schema.Literals(["pause", "resume", "cancel"]),
    goalID: SessionGoal.ID,
    ...SessionGoal.RevisionInput.fields,
  }),
])
export const Output = Schema.Struct({ data: Schema.Array(SessionGoal.Info) })

export const Plugin = {
  id: "omnixa.tool.goal",
  effect: Effect.fn("GoalTool.Plugin")(function* (ctx: Context) {
    const goals = yield* SessionGoal.Service
    const metas = yield* MetaAgentService.Service
    const permission = yield* Permission.Service
    const execution = yield* SessionExecution.Service
    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          input: Input,
          output: Output,
          description:
            "Manage this Meta Session's persistent Goal. Save an objective, exact command/artifact or human acceptance conditions, and optional execution budgets. Only one Goal runs at once. Command/artifact evidence is observed from actual producers; human acceptance is confirmed by the user through the Goal interface. List before editing to use the saved revision. Pausing or cancelling stops Goal continuation.",
          execute: (input, context) =>
            Effect.gen(function* () {
              const capture = { agent: context.agent, tool: name }
              yield* metas.assertCoordination(context.sessionID, capture)
              yield* permission.assert({
                action: name,
                resources: [context.sessionID],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              const data = yield* Effect.gen(function* () {
                if (input.action === "list") return yield* goals.list(context.sessionID)
                const goal =
                  input.action === "set"
                    ? yield* goals.set(
                        {
                          ...input,
                          sessionID: context.sessionID,
                          goalID:
                            input.goalID ??
                            SessionGoal.ID.make(
                              `gol_${Hash.sha256(JSON.stringify([context.sessionID, context.messageID, context.id]))}`,
                            ),
                        },
                        capture,
                      )
                    : input.action === "edit"
                      ? yield* goals.edit({ ...input, sessionID: context.sessionID }, capture)
                      : input.action === "pause"
                        ? yield* goals.pause({ ...input, sessionID: context.sessionID })
                        : input.action === "cancel"
                          ? yield* goals.cancel({ ...input, sessionID: context.sessionID })
                          : yield* goals.resume({ ...input, sessionID: context.sessionID }, capture)
                if (input.action === "set" || input.action === "resume") {
                  const advanced = yield* goals.advance({ sessionID: context.sessionID, goalID: goal.id })
                  if (advanced.state === "admitted") yield* execution.wake(context.sessionID)
                }
                return [(yield* goals.get({ sessionID: context.sessionID, goalID: goal.id })) ?? goal]
              })
              const output = { data }
              return { output, content: JSON.stringify(Schema.encodeSync(Output)(output)) }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error }))),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
