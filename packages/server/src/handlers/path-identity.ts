import { PathIdentity } from "@aigcfroge/core/path-identity"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const PathIdentityHandler = HttpApiBuilder.group(Api, "server.pathIdentity", (handlers) =>
  handlers.handle("pathIdentity.compare", (ctx) =>
    PathIdentity.Service.use((identity) => identity.compare(ctx.payload)),
  ),
)
