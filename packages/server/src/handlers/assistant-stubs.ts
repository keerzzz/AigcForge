import { InvalidRequestError } from "@aigcfroge/protocol/errors"
import { PersonalMemory } from "@aigcfroge/core/session/personal-memory"
import { ScheduleService } from "@aigcfroge/core/session/schedule-service"
import { ScheduleExecution } from "@aigcfroge/core/session/schedule-execution"
import { HttpApiBuilder } from "effect/http-api"
import { Effect, Layer } from "effect"
import { Api } from "../api"

/**
 * Personal memory and schedules use their domain services. KB and import
 * contracts keep their existing unavailable response.
 */
const failClosed = (group: string, name: string) =>
  Effect.fail(
    new InvalidRequestError({
      message: `${group}.${name} is not implemented until the R2 assistant-subsystem port`,
      kind: "not_implemented",
    }),
  )

export const MemoryHandler = HttpApiBuilder.group(Api, "memory", (handlers) =>
  Effect.gen(function* () {
    const memories = yield* PersonalMemory.Service
    return handlers
      .handle("memory.list", () => memories.list())
      .handle("memory.pending", () => memories.listPending())
      .handle("memory.confirm", ({ params }) =>
        Effect.gen(function* () {
          const confirmed = yield* memories.confirm(params.id)
          if (!confirmed)
            return yield* new InvalidRequestError({ message: `Memory ${params.id} not found or not pending` })
          return confirmed
        }),
      )
      .handle("memory.reject", ({ params }) =>
        Effect.gen(function* () {
          const rejected = yield* memories.reject(params.id)
          if (!rejected)
            return yield* new InvalidRequestError({ message: `Memory ${params.id} not found or not pending` })
          return rejected
        }),
      )
      .handle("memory.edit", ({ params, payload }) =>
        Effect.gen(function* () {
          const edited = yield* memories.edit({ id: params.id, ...payload })
          if (!edited) return yield* new InvalidRequestError({ message: `Memory ${params.id} not found` })
          return edited
        }),
      )
      .handle("memory.remove", ({ params }) =>
        Effect.gen(function* () {
          const removed = yield* memories.remove(params.id)
          if (!removed)
            return yield* new InvalidRequestError({ message: `Memory ${params.id} not found or not confirmed` })
          return removed
        }),
      )
  }),
).pipe(Layer.provide(PersonalMemory.layer))

export const KBHandler = HttpApiBuilder.group(Api, "kb", (handlers) =>
  handlers
    .handle("kb.list", () => failClosed("kb", "list"))
    .handle("kb.get", () => failClosed("kb", "get"))
    .handle("kb.create", () => failClosed("kb", "create"))
    .handle("kb.update", () => failClosed("kb", "update"))
    .handle("kb.remove", () => failClosed("kb", "remove"))
    .handle("kb.backlinks", () => failClosed("kb", "backlinks"))
    .handle("kb.dangling", () => failClosed("kb", "dangling"))
    .handle("kb.search", () => failClosed("kb", "search")),
)

export const ScheduleHandler = HttpApiBuilder.group(Api, "schedule", (handlers) =>
  Effect.gen(function* () {
    const schedules = yield* ScheduleService.Service
    const deliveries = yield* ScheduleService.DeliveryService
    const execution = yield* ScheduleExecution.Service
    const requireRule = (id: Parameters<ScheduleService.Interface["getRule"]>[0]) =>
      schedules
        .getRule(id)
        .pipe(
          Effect.flatMap((rule) =>
            rule ? Effect.succeed(rule) : Effect.fail(new InvalidRequestError({ message: `Schedule ${id} not found` })),
          ),
        )
    const invalid = (error: Error) => new InvalidRequestError({ message: error.message })
    return handlers
      .handle("schedule.pending", () => schedules.listPending())
      .handle("schedule.list", ({ params }) => schedules.list(params.sessionID))
      .handle("schedule.cancel", ({ params }) =>
        schedules
          .cancel(params.id)
          .pipe(
            Effect.flatMap((schedule) =>
              schedule
                ? Effect.succeed(schedule)
                : Effect.fail(new InvalidRequestError({ message: `Schedule ${params.id} not found` })),
            ),
          ),
      )
      .handle("schedule.create", ({ payload }) => execution.create(payload).pipe(Effect.mapError(invalid)))
      .handle("schedule.rules", ({ params }) => schedules.listRules(params.sessionID))
      .handle("schedule.rule", ({ params }) => requireRule(params.id))
      .handle("schedule.edit", ({ params, payload }) =>
        execution.edit(params.id, payload).pipe(Effect.mapError(invalid)),
      )
      .handle("schedule.pause", ({ params, payload }) =>
        schedules.pauseRule(params.id, payload.expectedRevision).pipe(Effect.mapError(invalid)),
      )
      .handle("schedule.resume", ({ params, payload }) =>
        schedules.resumeRule(params.id, payload.expectedRevision).pipe(Effect.mapError(invalid)),
      )
      .handle("schedule.cancelRule", ({ params, payload }) =>
        schedules.cancelRule(params.id, payload.expectedRevision).pipe(Effect.mapError(invalid)),
      )
      .handle("schedule.runOnce", ({ params, payload }) =>
        execution.runOnce(params.id, payload.expectedRevision).pipe(Effect.mapError(invalid)),
      )
      .handle("schedule.runs", ({ params }) => requireRule(params.id).pipe(Effect.andThen(schedules.runs(params.id))))
      .handle("schedule.cancelRun", ({ params }) =>
        execution.cancelRun(params.occurrenceID).pipe(Effect.mapError(invalid)),
      )
      .handle("delivery.recent", ({ query }) => deliveries.listRecent(query.limit ?? 50))
      .handle("delivery.inbox", ({ params }) => deliveries.listInbox(params.sessionID))
      .handle("delivery.read", ({ params }) => deliveries.markRead(params.deliveryKey))
  }),
)

export const ImportParserHandler = HttpApiBuilder.group(Api, "import-parser", (handlers) =>
  handlers.handle("import-parser.parse", () => failClosed("import-parser", "parse")),
)
