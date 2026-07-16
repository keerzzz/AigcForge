import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Catalog } from "@aigcfroge/core/catalog"
import { Integration } from "@aigcfroge/core/integration"
import { Credential } from "@aigcfroge/core/credential"
import { EventV2 } from "@aigcfroge/core/event"
import { Flag } from "@aigcfroge/core/flag/flag"
import { Location } from "@aigcfroge/core/location"
import { ModelsDev } from "@aigcfroge/core/models-dev"
import { ModelsDevPlugin } from "@aigcfroge/core/plugin/models-dev"
import { Policy } from "@aigcfroge/core/policy"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { catalogHost, host, integrationHost } from "./host"

const events = EventV2.defaultLayer
const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make(import.meta.dir) })),
)
const policy = Policy.layer.pipe(Layer.provide(locationLayer))
const connections = Credential.defaultLayer.pipe(Layer.fresh)
const integrations = Integration.locationLayer.pipe(Layer.provide(events), Layer.provide(connections))
const catalog = Catalog.layer.pipe(
  Layer.provide(Layer.mergeAll(events, locationLayer, policy, connections, integrations)),
)
const layer = Layer.mergeAll(catalog.pipe(Layer.provide(connections)), integrations, connections, events, locationLayer)
const it = testEffect(layer)

describe("ModelsDevPlugin", () => {
  it.effect("registers key methods for providers with environment variables", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const previous = {
          path: Flag.AIGCFROGE_MODELS_PATH,
          disabled: Flag.AIGCFROGE_DISABLE_MODELS_FETCH,
        }
        Flag.AIGCFROGE_MODELS_PATH = path.join(import.meta.dir, "fixtures", "models-dev.json")
        Flag.AIGCFROGE_DISABLE_MODELS_FETCH = true
        return previous
      }),
      () =>
        Effect.gen(function* () {
          const integrations = yield* Integration.Service
          const catalog = yield* Catalog.Service
          yield* ModelsDevPlugin.effect(
            host({
              catalog: catalogHost(catalog),
              integration: integrationHost(integrations),
            }),
          )
          expect(yield* integrations.list()).toEqual([
            new Integration.Info({
              id: Integration.ID.make("acme"),
              name: "Acme",
              methods: [
                { type: "key" },
                {
                  type: "env",
                  names: ["ACME_API_KEY"],
                },
              ],
              connections: [],
            }),
          ])
        }).pipe(Effect.provide(ModelsDev.defaultLayer)),
      (previous) =>
        Effect.sync(() => {
          Flag.AIGCFROGE_MODELS_PATH = previous.path
          Flag.AIGCFROGE_DISABLE_MODELS_FETCH = previous.disabled
        }),
    ),
  )
})
