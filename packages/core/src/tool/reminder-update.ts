export * as ReminderUpdateTool from "./reminder-update"

import { ToolFailure } from "@aigcfroge/llm"
import { Effect, Layer, Schema } from "effect"
import { Schedule } from "@aigcfroge/schema/schedule"
import { ScheduleService } from "../session/schedule-service"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "reminder_update"

export const description = `Update an existing pending reminder's content, absolute due time, or timezone.

Call this tool ONLY after the user confirmed the new values. A terminal reminder
(cancelled/completed/failed) cannot be updated — cancel + create a new one instead.

Input:
- id: the reminder id returned by reminder_create
- content (optional): new reminder text
- dueAt (optional): new absolute due timestamp (ms since epoch)
- timezone (optional): new IANA timezone`

export const Input = Schema.Struct({
  id: Schema.String.annotate({ description: "Reminder id from reminder_create" }),
  content: Schema.optional(Schema.String),
  dueAt: Schema.optional(Schema.Number),
  timezone: Schema.optional(Schema.String),
})

export const Output = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  content: Schema.String,
  dueAt: Schema.Number,
  timezone: Schema.String,
  updated: Schema.Boolean,
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
          const updated = yield* schedules.update({
            id: input.id as Schedule.ID,
            ...(input.content !== undefined ? { content: input.content } : {}),
            ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
            ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
          })
          if (!updated) {
            return {
              id: input.id,
              status: "terminal",
              content: input.content ?? "",
              dueAt: input.dueAt ?? 0,
              timezone: input.timezone ?? "",
              updated: false,
            }
          }
          return {
            id: updated.id,
            status: updated.status,
            content: updated.content,
            dueAt: updated.dueAt,
            timezone: updated.timezone,
            updated: true,
          }
        }).pipe(
          Effect.catch((err) =>
            Effect.fail(new ToolFailure({ message: `Reminder update failed: ${(err as Error).message}` })),
          ),
        ),
      toModelOutput: ({ output }) => [
        {
          type: "text" as const,
          text: output.updated
            ? `Reminder updated: "${output.content}" at ${new Date(output.dueAt).toLocaleString()} (${output.timezone}).`
            : `Reminder ${output.id} is terminal and cannot be updated. Cancel it and create a new one instead.`,
        },
      ],
    })

    yield* tools.register({ [name]: tool }).pipe(Effect.catch((err) => Effect.die(err)))
  }),
)
