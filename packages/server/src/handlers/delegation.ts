import { Delegation } from "@aigcfroge/schema/delegation"
import { DelegationID } from "@aigcfroge/schema/delegation-id"
import { SessionID } from "@aigcfroge/schema/session-id"
import { DelegationExecution } from "@aigcfroge/core/delegation/execution"
import { DelegationPresentation } from "@aigcfroge/core/delegation/presentation"
import { DelegationService, type ServiceError } from "@aigcfroge/core/delegation/service"
import { Location } from "@aigcfroge/core/location"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { Database } from "@aigcfroge/core/database/database"
import { Flag } from "@aigcfroge/core/flag/flag"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ConflictError, ForbiddenError, InvalidRequestError, SessionNotFoundError } from "../errors"

const view = DelegationPresentation.view

function domainError(error: ServiceError) {
  if (error instanceof Delegation.DelegationParentSessionNotFoundError) {
    return new SessionNotFoundError({ sessionID: error.parentSessionID, message: error.message })
  }
  if (error instanceof Delegation.DelegationNotFoundError) {
    return new InvalidRequestError({ message: error.message, field: "delegationID" })
  }
  return new ConflictError({
    resource: "delegationID" in error ? error.delegationID : undefined,
    message: error instanceof Error ? error.message : String(error),
  })
}

