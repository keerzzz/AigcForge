import { Context, Schema } from "effect"
import { HttpApiMiddleware } from "effect/http-api"
import { ApiNotFoundError, InvalidRequestError } from "../errors.js"

// Query fields the workspace router reads from the URL. Spread into every
// endpoint query schema in groups that apply WorkspaceRouting, otherwise
// HttpApi rejects requests carrying these params with 400.
// HttpApiMiddleware cannot declare query params today — remove this once
// upstream supports middleware-declared query schemas.
export const WorkspaceRoutingQueryFields = {
  directory: Schema.optional(Schema.String),
  workspace: Schema.optional(Schema.String),
}

export const WorkspaceRoutingQuery = Schema.Struct(WorkspaceRoutingQueryFields)

/**
 * Routing context resolved from the `directory`/`workspace` query fields by the
 * server-side workspace router (instance placement). Protocol owns only the
 * contract: the router Layer itself lives server-side (R2).
 */
export class WorkspaceRouteContext extends Context.Service<
  WorkspaceRouteContext,
  {
    readonly directory: string
    readonly workspaceID?: string
  }
>()("@aigcfroge/HttpApiWorkspaceRouteContext") {}

/**
 * Routes a request to the owning workspace instance (local session or remote
 * proxy) and provides the resolved routing context. Failures surface as
 * InvalidRequestError (400).
 */
export class WorkspaceRouting extends HttpApiMiddleware.Service<
  WorkspaceRouting,
  {
    provides: WorkspaceRouteContext
  }
>()("@aigcfroge/HttpApiWorkspaceRouting", { error: InvalidRequestError }) {}

/**
 * Resolves the target project instance from the routed workspace context and
 * fails with ApiNotFoundError (404) when the instance is gone.
 */
export class InstanceContext extends HttpApiMiddleware.Service<
  InstanceContext,
  {
    requires: WorkspaceRouteContext
  }
>()("@aigcfroge/HttpApiInstanceContext", { error: ApiNotFoundError }) {}
