export * as ReminderUpdateTool from "./reminder-update"

import { createHash } from "crypto"
import { ToolFailure } from "@aigcfroge/llm"
import { Cause, DateTime, Effect, Layer, Schema } from "effect"
import { Schedule } from "@aigcfroge/schema/schedule"
import { PermissionV2 } from "../permission"
import { ScheduleService } from "../session/schedule-service"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { IanaTimezone } from "./reminder-create"

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
  id: Schedule.ID.annotate({ description: "Reminder id from reminder_create" }),
  content: Schema.optional(
    Schema.String.pipe(
      Schema.check(Schema.isMinLength(1)),
      Schema.check(Schema.isMaxLength(500)),
    ),
  ),
  dueAt: Schema.optional(
    Schema.Number.pipe(
      Schema.check(Schema.isInt()),
      Schema.check(Schema.isGreaterThan(0)),
    ),
  ),
  timezone: Schema.optional(IanaTimezone),
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
    const permission = yield* PermissionV2.Service

    const tool = Tool.make({
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
            source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
          })
          .pipe(
            Effect.mapError(() => new ToolFailure({ message: "Permission denied: reminder_update" })),
            Effect.andThen(
              Effect.gen(function* () {
                const prior = yield* schedules.list(context.sessionID)
                const priorRow = prior.find((item) => item.id === input.id)
                if (!priorRow) {
                  return yield* Effect.fail(
                    new ToolFailure({ message: `Reminder ${input.id} does not belong to this session` }),
                  )
                }
                if (input.dueAt !== undefined) {
                  const now = (yield* DateTime.nowAsDate).getTime()
                  if (input.dueAt <= now) {
                    return yield* Effect.fail(
                      new ToolFailure({ message: "The due time is in the past. Re-confirm the target time with the user." }),
                    )
                  }
                }
                // A changed content/due time regenerates the idempotency key so
                // the original reminder tuple stays re-creatable after an edit
                // (review MAJOR: the stale key would hit the unique constraint).
                const identityChanged = input.content !== undefined || input.dueAt !== undefined
                const mergedContent = input.content ?? priorRow.content
                const mergedDueAt = input.dueAt ?? priorRow.dueAt
                const updated = yield* schedules.update({
                  id: input.id,
                  ...(input.content !== undefined ? { content: input.content } : {}),
                  ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
                  ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
                  ...(identityChanged
                    ? {
                        deliveryKey: `reminder:${context.sessionID}:${mergedDueAt}:${createHash("sha256").update(mergedContent).digest("hex").slice(0, 16)}`,
                      }
                    : {}),
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
                Effect.catchCause((cause) =>
                  Effect.fail(new ToolFailure({ message: `Reminder update failed: ${Cause.pretty(cause)}` })),
                ),
              ),
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
