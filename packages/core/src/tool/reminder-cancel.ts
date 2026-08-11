export * as ReminderCancelTool from "./reminder-cancel"

import { ToolFailure } from "@aigcfroge/llm"
import { Effect, Layer, Schema } from "effect"
import { Schedule } from "@aigcfroge/schema/schedule"
import { ScheduleService } from "../session/schedule-service"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "reminder_cancel"

export const description = `Cancel a pending reminder. A cancelled reminder is never delivered.

Call this tool only after the user confirmed the cancellation.

Input:
- id: the reminder id returned by reminder_create`

export const Input = Schema.Struct({
  id: Schema.String.annotate({ description: "Reminder id from reminder_create" }),
})

export const Output = Schema.Struct({
  id: Schema.String,
  cancelled: Schema.Boolean,
  status: Schema.optional(Schema.String),
})

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const schedules = yield* ScheduleService.Service

    const tool = Tool.make({
      description,
      input: Input,
      output: Output,
      execute: (input) =>
        Effect.gen(function* () {
          const cancelled = yield* schedules.cancel(input.id as Schedule.ID)
          return {
            id: input.id,
            cancelled: cancelled?.status === "cancelled",
            ...(cancelled ? { status: cancelled.status } : {}),
          }
        }).pipe(
          Effect.catch((err) =>
            Effect.fail(new ToolFailure({ message: `Reminder cancel failed: ${(err as Error).message}` })),
          ),
        ),
      toModelOutput: ({ output }) => [
        {
          type: "text" as const,
          text: output.cancelled
            ? `Reminder ${output.id} cancelled — it will never be delivered.`
            : `Reminder ${output.id} could not be cancelled (already terminal: ${output.status ?? "unknown"}).`,
        },
      ],
    })

    yield* tools.register({ [name]: tool }).pipe(Effect.catch((err) => Effect.die(err)))
  }),
)
