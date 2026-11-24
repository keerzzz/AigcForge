import { InvalidRequestError } from "@omnixa/protocol/errors"
import { HttpApiBuilder } from "effect/http-api"
import { Effect } from "effect"
import { Api } from "../api"

/**
 * R1b transitional stub (workspace mirror): contract is live and the client is
 * generated; handlers arrive with the R2 control-plane port. Fail closed with
 * kind "not_implemented"; deleted as the R2 slice lands.
 */
const failClosed = (group: string, name: string) =>
  Effect.fail(
    new InvalidRequestError({
      message: `${group}.${name} is not implemented until the R2 control-plane port`,
      kind: "not_implemented",
    }),
  )

export const WorkspaceInstanceHandler = HttpApiBuilder.group(Api, "workspace-instance", (handlers) =>
  handlers
    .handle("workspace-instance.adapters", () => failClosed("workspace-instance", "adapters"))
    .handle("workspace-instance.list", () => failClosed("workspace-instance", "list"))
    .handle("workspace-instance.create", () => failClosed("workspace-instance", "create"))
    .handle("workspace-instance.syncList", () => failClosed("workspace-instance", "syncList"))
    .handle("workspace-instance.status", () => failClosed("workspace-instance", "status"))
    .handle("workspace-instance.remove", () => failClosed("workspace-instance", "remove"))
    .handle("workspace-instance.warp", () => failClosed("workspace-instance", "warp")),
)
