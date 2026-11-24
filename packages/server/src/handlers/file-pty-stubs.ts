import { InvalidRequestError } from "@omnixa/protocol/errors"
import { HttpApiBuilder } from "effect/http-api"
import { Effect } from "effect"
import { Api } from "../api"

/**
 * R1b transitional stubs (file/pty mirrors): contracts are live and the client
 * is generated; handlers arrive with the R2 port. Fail closed with kind
 * "not_implemented"; deleted as the R2 slices land implementations.
 */
const failClosed = (group: string, name: string) =>
  Effect.fail(
    new InvalidRequestError({
      message: `${group}.${name} is not implemented until the R2 file/pty port`,
      kind: "not_implemented",
    }),
  )

export const FileInstanceHandler = HttpApiBuilder.group(Api, "file-instance", (handlers) =>
  handlers
    .handle("file.findText", () => failClosed("file-instance", "findText"))
    .handle("file.findFile", () => failClosed("file-instance", "findFile"))
    .handle("file.findSymbol", () => failClosed("file-instance", "findSymbol"))
    .handle("file.list", () => failClosed("file-instance", "list"))
    .handle("file.content", () => failClosed("file-instance", "content"))
    .handle("file.status", () => failClosed("file-instance", "status")),
)

export const PtyInstanceHandler = HttpApiBuilder.group(Api, "pty-instance", (handlers) =>
  handlers
    .handle("pty.shells", () => failClosed("pty-instance", "shells"))
    .handle("pty.list", () => failClosed("pty-instance", "list"))
    .handle("pty.create", () => failClosed("pty-instance", "create"))
    .handle("pty.get", () => failClosed("pty-instance", "get"))
    .handle("pty.update", () => failClosed("pty-instance", "update"))
    .handle("pty.remove", () => failClosed("pty-instance", "remove"))
    .handle("pty.connectToken", () => failClosed("pty-instance", "connectToken")),
)

export const PtyConnectInstanceHandler = HttpApiBuilder.group(Api, "pty-connect-instance", (handlers) =>
  handlers.handle("pty.connect", () => failClosed("pty-connect-instance", "connect")),
)
