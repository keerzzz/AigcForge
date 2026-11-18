import { Provider } from "@aigcfroge/core/provider"
import { ProviderDefinition } from "@aigcfroge/core/provider/definition"
import { ProviderDiscovery } from "@aigcfroge/core/provider/discovery"
import { ModelSource } from "@aigcfroge/schema/model-source"
import { InvalidRequestError, ProviderNotFoundError, ServiceUnavailableError } from "@aigcfroge/protocol/errors"
import { Effect, Schema } from "effect"
import { HttpServerRequest } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { awaitPlugins, response } from "../location"

export const ProviderHandler = HttpApiBuilder.group(Api, "server.provider", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "provider.list",
        Effect.fn(function* () {
          const providers = yield* Provider.Service
          return yield* response(providers.available())
        }),
      )
      .handle(
        "provider.discovery.get",
        Effect.fn(function* (ctx) {
          yield* awaitPlugins
          const query = new URL((yield* HttpServerRequest.HttpServerRequest).url, "http://localhost").searchParams
          // ParsedSearchParams keeps bracket keys flat while the client emits deepObject.
          const connection = Array.from(query.keys()).some((key) => key.startsWith("connection["))
            ? yield* Schema.decodeUnknownEffect(ModelSource.ConnectionRef)({
              type: query.get("connection[type]"),
              id: query.get("connection[id]") ?? undefined,
              name: query.get("connection[name]") ?? undefined,
            }).pipe(Effect.mapError(() => new InvalidRequestError({ message: "Invalid provider connection in query parameters", field: "connection" })))
            : ctx.query.connection
          const discovery = yield* ProviderDiscovery.Service
          return yield* response(discovery.get({ ...ctx.query, connection }).pipe(Effect.mapError((error) =>
            error._tag === "ProviderDiscovery.Invalid" || error._tag === "ConfigProviderFile.Conflict" || error._tag === "ConfigProviderFile.InvalidTarget"
              ? new InvalidRequestError({ message: error.message, kind: error._tag })
              : new ServiceUnavailableError({ message: error.message, service: "provider.discovery" }),
          )))
        }),
      )
      .handle(
        "provider.discovery.preview",
        Effect.fn(function* (ctx) {
          yield* awaitPlugins
          const discovery = yield* ProviderDiscovery.Service
          return yield* response(discovery.preview(ctx.payload).pipe(Effect.mapError((error) =>
            error._tag === "ProviderDiscovery.Invalid" || error._tag === "ConfigProviderFile.Conflict" || error._tag === "ConfigProviderFile.InvalidTarget"
              ? new InvalidRequestError({ message: error.message, kind: error._tag })
              : new ServiceUnavailableError({ message: error.message, service: "provider.discovery" }),
          )))
        }),
      )
      .handle(
        "provider.discovery.refresh",
        Effect.fn(function* (ctx) {
          yield* awaitPlugins
          const discovery = yield* ProviderDiscovery.Service
          return yield* response(discovery.refresh(ctx.payload).pipe(Effect.mapError((error) =>
            error._tag === "ProviderDiscovery.Invalid" || error._tag === "ConfigProviderFile.Conflict" || error._tag === "ConfigProviderFile.InvalidTarget"
              ? new InvalidRequestError({ message: error.message, kind: error._tag })
              : new ServiceUnavailableError({ message: error.message, service: "provider.discovery" }),
          )))
        }),
      )
      .handle(
        "provider.definition.get",
        Effect.fn(function* (ctx) {
          return yield* response(ProviderDefinition.get(ctx.query.providerID).pipe(Effect.mapError((error) =>
            new ServiceUnavailableError({ message: error.message, service: "provider.definition" }),
          )))
        }),
      )
      .handle(
        "provider.definition.save",
        Effect.fn(function* (ctx) {
          yield* awaitPlugins
          return yield* response(ProviderDefinition.save(ctx.payload).pipe(Effect.mapError((error) =>
            error._tag === "ConfigProviderFile.InvalidTarget"
              ? new InvalidRequestError({ message: error.message, kind: error._tag })
              : new ServiceUnavailableError({ message: error.message, service: "provider.definition" }),
          )))
        }),
      )
      .handle(
        "provider.definition.remove",
        Effect.fn(function* (ctx) {
          yield* awaitPlugins
          return yield* response(ProviderDefinition.remove(ctx.payload).pipe(Effect.mapError((error) =>
            error._tag === "ConfigProviderFile.InvalidTarget"
              ? new InvalidRequestError({ message: error.message, kind: error._tag })
              : new ServiceUnavailableError({ message: error.message, service: "provider.definition" }),
          )))
        }),
      )
      .handle(
        "provider.get",
        Effect.fn(function* (ctx) {
          const providers = yield* Provider.Service
          const provider = yield* providers.get(ctx.params.providerID)
          if (!provider)
            return yield* new ProviderNotFoundError({
              providerID: ctx.params.providerID,
              message: `Provider not found: ${ctx.params.providerID}`,
            })
          return yield* response(Effect.succeed(provider))
        }),
      )
  }),
)
