import { Bus } from "@omnixa/core/bus"
import { DelegationPresentation } from "@omnixa/core/delegation/presentation"
import { DelegationService } from "@omnixa/core/delegation/service"
import { DelegationExecution } from "@omnixa/core/delegation/execution"
import { Flag } from "@omnixa/core/flag/flag"
import { Session } from "@omnixa/core/session"
import { InvalidRequestError } from "@omnixa/protocol/errors"
import { WorkspaceRouteContext } from "@omnixa/protocol/middleware/workspace-routing"
import { DateTime, Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { locationRefForRoute } from "../middleware/workspace-routing"

export const DelegationHandler = HttpApiBuilder.group(Api, "delegation", (handlers) =>
  Effect.gen(function* () {
    const service = yield* DelegationService.Service
    const execution = yield* DelegationExecution.Service
    const sessions = yield* Session.Service
    const bus = yield* Bus.Service
    const enabled = Effect.suspend(() => {
      if (!Flag.OMNIXA_EXPERIMENTAL_PERSISTENT_DELEGATIONS)
        return new InvalidRequestError({ message: "Persistent delegations are disabled", kind: "disabled" })
      if (!bus.retainsEvents)
        return new InvalidRequestError({
          message: "Persistent delegations require retained Bus events",
          kind: "persistence_required",
        })
      return Effect.void
    })
    const parentVisible = Effect.fn("DelegationHttp.parentVisible")(function* (parentSessionID: Session.ID) {
      const route = locationRefForRoute(yield* WorkspaceRouteContext)
      const session = yield* sessions
        .get(parentSessionID)
        .pipe(Effect.mapError(() => new InvalidRequestError({ message: "Parent Session not found" })))
      const owner = locationRefForRoute(session.location)
      return owner.directory === route.directory && owner.workspaceID === route.workspaceID
    })
    const requireParentOwned = Effect.fn("DelegationHttp.requireParentOwned")(function* (parentSessionID: Session.ID) {
      if (!(yield* parentVisible(parentSessionID)))
        return yield* new InvalidRequestError({ message: "Delegation does not belong to this Location" })
    })
    const state = Effect.fn("DelegationHttp.state")(function* (id: Parameters<typeof service.foldState>[0]) {
      yield* enabled
      const value = yield* service.foldState(id).pipe(Effect.mapError(apiError))
      if (!value) return yield* new InvalidRequestError({ message: `Delegation not found: ${id}` })
      yield* requireParentOwned(value.delegation.parentSessionID)
      return {
        ...DelegationPresentation.view(value, (yield* DateTime.nowAsDate).getTime()),
        deliveries: yield* execution.readSources(id).pipe(Effect.mapError(apiError)),
      }
    })
    const owned = <A, E extends { readonly message: string }, R>(
      delegationID: Parameters<typeof service.foldState>[0],
      effect: Effect.Effect<A, E, R>,
    ) => state(delegationID).pipe(Effect.andThen(effect), Effect.mapError(apiError))

    return handlers
      .handle("delegation.list", ({ query }) =>
        Effect.gen(function* () {
          yield* enabled
          if (query.parentSessionID) yield* requireParentOwned(query.parentSessionID)
          const items = yield* service.list(query).pipe(Effect.mapError(apiError))
          const visible = yield* Effect.filter(items, (item) => parentVisible(item.delegation.parentSessionID))
          const now = (yield* DateTime.nowAsDate).getTime()
          const views = visible
            .map((item) => DelegationPresentation.view(item, now))
            .filter((item) => query.includeArchived || !item.softExpired)
          return yield* Effect.forEach(views, (view) =>
            Effect.gen(function* () {
              return {
                ...view,
                deliveries: yield* execution.readSources(view.delegation.id).pipe(Effect.mapError(apiError)),
              }
            }),
          )
        }),
      )
      .handle("delegation.create", ({ payload }) =>
        Effect.gen(function* () {
          yield* enabled
          yield* requireParentOwned(payload.parentSessionID)
          return yield* service.create(payload).pipe(
            Effect.mapError(apiError),
            Effect.flatMap((item) => state(item.id)),
          )
        }),
      )
      .handle("delegation.get", ({ params }) => state(params.delegationID))
      .handle("delegation.result", ({ params, query }) =>
        owned(
          params.delegationID,
          execution.readResult({
            ...params,
            attempt: query.attempt,
            deliveryOrigin: query.deliveryOrigin,
            senderParticipantID: query.senderParticipantID,
          }),
        ),
      )
      .handle("delegation.addParticipant", ({ params, payload }) =>
        owned(params.delegationID, service.addParticipant({ delegationID: params.delegationID, ...payload })),
      )
      .handle("delegation.listTurns", ({ params }) =>
        owned(params.delegationID, service.listTurns(params.delegationID)),
      )
      .handle("delegation.appendTurn", ({ params, payload }) =>
        owned(
          params.delegationID,
          service
            .appendTurn({
              delegationID: params.delegationID,
              ...payload,
              origin: { deliveryOrigin: payload.deliveryOrigin, senderParticipantID: payload.senderParticipantID },
            })
            .pipe(
              Effect.tap((turn) =>
                payload.prompt === undefined
                  ? Effect.void
                  : execution.dispatch({
                      delegationID: params.delegationID,
                      turnID: turn.id,
                      prompt: payload.prompt,
                    }),
              ),
            ),
        ),
      )
      .handle("delegation.retry", ({ params, payload }) =>
        owned(
          params.delegationID,
          execution.retry({ ...params, ...payload }).pipe(Effect.andThen(state(params.delegationID))),
        ),
      )
      .handle("delegation.reconcile", ({ params, payload }) =>
        owned(
          params.delegationID,
          Effect.gen(function* () {
            if (payload.decision === "retry") {
              if (payload.turnID === undefined || payload.participantID === undefined)
                return yield* new InvalidRequestError({ message: "Retry requires turnID and participantID" })
              yield* execution.retry({
                delegationID: params.delegationID,
                turnID: payload.turnID,
                participantID: payload.participantID,
              })
              return yield* state(params.delegationID)
            }
            if (payload.decision === "close") {
              yield* execution.close({ delegationID: params.delegationID })
              return yield* state(params.delegationID)
            }
            if (payload.decision === "fork") {
              const forked = yield* service.fork({ delegationID: params.delegationID })
              return yield* state(forked.delegation.id)
            }
            yield* service.reconcileResume({ delegationID: params.delegationID })
            return yield* state(params.delegationID)
          }),
        ),
      )
      .handle("delegation.retractRejection", ({ params, payload }) =>
        owned(
          params.delegationID,
          service.retractRejection({ ...params, ...payload }).pipe(Effect.andThen(state(params.delegationID))),
        ),
      )
      .handle("delegation.steer", ({ params, payload }) =>
        owned(
          params.delegationID,
          execution.steer({ ...params, ...payload }).pipe(Effect.andThen(state(params.delegationID))),
        ),
      )
      .handle("delegation.interrupt", ({ params, payload }) =>
        owned(
          params.delegationID,
          execution
            .interrupt({ delegationID: params.delegationID, ...payload })
            .pipe(Effect.andThen(state(params.delegationID))),
        ),
      )
      .handle("delegation.complete", ({ params, payload }) =>
        owned(
          params.delegationID,
          service.complete({ ...params, ...payload }).pipe(Effect.andThen(state(params.delegationID))),
        ),
      )
      .handle("delegation.close", ({ params, payload }) =>
        owned(
          params.delegationID,
          execution.close({ ...params, ...payload }).pipe(Effect.andThen(state(params.delegationID))),
        ),
      )
      .handle("delegation.archive", ({ params }) =>
        owned(params.delegationID, service.archive(params).pipe(Effect.andThen(state(params.delegationID)))),
      )
      .handle("delegation.unarchive", ({ params }) =>
        owned(params.delegationID, service.unarchive(params).pipe(Effect.andThen(state(params.delegationID)))),
      )
      .handle("delegation.fork", ({ params, payload }) =>
        owned(
          params.delegationID,
          service.fork({ ...params, ...payload }).pipe(Effect.flatMap((forked) => state(forked.delegation.id))),
        ),
      )
      .handle("delegation.delete", ({ params, query }) =>
        owned(
          params.delegationID,
          Effect.gen(function* () {
            if (!query.purge)
              return yield* new InvalidRequestError({ message: "Explicit purge is required to delete delegation" })
            yield* execution.close(params)
            yield* service.delete({ ...params, purge: true })
          }),
        ),
      )
  }),
)

function apiError(error: { readonly message: string }) {
  if (error instanceof InvalidRequestError) return error
  return new InvalidRequestError({ message: error.message })
}
