import { Provider } from "@omnixa/schema/provider"
import { ProviderDefinition } from "@omnixa/schema/provider-definition"
import { ProviderDiscovery } from "@omnixa/schema/provider-discovery"
import { Location } from "@omnixa/schema/location"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { InvalidRequestError, ProviderNotFoundError, ServiceUnavailableError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const ProviderGroup = HttpApiGroup.make("server.provider")
  .add(
    HttpApiEndpoint.get("provider.list", "/api/provider", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Provider.Info)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "provider.list",
          summary: "List providers",
          description: "Retrieve active AI providers so clients can show provider availability and configuration.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("provider.discovery.get", "/api/provider/discovery", {
      query: Schema.Struct({ ...LocationQuery.fields, ...ProviderDiscovery.GetInput.fields }),
      success: Location.response(ProviderDiscovery.Read),
      error: [InvalidRequestError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "provider.discovery.get",
        summary: "Read a connection's discovered model inventory",
        description:
          "Read the selected connection's last complete inventory, fetch status, and managed model metadata without starting a request.",
        transform: (operation) => {
          if (!Array.isArray(operation.parameters)) return operation
          return {
            ...operation,
            parameters: operation.parameters.map((parameter) =>
              parameter?.in === "query" && (parameter.name === "location" || parameter.name === "connection")
                ? { ...parameter, style: "deepObject", explode: true }
                : parameter,
            ),
          }
        },
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("provider.discovery.preview", "/api/provider/discovery/preview", {
      query: LocationQuery,
      payload: ProviderDiscovery.PreviewInput,
      success: Location.response(ProviderDiscovery.Read),
      error: [InvalidRequestError, ServiceUnavailableError],
    })
      .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error", errors: "all" })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "provider.discovery.preview",
          summary: "Preview models using a provider draft",
          description:
            "Merge a stored provider patch or use a new definition to fetch temporary candidates without saving configuration, credentials, or discovery cache.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("provider.discovery.refresh", "/api/provider/discovery/refresh", {
      query: LocationQuery,
      payload: ProviderDiscovery.RefreshInput,
      success: Location.response(ProviderDiscovery.Read),
      error: [InvalidRequestError, ServiceUnavailableError],
    })
      .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error", errors: "all" })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "provider.discovery.refresh",
          summary: "Refresh a saved connection's model inventory",
          description:
            "Fetch the stored connection's model directory, retaining the same identity's last complete success when a request fails or returns a partial listing.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("provider.definition.get", "/api/provider/definition", {
      query: Schema.Struct({ ...LocationQuery.fields, providerID: Schema.optional(Provider.ID) }),
      success: Location.response(ProviderDefinition.List),
      error: [InvalidRequestError, ServiceUnavailableError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "provider.definition.get",
          summary: "Read authored provider definitions",
          description:
            "Read editable provider layers, including disabled and incomplete definitions, and legal configuration targets.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("provider.definition.save", "/api/provider/definition", {
      query: LocationQuery,
      payload: ProviderDefinition.SaveInput,
      success: Location.response(ProviderDefinition.SaveResult),
      error: [InvalidRequestError, ServiceUnavailableError],
    })
      .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error", errors: "all" })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "provider.definition.save",
          summary: "Save an authored provider definition",
          description:
            "Patch one configuration layer and reconcile its credential adoption using a stable submission ID.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("provider.definition.remove", "/api/provider/definition", {
      query: LocationQuery,
      payload: ProviderDefinition.RemoveInput,
      success: Location.response(ProviderDefinition.RemoveResult),
      error: [InvalidRequestError, ServiceUnavailableError],
    })
      .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error", errors: "all" })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "provider.definition.remove",
          summary: "Remove an authored provider layer",
          description:
            "Remove only the chosen configuration layer. Inherited definitions and stored credentials remain owned by their sources.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("provider.get", "/api/provider/:providerID", {
      params: { providerID: Provider.ID },
      query: LocationQuery,
      success: Location.response(Provider.Info),
      error: [ProviderNotFoundError, ServiceUnavailableError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "provider.get",
          summary: "Get provider",
          description: "Retrieve a single AI provider so clients can inspect its availability and endpoint settings.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "provider",
      description: "Experimental provider routes.",
    }),
  )
