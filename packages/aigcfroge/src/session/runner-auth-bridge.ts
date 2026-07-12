import { Effect } from "effect"
import { Auth } from "@/auth"
import { Credential } from "@aigcfroge/core/credential"
import { register } from "@aigcfroge/core/session/runner/auth-seam"

/**
 * Bridges aigcfroge `Auth.Service` (auth.json provider API keys) into the V2
 * `SessionRunnerModel` credential resolution via the `SessionRunnerAuth` seam.
 *
 * Call `installSessionRunnerAuthBridge()` once at server startup (composition
 * root). The installed resolver runs inside the V2 runner's drain context,
 * which inherits `Auth.Service` from the app group, so `yield* Auth.Service`
 * resolves correctly.
 *
 * Without this bridge, V2 `SessionRunnerModel.resolve` only checks core
 * `Integration.Service` (DB CredentialTable) and never sees auth.json keys,
 * so the LLM request goes out with `Auth.none` -> 401 API_KEY_REQUIRED.
 */
export function installSessionRunnerAuthBridge(): void {
  register((providerID) =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const info = yield* auth.get(providerID).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!info) return undefined
      // Auth.Api / Auth.WellKnown carry a `key` string -> Credential.Key.
      // OAuth (Auth.Oauth) lacks methodID/expires required by Credential.OAuth,
      // so it is not bridged here; OAuth providers must use core Integration.
      if (info.type === "api" || info.type === "wellknown") {
        return Credential.Key.make({ type: "key", key: info.key })
      }
      return undefined
    }),
  )
}
