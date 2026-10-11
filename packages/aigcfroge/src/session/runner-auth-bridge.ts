import { Effect } from "effect"
import { Auth } from "@/auth"
import { Credential } from "@aigcfroge/core/credential"
import { register } from "@aigcfroge/core/session/runner/auth-seam"
import { Location } from "@aigcfroge/core/location"
import { ProviderV2 } from "@aigcfroge/core/provider"
import { Provider } from "@/provider/provider"
import { InstanceStore } from "@/project/instance-store"
import { WorkspaceRef } from "@/effect/instance-ref"
import { EffectBridge } from "@/effect/bridge"

/** Install the existing auth.json resolver at the application composition root. */
export function installSessionRunnerAuthBridge(): void {
  register((providerID, location) =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const info = yield* auth.get(providerID).pipe(Effect.orDie)
      if (!info) return undefined
      if (info.type === "api" || info.type === "wellknown") {
        return {
          credential: Credential.Key.make({
            type: "key",
            key: info.key,
            metadata: info.type === "api" ? info.metadata : undefined,
          }),
        }
      }
      if (!location) return yield* Effect.die(new Error("OAuth model resolution requires a Session Location"))
      const { AppRuntime } = yield* Effect.promise(() => import("@/effect/app-runtime"))
      return yield* Effect.promise((signal) =>
        AppRuntime.runPromise(resolveTransport(providerID, location), { signal }),
      )
    }).pipe(Effect.provide(Auth.defaultLayer)),
  )
}

/** Reuse the plugin's refresh owner and route rewriting inside the Session's instance. */
export const resolveTransport = Effect.fn("SessionRunnerAuth.resolveTransport")(function* (
  providerID: string,
  location: Location.Ref,
) {
  const instances = yield* InstanceStore.Service
  return yield* instances
    .provide(
      { directory: location.directory },
      Effect.gen(function* () {
        const providers = yield* Provider.Service
        const provider = yield* providers.getProvider(ProviderV2.ID.make(providerID))
        const transport: unknown = provider?.options.fetch
        if (typeof transport !== "function")
          return yield* Effect.die(new Error(`OAuth transport unavailable for provider ${providerID}`))
        const bridge = yield* EffectBridge.make()
        const fetch = bridge.bind(async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
          const response: unknown = await transport(input, init)
          if (!(response instanceof Response)) throw new Error("Provider transport returned an invalid response")
          return response
        })
        return { fetch }
      }),
    )
    .pipe(Effect.provideService(WorkspaceRef, location.workspaceID))
})
