export * as ReminderCancelTool from "./reminder-cancel.js"

import type { Context } from "@aigcfroge/plugin/effect/plugin"
import { ToolFailure } from "@aigcfroge/ai"
import { Effect, Schema } from "effect"
import { Schedule } from "@aigcfroge/schema/schedule"
import { Permission } from "../permission.js"
import { ScheduleService } from "../session/schedule-service.js"

export const name = "reminder_cancel"

export const description = `Cancel a pending reminder. A cancelled reminder is never delivered.

Call this tool only after the user confirmed the cancellation.

Input:
- id: the reminder id returned by reminder_create`

export const Input = Schema.Struct({
  id: Schedule.ID.annotate({ description: "Reminder id from reminder_create" }),
})

export const Output = Schema.Struct({
  id: Schema.String,
  cancelled: Schema.Boolean,
  status: Schema.optional(Schema.String),
})

export const Plugin = {
  id: "aigcfroge.tool.reminder_cancel",
  effect: Effect.fn("ReminderCancelTool.Plugin")(function* (ctx: Context) {
    const schedules = yield* ScheduleService.Service
    const permission = yield* Permission.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            permission
              .assert({
                action: name,
                resources: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool" as const, messageID: context.messageID, id: context.id },
              })
              .pipe(
                Effect.mapError(() => new ToolFailure({ message: "Permission denied: reminder_cancel" })),
                Effect.andThen(
                  Effect.gen(function* () {
                    const prior = yield* schedules.list(context.sessionID)
                    if (!prior.some((item) => item.id === input.id)) {
                      return yield* Effect.fail(
                        new ToolFailure({ message: `Reminder ${input.id} does not belong to this session` }),
                      )
                    }
                    const cancelled = yield* schedules.cancel(input.id)
                    const wasCancelled = cancelled?.status === "cancelled"
                    return {
                      output: {
                        id: input.id,
                        cancelled: wasCancelled,
                        ...(cancelled ? { status: cancelled.status } : {}),
                      },
                      content: wasCancelled
                        ? `Reminder ${input.id} cancelled — it will never be delivered.`
                        : `Reminder ${input.id} could not be cancelled (already terminal: ${cancelled?.status ?? "unknown"}).`,
                    }
                  }),
                ),
              ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
