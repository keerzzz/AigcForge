import { PtyConnectAuthorization } from "@aigcfroge/protocol/middleware/pty-connect"
import { Effect, Layer } from "effect"

/**
 * R1b transitional stub: the pty-connect contract is registered but the ticket
 * validation Layer arrives with the R2 pty port. Fails closed so no WebSocket
 * upgrade can slip past authorization before the real implementation lands.
 */
const NOT_IMPLEMENTED = "pty connect authorization is not implemented until the R2 pty port"

export const ptyConnectStubLayer = Layer.effect(
  PtyConnectAuthorization,
  Effect.sync(() => PtyConnectAuthorization.of(() => Effect.die(new Error(NOT_IMPLEMENTED)))),
)
