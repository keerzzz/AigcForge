export * as ScheduleTool from "./schedule.js"

import type { Context } from "@omnixa/plugin/effect/plugin"
import { ToolFailure } from "@omnixa/ai"
import { Effect, Schema } from "effect"
import { Schedule } from "@omnixa/schema/schedule"
import { MetaAgentService } from "../../meta-agent/service.js"
import { Permission } from "../../permission.js"
import { ScheduleService } from "../../session/schedule-service.js"
import { serializedSelection } from "../../session/session.js"

export const name = "schedule"
export const Input = Schema.Union([
  Schema.Struct({ action: Schema.Literal("list") }),
  Schema.Struct({
    action: Schema.Literal("create"),
    kind: Schedule.Create.fields.kind,
    content: Schedule.Create.fields.content,
    dueAt: Schedule.Create.fields.dueAt,
    recurrence: Schedule.Create.fields.recurrence,
    timezone: Schedule.Create.fields.timezone,
    target: Schedule.Create.fields.target,
    executionPolicy: Schedule.Create.fields.executionPolicy,
  }),
  Schema.Struct({ action: Schema.Literal("edit"), scheduleID: Schedule.ID, ...Schedule.Edit.fields }),
  Schema.Struct({
    action: Schema.Literals(["pause", "resume", "cancel"]),
    scheduleID: Schedule.ID,
    ...Schedule.Mutation.fields,
  }),
])
export const Output = Schema.Struct({ data: Schema.Array(Schedule.Rule) })

export const Plugin = {
  id: "omnixa.tool.schedule",
  effect: Effect.fn("ScheduleTool.Plugin")(function* (ctx: Context) {
    const schedules = yield* ScheduleService.Service
    const metas = yield* MetaAgentService.Service
    const permission = yield* Permission.Service
    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          input: Input,
          output: Output,
          description:
            "Manage this Meta Session's one-shot or recurring schedules. Use reminder for a notification without model execution, prompt to queue work in an existing/new independent Session, or goal to wake a saved Goal. Choose an explicit timezone and target policy; new_once reuses its first Session, new creates one per occurrence. List to obtain the current revision before editing, pausing, resuming or cancelling. The server timer runs independently of open views.",
          execute: (input, context) =>
            Effect.gen(function* () {
              const capability = yield* metas.assertCoordination(context.sessionID, {
                agent: context.agent,
                tool: name,
              })
              yield* permission.assert({
                action: name,
                resources: [context.sessionID],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              const data = yield* serializedSelection(
                context.sessionID,
                Effect.gen(function* () {
                  yield* metas.assertCoordination(context.sessionID, {
                    agent: context.agent,
                    selection: capability.selection,
                    tool: name,
                  })
                  if (input.action === "list") return yield* schedules.listRules(context.sessionID)
                  if (input.action === "create")
                    return [
                      yield* schedules.createRule(
                        new Schedule.Create({ ...input, sessionID: context.sessionID }),
                        context.agent,
                        { messageID: context.messageID, id: context.id },
                      ),
                    ]
                  const rule = yield* schedules.getRule(input.scheduleID)
                  if (rule?.sessionID !== context.sessionID)
                    return yield* new ToolFailure({ message: "Schedule does not belong to this Session" })
                  if (input.action === "edit")
                    return [yield* schedules.editRule(input.scheduleID, new Schedule.Edit(input))]
                  if (input.action === "pause")
                    return [yield* schedules.pauseRule(input.scheduleID, input.expectedRevision)]
                  if (input.action === "cancel")
                    return [yield* schedules.cancelRule(input.scheduleID, input.expectedRevision)]
                  return [yield* schedules.resumeRule(input.scheduleID, input.expectedRevision)]
                }),
              )
              const output = { data }
              return { output, content: JSON.stringify(Schema.encodeSync(Output)(output)) }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error }))),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
