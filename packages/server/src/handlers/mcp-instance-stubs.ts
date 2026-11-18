import { InvalidRequestError } from "@aigcfroge/protocol/errors"
import { HttpApiBuilder } from "effect/http-api"
import { Effect } from "effect"
import { Api } from "../api"

/**
 * R1b transitional stub (mcp mirror): contract is live and the client is
 * generated; handlers arrive with the R2 mcp port. Fail closed with kind
 * "not_implemented"; deleted as the R2 slice lands.
 */
const failClosed = (group: string, name: string) =>
  Effect.fail(
    new InvalidRequestError({
      message: `${group}.${name} is not implemented until the R2 mcp port`,
      kind: "not_implemented",
    }),
  )

export const McpInstanceHandler = HttpApiBuilder.group(Api, "mcp-instance", (handlers) =>
  handlers
    .handle("mcp-instance.status", () => failClosed("mcp-instance", "status"))
    .handle("mcp-instance.add", () => failClosed("mcp-instance", "add"))
    .handle("mcp-instance.authStart", () => failClosed("mcp-instance", "authStart"))
    .handle("mcp-instance.authCallback", () => failClosed("mcp-instance", "authCallback"))
    .handle("mcp-instance.authAuthenticate", () => failClosed("mcp-instance", "authAuthenticate"))
    .handle("mcp-instance.authRemove", () => failClosed("mcp-instance", "authRemove"))
    .handle("mcp-instance.connect", () => failClosed("mcp-instance", "connect"))
    .handle("mcp-instance.disconnect", () => failClosed("mcp-instance", "disconnect")),
)
