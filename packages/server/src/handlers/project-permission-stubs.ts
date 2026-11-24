import { InvalidRequestError } from "@omnixa/protocol/errors"
import { HttpApiBuilder } from "effect/http-api"
import { Effect } from "effect"
import { Api } from "../api"

/**
 * R1b transitional stubs (project/permission mirrors): contracts are live and
 * the client is generated; handlers arrive with the R2 port. Fail closed with
 * kind "not_implemented"; deleted as the R2 slices land implementations.
 */
const failClosed = (group: string, name: string) =>
  Effect.fail(
    new InvalidRequestError({
      message: `${group}.${name} is not implemented until the R2 project/permission port`,
      kind: "not_implemented",
    }),
  )

export const ProjectInstanceHandler = HttpApiBuilder.group(Api, "project-instance", (handlers) =>
  handlers
    .handle("project-instance.list", () => failClosed("project-instance", "list"))
    .handle("project-instance.current", () => failClosed("project-instance", "current"))
    .handle("project-instance.initGit", () => failClosed("project-instance", "initGit"))
    .handle("project-instance.update", () => failClosed("project-instance", "update"))
    .handle("project-instance.directories", () => failClosed("project-instance", "directories")),
)

export const PermissionInstanceHandler = HttpApiBuilder.group(Api, "permission-instance", (handlers) =>
  handlers
    .handle("permission-instance.list", () => failClosed("permission-instance", "list"))
    .handle("permission-instance.reply", () => failClosed("permission-instance", "reply")),
)
