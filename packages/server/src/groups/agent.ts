import { AgentV2 } from "@aigcfroge/core/agent"
import { CliDiscovery } from "@aigcfroge/core/tool/cli-discovery"
import { Location } from "@aigcfroge/core/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi, LocationMiddleware } from "./location"

export const AgentGroup = HttpApiGroup.make("server.agent")
  .add(
    HttpApiEndpoint.get("agent.list", "/api/agent", {
      query: LocationQuery,
      success: Location.response(Schema.Array(AgentV2.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.agent.list",
          summary: "List agents",
          description: "Retrieve currently registered agents.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("agent.cli", "/api/agent/cli", {
      query: LocationQuery,
      success: Location.response(Schema.Array(CliDiscovery.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.agent.cli",
          summary: "Detect CLI agents",
          description:
            "Find user-installed CLI agents in the current server environment without running or installing them.",
        }),
      ),
  )
  .middleware(LocationMiddleware)
