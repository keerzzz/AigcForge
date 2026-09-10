export * as DelegationHandlers from "./delegation"

import { SessionID } from "@aigcfroge/schema/session-id"
import { DelegationExecution } from "@aigcfroge/core/delegation/execution"
import { SessionV2 } from "@aigcfroge/core/session"
import { Flag } from "@aigcfroge/core/flag/flag"
import { DelegationPresentation } from "@aigcfroge/core/delegation/presentation"
import { DelegationService, type ServiceError } from "@aigcfroge/core/delegation/service"
import { Effect, Layer } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { InvalidRequestError } from "../errors"
import { WorkspaceRouteContext } from "../middleware/workspace-routing"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { Database } from "@aigcfroge/core/database/database"
import { eq } from "drizzle-orm"

const view = DelegationPresentation.view

const apiError = (error: ServiceError | unknown) =>
  new InvalidRequestError({ message: error instanceof Error ? error.message : String(error) })

const delegationHandlerLayer = HttpApiBuilder.group(InstanceHttpApi, "delegation", (handlers) =>
  Effect.gen(function* () {
    const service = yield* DelegationService.Service
    const execution = yield* DelegationExecution.Service
    const { db } = yield* Database.Service
    const enabled = () =>
      Flag.AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS
        ? Effect.void
        : Effect.fail(new InvalidRequestError({ message: "Persistent delegations are disabled" }))
    const requireParentOwned = Effect.fn("LegacyDelegationHttp.requireParentOwned")(function* (
      parentSessionID: SessionID.ID,
    ) {
      const route = yield* WorkspaceRouteContext
      const session = yield* db
        .select({ directory: SessionTable.directory, workspaceID: SessionTable.workspace_id })
        .from(SessionTable)
        .where(eq(SessionTable.id, parentSessionID))
        .get()
        .pipe(Effect.orDie)
      if (!session) return yield* new InvalidRequestError({ message: "Parent Session not found" })
      if (
        session.directory !== decodeURIComponent(route.directory) ||
        session.workspaceID !== (route.workspaceID ?? null)
      ) {
        return yield* new InvalidRequestError({ message: "Delegation does not belong to this Location" })
      }
      return session
    })
    const state = Effect.fn("LegacyDelegationHttp.state")(function* (id: Parameters<typeof service.foldState>[0]) {
      yield* enabled()
      const value = yield* service.foldState(id).pipe(Effect.mapError(apiError))
      if (!value) return yield* new InvalidRequestError({ message: `Delegation not found: ${id}` })
      yield* requireParentOwned(value.delegation.parentSessionID)
      return view(value)
    })
    const mutate = <A>(delegationID: Parameters<typeof service.foldState>[0], effect: Effect.Effect<A, ServiceError>) =>
      Effect.gen(function* () {
        yield* state(delegationID)
        return yield* effect.pipe(Effect.mapError(apiError))
      })
    return handlers
      .handle("list", (ctx) =>
        Effect.gen(function* () {
          yield* enabled()
          const items = yield* service.list(ctx.query).pipe(Effect.mapError(apiError))
          const visible = []
          for (const item of items) {
            const projected = yield* state(item.delegation.id)
            if (ctx.query.includeArchived || !projected.softExpired) visible.push(projected)
          }
          return visible
        }),
      )
      .handle("create", (ctx) =>
        Effect.gen(function* () {
          yield* enabled()
          yield* requireParentOwned(ctx.payload.parentSessionID)
          const item = yield* service.create(ctx.payload).pipe(Effect.mapError(apiError))
          return yield* state(item.id)
        }),
      )
      .handle("get", (ctx) => state(ctx.params.delegationID))
      .handle("addParticipant", (ctx) =>
        mutate(
          ctx.params.delegationID,
          service.addParticipant({ delegationID: ctx.params.delegationID, ...ctx.payload }),
        ),
      )
      .handle("listTurns", (ctx) => mutate(ctx.params.delegationID, service.listTurns(ctx.params.delegationID)))
      .handle("appendTurn", (ctx) =>
        mutate(
          ctx.params.delegationID,
          service.appendTurn({
            delegationID: ctx.params.delegationID,
            ...ctx.payload,
            origin: {
              deliveryOrigin: ctx.payload.deliveryOrigin,
              senderParticipantID: ctx.payload.senderParticipantID,
            },
          }),
        ),
      )
      .handle("retry", (ctx) =>
        mutate(
          ctx.params.delegationID,
          service.retry({ ...ctx.params, participantID: ctx.payload.participantID }),
        ).pipe(Effect.andThen(execution.wake(ctx.params.delegationID)), Effect.andThen(state(ctx.params.delegationID))),
      )
      .handle("reconcile", (ctx) =>
        Effect.gen(function* () {
          yield* state(ctx.params.delegationID)
          if (ctx.payload.decision === "close") {
            yield* execution
              .close({ delegationID: ctx.params.delegationID, reason: "Reconciliation decision" })
              .pipe(Effect.mapError(apiError))
          } else if (ctx.payload.decision === "fork") {
            const forked = yield* mutate(
              ctx.params.delegationID,
              service.fork({ delegationID: ctx.params.delegationID }),
            )
            return view(forked)
          } else if (ctx.payload.decision === "retry") {
            if (!ctx.payload.turnID || !ctx.payload.participantID) {
              return yield* new InvalidRequestError({
                message: "Retry reconciliation requires turnID and participantID",
              })
            }
            yield* mutate(
              ctx.params.delegationID,
              service.retry({
                delegationID: ctx.params.delegationID,
                turnID: ctx.payload.turnID,
                participantID: ctx.payload.participantID,
              }),
            )
            yield* execution.wake(ctx.params.delegationID)
          } else {
            const resumed = yield* mutate(
              ctx.params.delegationID,
              service.reconcileResume({ delegationID: ctx.params.delegationID }),
            )
            if (resumed > 0) yield* execution.wake(ctx.params.delegationID)
            // Deliveries without a provable idempotent-resume contract are left
            // recovery_required; settle them only when the operator explicitly
            // asks to give up (decision "close") rather than silently failing
            // them on a "resume" request.
          }
          return yield* state(ctx.params.delegationID)
        }),
      )
      .handle("retractRejection", (ctx) =>
        mutate(
          ctx.params.delegationID,
          service.retractRejection({ delegationID: ctx.params.delegationID, ...ctx.payload }),
        ).pipe(Effect.andThen(state(ctx.params.delegationID))),
      )
      .handle("steer", (ctx) =>
        Effect.gen(function* () {
          yield* state(ctx.params.delegationID)
          const current = yield* service.foldState(ctx.params.delegationID).pipe(Effect.mapError(apiError))
          const turn = current?.turns.get(ctx.payload.turnID)
          if (!turn?.participantIDs.includes(ctx.payload.participantID)) {
            return yield* new InvalidRequestError({ message: "Turn participant is not admitted" })
          }
          yield* execution.wake(ctx.params.delegationID)
          return yield* state(ctx.params.delegationID)
        }),
      )
      .handle("interrupt", (ctx) =>
        Effect.gen(function* () {
          yield* state(ctx.params.delegationID)
          yield* execution.interrupt(ctx.params.delegationID, ctx.payload.participantID).pipe(Effect.mapError(apiError))
          return yield* state(ctx.params.delegationID)
        }),
      )
      .handle("complete", (ctx) =>
        mutate(
          ctx.params.delegationID,
          service.complete({ delegationID: ctx.params.delegationID, summary: ctx.payload.summary }),
        ).pipe(Effect.andThen(state(ctx.params.delegationID))),
      )
      .handle("close", (ctx) =>
        Effect.gen(function* () {
          yield* state(ctx.params.delegationID)
          yield* execution
            .close({ delegationID: ctx.params.delegationID, reason: ctx.payload.reason })
            .pipe(Effect.mapError(apiError))
          return yield* state(ctx.params.delegationID)
        }),
      )
      .handle("archive", (ctx) =>
        mutate(ctx.params.delegationID, service.archive({ delegationID: ctx.params.delegationID })).pipe(
          Effect.andThen(state(ctx.params.delegationID)),
        ),
      )
      .handle("unarchive", (ctx) =>
        mutate(ctx.params.delegationID, service.unarchive({ delegationID: ctx.params.delegationID })).pipe(
          Effect.andThen(state(ctx.params.delegationID)),
        ),
      )
      .handle("fork", (ctx) =>
        mutate(
          ctx.params.delegationID,
          service.fork({
            delegationID: ctx.params.delegationID,
            title: ctx.payload.title,
            reason: ctx.payload.reason,
          }),
        ).pipe(Effect.map(view)),
      )
      .handle("delete", (ctx) =>
        Effect.gen(function* () {
          const current = yield* service.foldState(ctx.params.delegationID).pipe(Effect.mapError(apiError))
          if (current) yield* state(ctx.params.delegationID)
          return yield* service
            .delete({ delegationID: ctx.params.delegationID, purge: ctx.query.purge })
            .pipe(Effect.mapError(apiError))
        }),
      )
  }),
)

export const delegationHandlers = delegationHandlerLayer.pipe(
  Layer.provide(DelegationExecution.defaultLayer),
  Layer.provide(DelegationService.defaultLayer),
  Layer.provide(SessionV2.defaultLayer),
)
