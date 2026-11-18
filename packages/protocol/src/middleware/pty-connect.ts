import { HttpApiMiddleware } from "effect/http-api"
import { ForbiddenError } from "../errors.js"

/**
 * Fork-retained PTY connect authorization: browsers cannot set headers on
 * WebSocket upgrades, so the connect route authenticates via a short-lived
 * ticket instead of the regular Authorization middleware. Contract-only here;
 * the ticket validation Layer lives server-side (R2).
 */
export class PtyConnectAuthorization extends HttpApiMiddleware.Service<PtyConnectAuthorization>()(
  "@aigcfroge/HttpApiPtyConnectAuthorization",
  { error: ForbiddenError },
) {}
