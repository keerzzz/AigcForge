import { Provider } from "@aigcfroge/schema/provider"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { Authorization } from "../middleware/authorization.js"
import { InstanceContext, WorkspaceRouting, WorkspaceRoutingQuery } from "../middleware/workspace-routing.js"
import { described } from "./metadata.js"
import { ProviderInstanceInfo } from "./provider-contract.js"

// Fork-retained instance-scoped surface (see prompt-asset.ts for the conventions).
// Lives beside the base `server.provider` group (client name "provider").
const root = "/provider"

/** Lifted from the fork entry provider auth service (prompt/method contracts). */
const AuthWhen = Schema.Struct({
  key: Schema.String,
  op: Schema.Literals(["eq", "neq"]),
  value: Schema.String,
}).annotate({ identifier: "ProviderAuth.When" })

const AuthTextPrompt = Schema.Struct({
  type: Schema.Literal("text"),
  key: Schema.String,
  message: Schema.String,
  placeholder: Schema.optional(Schema.String),
  when: Schema.optional(AuthWhen),
}).annotate({ identifier: "ProviderAuth.TextPrompt" })

const AuthSelectOption = Schema.Struct({
  label: Schema.String,
  value: Schema.String,
  hint: Schema.optional(Schema.String),
}).annotate({ identifier: "ProviderAuth.SelectOption" })

const AuthSelectPrompt = Schema.Struct({
  type: Schema.Literal("select"),
  key: Schema.String,
  message: Schema.String,
  options: Schema.Array(AuthSelectOption),
  when: Schema.optional(AuthWhen),
}).annotate({ identifier: "ProviderAuth.SelectPrompt" })

const AuthPrompt = Schema.Union([AuthTextPrompt, AuthSelectPrompt]).annotate({ identifier: "ProviderAuth.Prompt" })

export class ProviderAuthMethod extends Schema.Class<ProviderAuthMethod>("ProviderAuthMethod")({
  type: Schema.Literals(["oauth", "api"]),
  label: Schema.String,
  prompts: Schema.optional(Schema.Array(AuthPrompt)),
}) {}

export const ProviderAuthMethods = Schema.Record(Schema.String, Schema.Array(ProviderAuthMethod)).annotate({
  identifier: "ProviderAuth.Methods",
})

export class ProviderAuthAuthorization extends Schema.Class<ProviderAuthAuthorization>("ProviderAuthAuthorization")({
  url: Schema.String,
  method: Schema.Literals(["auto", "code"]),
  instructions: Schema.String,
}) {}

export const ProviderAuthorizeInput = Schema.Struct({
  method: Schema.Finite.annotate({ description: "Auth method index" }),
  inputs: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({ description: "Prompt inputs" }),
}).annotate({ identifier: "ProviderAuth.AuthorizeInput" })

export const ProviderCallbackInput = Schema.Struct({
  method: Schema.Finite.annotate({ description: "Auth method index" }),
  code: Schema.optional(Schema.String).annotate({ description: "OAuth authorization code" }),
}).annotate({ identifier: "ProviderAuth.CallbackInput" })

/** Lifted from the fork entry provider discover service. */
export const ProviderDiscoveredModel = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
}).annotate({ identifier: "ProviderDiscover.DiscoveredModel" })

export const ProviderDiscoverInput = Schema.Struct({
  baseURL: Schema.String,
  api: Schema.optional(Schema.String),
  apiKey: Schema.optional(Schema.String),
}).annotate({ identifier: "ProviderDiscover.Input" })

export const ProviderListResult = Schema.Struct({
  all: Schema.Array(ProviderInstanceInfo),
  default: Schema.Record(Schema.String, Schema.String),
  connected: Schema.Array(Schema.String),
}).annotate({ identifier: "ProviderInstance.ListResult" })

const ProviderAuthErrorName = Schema.Union([
  Schema.Literal("BadRequest"),
  Schema.Literal("ProviderAuthOauthMissing"),
  Schema.Literal("ProviderAuthOauthCodeMissing"),
  Schema.Literal("ProviderAuthOauthCallbackFailed"),
  Schema.Literal("ProviderAuthValidationFailed"),
])

export class ProviderAuthApiError extends Schema.TaggedError<ProviderAuthApiError>()(
  "ProviderAuthError",
  {
    name: ProviderAuthErrorName,
    data: Schema.Struct({
      providerID: Schema.optional(Provider.ID),
      field: Schema.optional(Schema.String),
      message: Schema.optional(Schema.String),
      kind: Schema.optional(Schema.String),
    }),
  },
  { httpApiStatus: 400 },
) {}

const ProviderDiscoverErrorName = Schema.Union([
  Schema.Literal("Auth"),
  Schema.Literal("Unreachable"),
  Schema.Literal("Parse"),
])

export class ProviderDiscoverApiError extends Schema.TaggedError<ProviderDiscoverApiError>()(
  "ProviderDiscoverError",
  {
    name: ProviderDiscoverErrorName,
    data: Schema.Struct({
      status: Schema.optional(Schema.Number),
      message: Schema.String,
    }),
  },
  { httpApiStatus: 400 },
) {}

export const ProviderInstanceGroup = HttpApiGroup.make("provider-instance")
  .add(
    HttpApiEndpoint.get("provider-instance.list", root, {
      query: WorkspaceRoutingQuery,
      success: described(ProviderListResult, "List of providers"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "provider.instance.list",
        summary: "List providers",
        description: "Get a list of all available AI providers, including both available and connected ones.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("provider-instance.auth", `${root}/auth`, {
      query: WorkspaceRoutingQuery,
      success: described(ProviderAuthMethods, "Provider auth methods"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "provider.instance.auth",
        summary: "Get provider auth methods",
        description: "Retrieve available authentication methods for all AI providers.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("provider-instance.authorize", `${root}/:providerID/oauth/authorize`, {
      params: { providerID: Provider.ID },
      query: WorkspaceRoutingQuery,
      payload: ProviderAuthorizeInput,
      success: described(Schema.UndefinedOr(ProviderAuthAuthorization), "Authorization URL and method"),
      error: ProviderAuthApiError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "provider.instance.oauth.authorize",
        summary: "Start OAuth authorization",
        description: "Start the OAuth authorization flow for a provider.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("provider-instance.callback", `${root}/:providerID/oauth/callback`, {
      params: { providerID: Provider.ID },
      query: WorkspaceRoutingQuery,
      payload: ProviderCallbackInput,
      success: described(Schema.Boolean, "OAuth callback processed successfully"),
      error: ProviderAuthApiError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "provider.instance.oauth.callback",
        summary: "Handle OAuth callback",
        description: "Handle the OAuth callback from a provider after user authorization.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("provider-instance.discover", `${root}/discover`, {
      query: WorkspaceRoutingQuery,
      payload: ProviderDiscoverInput,
      success: described(Schema.Array(ProviderDiscoveredModel), "Models the endpoint advertises"),
      error: ProviderDiscoverApiError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "provider.instance.discover",
        summary: "Discover models from a provider endpoint",
        description:
          "Probe an OpenAI-compatible or Anthropic endpoint for its model listing without persisting anything.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "provider",
      description: "Experimental HttpApi provider routes.",
    }),
  )
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(Authorization)
