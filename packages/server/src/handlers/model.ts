import { Model } from "@aigcfroge/core/model"
import { ModelGroup } from "@aigcfroge/core/model-group"
import { InvalidRequestError, ServiceUnavailableError } from "@aigcfroge/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { awaitPlugins, response } from "../location"

export const ModelHandler = HttpApiBuilder.group(Api, "server.model", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "model.group.definition.get",
        Effect.fn(function* (ctx) {
          yield* awaitPlugins
          const groups = yield* ModelGroup.Service
          const models = yield* Model.Service
          return yield* response(Effect.gen(function* () {
            const read = yield* groups.get(ctx.query.groupID).pipe(Effect.mapError((error) =>
              new ServiceUnavailableError({ service: "model.group.definition", message: error.message }),
            ))
            return new ModelGroup.Read({ ...read, defaultSelection: yield* models.selection() })
          }))
        }),
      )
      .handle(
        "model.group.definition.save",
        Effect.fn(function* (ctx) {
          yield* awaitPlugins
          const groups = yield* ModelGroup.Service
          return yield* response(groups.save(ctx.payload).pipe(Effect.mapError((error) =>
            error._tag === "ConfigProviderFile.InvalidTarget"
              ? new InvalidRequestError({ message: error.message, field: "target" })
              : new ServiceUnavailableError({ service: "model.group.definition", message: error.message }),
          )))
        }),
      )
      .handle(
        "model.group.definition.remove",
        Effect.fn(function* (ctx) {
          yield* awaitPlugins
          const groups = yield* ModelGroup.Service
          return yield* response(groups.remove(ctx.payload).pipe(Effect.mapError((error) =>
            error._tag === "ConfigProviderFile.InvalidTarget"
              ? new InvalidRequestError({ message: error.message, field: "target" })
              : new ServiceUnavailableError({ service: "model.group.definition", message: error.message }),
          )))
        }),
      )
      .handle(
        "model.list",
        Effect.fn(function* () {
          yield* awaitPlugins
          const models = yield* Model.Service
          return yield* response(models.available())
        }),
      )
      .handle(
        "model.default",
        Effect.fn(function* () {
          yield* awaitPlugins
          const models = yield* Model.Service
          return yield* response(models.default().pipe(Effect.catchTag("ModelGroup.Unavailable", (error) =>
            Effect.fail(new ServiceUnavailableError({ service: "model.group", message: error.message })),
          )))
        }),
      )
  }),
)
