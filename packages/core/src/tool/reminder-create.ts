export * as ReminderCreateTool from "./reminder-create"

import { ToolFailure } from "@aigcfroge/llm"
import { DateTime, Effect, Layer, Schema } from "effect"
import { ScheduleService } from "../session/schedule-service"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "reminder_create"

export const description = `Create a reminder for the user. The reminder is persisted and delivered
into the user's inbox when the absolute due time arrives (and caught up after an
offline restart).

Call this tool ONLY after the user confirmed the exact content, absolute due
time, and timezone. Do not guess times or timezones — re-confirm when ambiguous,
already past, or uncertain.

Input:
- content: the user-confirmed reminder text
- dueAt: absolute due timestamp in milliseconds since epoch
- timezone: the user-confirmed IANA timezone (e.g. "Asia/Shanghai")`

export const Input = Schema.Struct({
  content: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(500)),
  ).annotate({ description: "User-confirmed reminder text" }),
  dueAt: Schema.Number.pipe(
    Schema.check(Schema.isInt()),
    Schema.check(Schema.isGreaterThan(0)),
  ).annotate({ description: "Absolute due timestamp (ms since epoch)" }),
  timezone: Schema.String.pipe(Schema.check(Schema.isMinLength(1))).annotate({
    description: "User-confirmed IANA timezone",
  }),
})

export const Output = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  content: Schema.String,
  dueAt: Schema.Number,
  timezone: Schema.String,
  deliveryKey: Schema.String,
})

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const schedules = yield* ScheduleService.Service

    const tool = Tool.make({
      description,
      input: Input,
      output: Output,
      execute: (input, context) =>
        Effect.gen(function* () {
          const now = (yield* DateTime.nowAsDate).getTime()
          if (input.dueAt <= now) {
            return yield* Effect.fail(
              new ToolFailure({ message: "The due time is in the past. Re-confirm the target time with the user." }),
            )
          }
          const created = yield* schedules.create({
            sessionID: context.sessionID,
            kind: "reminder",
            content: input.content,
            dueAt: input.dueAt,
            timezone: input.timezone,
            // Idempotency key (review MINOR): stable per (session, due time) —
            // a tool retry re-creating the same reminder collides on the
            // schedule.delivery_key unique constraint instead of duplicating.
            deliveryKey: `reminder:${context.sessionID}:${input.dueAt}`,
          })
          return {
            id: created.id,
            status: created.status,
            content: created.content,
            dueAt: created.dueAt,
            timezone: created.timezone,
            deliveryKey: created.deliveryKey,
          }
        }).pipe(
          Effect.catch((err) =>
            Effect.fail(new ToolFailure({ message: `Reminder creation failed: ${(err as Error).message}` })),
          ),
        ),
      toModelOutput: ({ output }) => [
        {
          type: "text" as const,
          text: `Reminder created: "${output.content}" at ${new Date(output.dueAt).toLocaleString()} (${output.timezone}). It will be delivered to your inbox when due.`,
        },
      ],
    })

    yield* tools.register({ [name]: tool }).pipe(Effect.catch((err) => Effect.die(err)))
  }),
)
