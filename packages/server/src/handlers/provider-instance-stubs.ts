import { InvalidRequestError } from "@aigcfroge/protocol/errors"
import { HttpApiBuilder } from "effect/http-api"
import { Effect } from "effect"
import { Api } from "../api"

/**
 * R1b transitional stub (provider mirror): contract is live and the client is
 * generated; handlers arrive with the R2 provider port. Fail closed with kind
 * "not_implemented"; deleted as the R2 slice lands.
 */
const failClosed = (group: string, name: string) =>
  Effect.fail(
    new InvalidRequestError({
      message: `${group}.${name} is not implemented until the R2 provider port`,
      kind: "not_implemented",
    }),
  )

export const ProviderInstanceHandler = HttpApiBuilder.group(Api, "provider-instance", (handlers) =>
  handlers
    .handle("provider-instance.list", () => failClosed("provider-instance", "list"))
    .handle("provider-instance.auth", () => failClosed("provider-instance", "auth"))
    .handle("provider-instance.authorize", () => failClosed("provider-instance", "authorize"))
    .handle("provider-instance.callback", () => failClosed("provider-instance", "callback"))
    .handle("provider-instance.discover", () => failClosed("provider-instance", "discover")),
)
