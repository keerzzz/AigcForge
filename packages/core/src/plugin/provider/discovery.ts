export * as ProviderDiscoveryPlugin from "./discovery.js"

import { define } from "@aigcfroge/plugin/effect/plugin"
import { Effect, Stream } from "effect"
import { ProviderDiscovery } from "../../provider/discovery.js"

export const Plugin = define({
  id: "aigcfroge.provider.discovery",
  effect: Effect.fn(function* (ctx) {
    const discovery = yield* ProviderDiscovery.Service
    yield* discovery.start()
    yield* ctx.event.subscribe().pipe(
      Stream.filter(
        (event) =>
          event.type === "config.updated" ||
          event.type === "credential.updated" ||
          event.type === "credential.switched" ||
          event.type === "integration.updated" ||
          event.type === "models-dev.refreshed",
      ),
      Stream.runForEach(() => discovery.sync().pipe(Effect.andThen(ctx.model.reload()))),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* discovery.sync()
  }),
})
