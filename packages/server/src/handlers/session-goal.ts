import { SessionGoal } from "@aigcfroge/core/session/goal"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { ConflictError, InvalidRequestError } from "@aigcfroge/protocol/errors"
import { Api } from "../api"
import { missingSession } from "./session-error"

const goalErrors = <A, R>(effect: Effect.Effect<A, SessionGoal.GoalError, R>) =>
  effect.pipe(
    Effect.catchTag(
      "SessionGoal.Error",
      (error): Effect.Effect<never, ConflictError | InvalidRequestError> =>
        ["stale_revision", "stale_evidence_set", "active_goal_exists", "goal_conflict", "terminal"].includes(
          error.reason,
        )
          ? new ConflictError({ resource: error.goalID ?? error.sessionID, message: error.message })
          : new InvalidRequestError({ field: "goal", kind: error.reason, message: error.message }),
    ),
  )

export const SessionGoalHandler = HttpApiBuilder.group(Api, "server.sessionGoal", (handlers) =>
  Effect.gen(function* () {
    const goals = yield* SessionGoal.Service
    const execution = yield* SessionExecution.Service

    return handlers
      .handle(
        "sessionGoal.list",
        Effect.fn(function* (ctx) {
          return { data: yield* goals.list(ctx.params.sessionID) }
        }),
      )
      .handle(
        "sessionGoal.get",
        Effect.fn(function* (ctx) {
          return { data: (yield* goals.get(ctx.params)) ?? null }
        }),
      )
      .handle(
        "sessionGoal.set",
        Effect.fn(function* (ctx) {
          const goal = yield* goals.set({ ...ctx.params, ...ctx.payload }).pipe(
            Effect.catchTag("Session.NotFoundError", missingSession),
            Effect.catchTag(
              "Session.ControllerConflictError",
              (error) => new InvalidRequestError({ field: error.field, kind: error.kind, message: error.message }),
            ),
            Effect.catchTag(
              "SessionGoal.Error",
              (error): Effect.Effect<never, ConflictError | InvalidRequestError> =>
                ["active_goal_exists", "goal_conflict"].includes(error.reason)
                  ? new ConflictError({ resource: error.goalID ?? error.sessionID, message: error.message })
                  : new InvalidRequestError({ field: "goal", kind: error.reason, message: error.message }),
            ),
          )
          const admitted = yield* goalErrors(goals.advance({ sessionID: goal.sessionID, goalID: goal.id }))
          if (admitted.state === "admitted") yield* execution.wake(goal.sessionID)
          return { data: (yield* goals.get({ sessionID: goal.sessionID, goalID: goal.id })) ?? goal }
        }),
      )
      .handle(
        "sessionGoal.edit",
        Effect.fn(function* (ctx) {
          const data = yield* goals.edit({ ...ctx.params, ...ctx.payload }).pipe(
            Effect.catchTag("Session.NotFoundError", missingSession),
            Effect.catchTag(
              "Session.ControllerConflictError",
              (error) => new InvalidRequestError({ field: error.field, kind: error.kind, message: error.message }),
            ),
            Effect.catchTag(
              "SessionGoal.Error",
              (error): Effect.Effect<never, ConflictError | InvalidRequestError> =>
                error.reason === "stale_revision"
                  ? new ConflictError({ resource: error.goalID, message: error.message })
                  : new InvalidRequestError({ field: "goal", kind: error.reason, message: error.message }),
            ),
          )
          return { data }
        }),
      )
      .handle(
        "sessionGoal.pause",
        Effect.fn(function* (ctx) {
          return { data: yield* goalErrors(goals.pause({ ...ctx.params, ...ctx.payload })) }
        }),
      )
      .handle(
        "sessionGoal.resume",
        Effect.fn(function* (ctx) {
          const goal = yield* goals.resume({ ...ctx.params, ...ctx.payload }).pipe(
            Effect.catchTag("Session.NotFoundError", missingSession),
            Effect.catchTag(
              "Session.ControllerConflictError",
              (error) => new InvalidRequestError({ field: error.field, kind: error.kind, message: error.message }),
            ),
            Effect.catchTag(
              "SessionGoal.Error",
              (error): Effect.Effect<never, ConflictError | InvalidRequestError> =>
                ["stale_revision", "active_goal_exists", "terminal"].includes(error.reason)
                  ? new ConflictError({ resource: error.goalID, message: error.message })
                  : new InvalidRequestError({ field: "goal", kind: error.reason, message: error.message }),
            ),
          )
          const admitted = yield* goalErrors(goals.advance({ sessionID: goal.sessionID, goalID: goal.id }))
          if (admitted.state === "admitted") yield* execution.wake(goal.sessionID)
          return { data: (yield* goals.get({ sessionID: goal.sessionID, goalID: goal.id })) ?? goal }
        }),
      )
      .handle(
        "sessionGoal.cancel",
        Effect.fn(function* (ctx) {
          return { data: yield* goalErrors(goals.cancel({ ...ctx.params, ...ctx.payload })) }
        }),
      )
      .handle(
        "sessionGoal.confirm",
        Effect.fn(function* (ctx) {
          return { data: yield* goalErrors(goals.confirm({ ...ctx.params, ...ctx.payload })) }
        }),
      )
  }),
)