export const DelegationHandler = HttpApiBuilder.group(Api, "server.delegation", (handlers) =>
  Effect.gen(function* () {
    const service = yield* DelegationService.Service
    const execution = yield* DelegationExecution.Service
    const { db } = yield* Database.Service
    const enabled = () =>
      Flag.AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS
        ? Effect.void
        : Effect.fail(new ForbiddenError({ message: "Persistent delegations are disabled" }))

    const requireParentOwned = Effect.fn("DelegationHttp.requireParentOwned")(function* (
      parentSessionID: SessionID.ID,
    ) {
      const location = yield* Location.Service
      const session = yield* db
        .select({ directory: SessionTable.directory, workspaceID: SessionTable.workspace_id })
        .from(SessionTable)
        .where(eq(SessionTable.id, parentSessionID))
        .get()
        .pipe(Effect.orDie)
      if (!session) {
        return yield* new SessionNotFoundError({ sessionID: parentSessionID, message: "Parent Session not found" })
      }
      if (session.directory !== location.directory || session.workspaceID !== (location.workspaceID ?? null)) {
        return yield* new ForbiddenError({ message: "Delegation does not belong to this Location" })
      }
      return session
    })

    const owned = Effect.fn("DelegationHttp.owned")(function* (delegationID: DelegationID.ID) {
      yield* enabled()
      const state = yield* service.foldState(delegationID).pipe(Effect.mapError(domainError))
      if (!state) return yield* new InvalidRequestError({ message: "Delegation not found", field: "delegationID" })
      yield* requireParentOwned(state.delegation.parentSessionID)
      return state
    })

    const stateAfter = Effect.fn("DelegationHttp.stateAfter")(function* (delegationID: DelegationID.ID) {
      return view(yield* owned(delegationID))
    })

    const mutate = <A>(delegationID: DelegationID.ID, command: Effect.Effect<A, ServiceError>) =>
      Effect.gen(function* () {
        yield* owned(delegationID)
        return yield* command.pipe(Effect.mapError(domainError))
      })

    return handlers
      .handle("delegation.list", (ctx) =>
        Effect.gen(function* () {
          yield* enabled()
          const states = yield* service.list(ctx.query).pipe(Effect.mapError(domainError))
          const visible = []
          for (const state of states) {
            yield* owned(state.delegation.id)
            const item = view(state)
            if (ctx.query.includeArchived || !item.softExpired) visible.push(item)
          }
          return visible
        }),
      )
      .handle("delegation.create", (ctx) =>
        Effect.gen(function* () {
          yield* enabled()
          yield* requireParentOwned(ctx.payload.parentSessionID)
          const item = yield* service.create(ctx.payload).pipe(Effect.mapError(domainError))
          return yield* stateAfter(item.id)
        }),
      )
      .handle("delegation.get", (ctx) => stateAfter(ctx.params.delegationID))
      .handle("delegation.addParticipant", (ctx) =>
        mutate(
          ctx.params.delegationID,
          service.addParticipant({ delegationID: ctx.params.delegationID, ...ctx.payload }),
        ),
      )
      .handle("delegation.listTurns", (ctx) =>
        mutate(ctx.params.delegationID, service.listTurns(ctx.params.delegationID)),
      )
      .handle("delegation.appendTurn", (ctx) =>
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
      .handle("delegation.retry", (ctx) =>
        Effect.gen(function* () {
          yield* mutate(
            ctx.params.delegationID,
            service.retry({ ...ctx.params, participantID: ctx.payload.participantID }),
          )
          yield* execution.wake(ctx.params.delegationID)
          return yield* stateAfter(ctx.params.delegationID)
        }),
      )
      .handle("delegation.reconcile", (ctx) =>
        Effect.gen(function* () {
          yield* owned(ctx.params.delegationID)
          if (ctx.payload.decision === "close") {
            yield* execution
              .close({ delegationID: ctx.params.delegationID, reason: "Reconciliation decision" })
              .pipe(Effect.mapError((error) => new ConflictError({ message: String(error) })))
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
          return yield* stateAfter(ctx.params.delegationID)
        }),
      )
      .handle("delegation.retractRejection", (ctx) =>
        mutate(
          ctx.params.delegationID,
          service.retractRejection({ delegationID: ctx.params.delegationID, ...ctx.payload }),
        ).pipe(Effect.andThen(stateAfter(ctx.params.delegationID))),
      )
      .handle("delegation.steer", (ctx) =>
        Effect.gen(function* () {
          const current = yield* owned(ctx.params.delegationID)
          const turn = current.turns.get(ctx.payload.turnID)
          if (!turn?.participantIDs.includes(ctx.payload.participantID)) {
            return yield* new InvalidRequestError({ message: "Turn participant is not admitted" })
          }
          yield* execution.wake(ctx.params.delegationID)
          return yield* stateAfter(ctx.params.delegationID)
        }),
      )
      .handle("delegation.interrupt", (ctx) =>
        Effect.gen(function* () {
          yield* owned(ctx.params.delegationID)
          yield* execution
            .interrupt(ctx.params.delegationID, ctx.payload.participantID)
            .pipe(Effect.mapError((error) => new ConflictError({ message: String(error) })))
          return yield* stateAfter(ctx.params.delegationID)
        }),
      )
      .handle("delegation.complete", (ctx) =>
        mutate(
          ctx.params.delegationID,
          service.complete({ delegationID: ctx.params.delegationID, ...ctx.payload }),
        ).pipe(Effect.andThen(stateAfter(ctx.params.delegationID))),
      )
      .handle("delegation.close", (ctx) =>
        Effect.gen(function* () {
          yield* owned(ctx.params.delegationID)
          yield* execution
            .close({ delegationID: ctx.params.delegationID, ...ctx.payload })
            .pipe(Effect.mapError((error) => new ConflictError({ message: String(error) })))
          return yield* stateAfter(ctx.params.delegationID)
        }),
      )
      .handle("delegation.archive", (ctx) =>
        mutate(ctx.params.delegationID, service.archive(ctx.params)).pipe(
          Effect.andThen(stateAfter(ctx.params.delegationID)),
        ),
      )
      .handle("delegation.unarchive", (ctx) =>
        mutate(ctx.params.delegationID, service.unarchive(ctx.params)).pipe(
          Effect.andThen(stateAfter(ctx.params.delegationID)),
        ),
      )
      .handle("delegation.fork", (ctx) =>
        mutate(ctx.params.delegationID, service.fork({ delegationID: ctx.params.delegationID, ...ctx.payload })).pipe(
          Effect.map(view),
        ),
      )
      .handle("delegation.delete", (ctx) =>
        mutate(
          ctx.params.delegationID,
          service.delete({ delegationID: ctx.params.delegationID, purge: ctx.query.purge }),
        ).pipe(Effect.as(HttpApiSchema.NoContent.make())),
      )
  }),
)
