import { ConfigV1 } from "@omnixa/schema/v1/config/config"
import { ProviderInstanceConfigResult } from "./provider-contract.js"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { InvalidRequestError } from "../errors.js"
import { Authorization } from "../middleware/authorization.js"
import { InstanceContext, WorkspaceRouting, WorkspaceRoutingQuery } from "../middleware/workspace-routing.js"
import { described } from "./metadata.js"

// Fork-retained instance-scoped surface (see prompt-asset.ts for the conventions).
// Lives beside the base `server.config` group (client name "config").
const root = "/config"

export const ConfigInstanceGroup = HttpApiGroup.make("config-instance")
  .add(
    HttpApiEndpoint.get("config-instance.get", root, {
      query: WorkspaceRoutingQuery,
      success: described(ConfigV1.Info, "Get config info"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "config.instance.get",
        summary: "Get configuration",
        description: "Retrieve the current Omnixa configuration settings and preferences.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("config-instance.update", root, {
      query: WorkspaceRoutingQuery,
      payload: ConfigV1.Info,
      success: described(ConfigV1.Info, "Successfully updated config"),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "config.instance.update",
        summary: "Update configuration",
        description: "Update Omnixa configuration settings and preferences.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("config-instance.providers", `${root}/providers`, {
      query: WorkspaceRoutingQuery,
      success: described(ProviderInstanceConfigResult, "List of providers"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "config.instance.providers",
        summary: "List config providers",
        description: "Get a list of all configured AI providers and their default models.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "config",
      description: "Experimental HttpApi config routes.",
    }),
  )
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(Authorization)
