import { InvalidRequestError } from "@omnixa/protocol/errors"
import { HttpApiBuilder } from "effect/http-api"
import { Effect } from "effect"
import { Api } from "../api"

/**
 * R1b transitional stub (instance mirror): contract is live and the client is
 * generated; handlers arrive with the R2 instance/vcs port. Fail closed with
 * kind "not_implemented"; deleted as the R2 slice lands.
 */
const failClosed = (group: string, name: string) =>
  Effect.fail(
    new InvalidRequestError({
      message: `${group}.${name} is not implemented until the R2 instance port`,
      kind: "not_implemented",
    }),
  )

export const InstanceInstanceHandler = HttpApiBuilder.group(Api, "instance-instance", (handlers) =>
  handlers
    .handle("instance-instance.dispose", () => failClosed("instance-instance", "dispose"))
    .handle("instance-instance.path", () => failClosed("instance-instance", "path"))
    .handle("instance-instance.vcs", () => failClosed("instance-instance", "vcs"))
    .handle("instance-instance.vcsStatus", () => failClosed("instance-instance", "vcsStatus"))
    .handle("instance-instance.vcsDiff", () => failClosed("instance-instance", "vcsDiff"))
    .handle("instance-instance.vcsDiffRaw", () => failClosed("instance-instance", "vcsDiffRaw"))
    .handle("instance-instance.vcsApply", () => failClosed("instance-instance", "vcsApply"))
    .handle("instance-instance.vcsStage", () => failClosed("instance-instance", "vcsStage"))
    .handle("instance-instance.vcsUnstage", () => failClosed("instance-instance", "vcsUnstage"))
    .handle("instance-instance.vcsCommit", () => failClosed("instance-instance", "vcsCommit"))
    .handle("instance-instance.vcsLog", () => failClosed("instance-instance", "vcsLog"))
    .handle("instance-instance.command", () => failClosed("instance-instance", "command"))
    .handle("instance-instance.agent", () => failClosed("instance-instance", "agent"))
    .handle("instance-instance.skill", () => failClosed("instance-instance", "skill"))
    .handle("instance-instance.lsp", () => failClosed("instance-instance", "lsp"))
    .handle("instance-instance.formatter", () => failClosed("instance-instance", "formatter")),
)
