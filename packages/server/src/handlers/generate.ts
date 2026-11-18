import { Generate } from "@aigcfroge/core/generate"
import { Location } from "@aigcfroge/core/location"
import { LocationServiceMap } from "@aigcfroge/core/location-services"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { InvalidRequestError, ServiceUnavailableError } from "@aigcfroge/protocol/errors"
import { Global } from "@aigcfroge/util/global"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { awaitPlugins, locationErrors } from "../location"

export const GenerateHandler = HttpApiBuilder.group(Api, "server.generate", (handlers) =>
  Effect.gen(function* () {
    const global = yield* Global.Service
    const locations = yield* LocationServiceMap.Service
    const services = locations.get(Location.Ref.make({ directory: AbsolutePath.make(global.config) }))
    return handlers.handle(
      "generate.text",
      Effect.fn("server.generate.text")(
        function* (request) {
          yield* awaitPlugins
          const generate = yield* Generate.Service
          const text = yield* generate
            .text(request.payload)
            .pipe(
              Effect.mapError((error) =>
                error._tag === "Generate.ModelSelectionError"
                  ? new InvalidRequestError({ message: error.message })
                  : new ServiceUnavailableError({ message: error.message, service: error.service }),
              ),
            )
          return { data: { text } }
        },
        Effect.provide(services),
        locationErrors,
      ),
    )
  }),
)
