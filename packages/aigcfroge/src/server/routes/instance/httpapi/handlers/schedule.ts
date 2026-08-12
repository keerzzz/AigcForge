export * as ScheduleHandlers from "./schedule"

import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Schedule } from "@aigcfroge/schema/schedule"
import { ScheduleService } from "@aigcfroge/core/session/schedule-service"
import { InstanceHttpApi } from "../api"
import { InvalidRequestError } from "../errors"

export const scheduleHandlers = HttpApiBuilder.group(InstanceHttpApi, "schedule", (handlers) =>
  Effect.gen(function* () {
    const schedules = yield* ScheduleService.Service
    const deliveries = yield* ScheduleService.DeliveryService

    const pending = Effect.fn("ScheduleHttpApi.pending")(function* () {
      return yield* schedules.listPending()
    })

    const list = Effect.fn("ScheduleHttpApi.list")(function* (ctx: { params: { sessionID: string } }) {
      return yield* schedules.list(ctx.params.sessionID as never)
    })

    const cancel = Effect.fn("ScheduleHttpApi.cancel")(function* (ctx: { params: { id: string } }) {
      if (!ctx.params.id.startsWith("sch_")) {
        return yield* Effect.fail(new InvalidRequestError({ message: `Invalid schedule id ${ctx.params.id}` }))
      }
      const cancelled = yield* schedules.cancel(ctx.params.id as Schedule.ID)
      if (!cancelled) {
        return yield* Effect.fail(new InvalidRequestError({ message: `Schedule ${ctx.params.id} not found or terminal` }))
      }
      return cancelled
    })

    const recent = Effect.fn("ScheduleHttpApi.recent")(function* (ctx: { query: { limit?: number } }) {
      return yield* deliveries.listRecent(ctx.query.limit ?? 6)
    })

    const inbox = Effect.fn("ScheduleHttpApi.inbox")(function* (ctx: { params: { sessionID: string } }) {
      return yield* deliveries.listInbox(ctx.params.sessionID as never)
    })

    const read = Effect.fn("ScheduleHttpApi.read")(function* (ctx: { params: { deliveryKey: string } }) {
      yield* deliveries.markRead(ctx.params.deliveryKey)
    })

    return handlers
      .handle("pending", pending)
      .handle("list", list)
      .handle("cancel", cancel)
      .handle("inbox", inbox)
      .handle("recent", recent)
      .handle("read", read)
  }),
)
