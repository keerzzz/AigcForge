import { InvalidRequestError } from "@omnixa/protocol/errors"
import { HttpApiBuilder } from "effect/http-api"
import { Effect } from "effect"
import { Api } from "../api"

/**
 * R1b transitional stub (config mirror): contract is live and the client is
 * generated; handlers arrive with the R2 config port. Fail closed with kind
 * "not_implemented"; deleted as the R2 slice lands.
 */
const failClosed = (group: string, name: string) =>
  Effect.fail(
    new InvalidRequestError({
      message: `${group}.${name} is not implemented until the R2 config port`,
      kind: "not_implemented",
    }),
  )

export const ConfigInstanceHandler = HttpApiBuilder.group(Api, "config-instance", (handlers) =>
  handlers
    .handle("config-instance.get", () => failClosed("config-instance", "get"))
    .handle("config-instance.update", () => failClosed("config-instance", "update"))
    .handle("config-instance.providers", () => failClosed("config-instance", "providers")),
)
