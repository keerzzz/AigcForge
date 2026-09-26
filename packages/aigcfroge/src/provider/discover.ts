import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"

// A model candidate an endpoint disclosed. The reply is advisory — nothing is
// persisted here; the settings write is what decides what a provider serves.
export const DiscoveredModel = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
})
export type DiscoveredModel = Schema.Schema.Type<typeof DiscoveredModel>

export class DiscoverAuthError extends Schema.TaggedErrorClass<DiscoverAuthError>()("ProviderDiscoverAuthError", {
  status: Schema.Number,
}) {
  override get message() {
    return `Authentication failed while discovering models (HTTP ${this.status})`
  }
}

export class DiscoverUnreachableError extends Schema.TaggedErrorClass<DiscoverUnreachableError>()(
  "ProviderDiscoverUnreachableError",
  {
    status: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    return this.status ? `Endpoint returned HTTP ${this.status}` : "Endpoint is unreachable"
  }
}

export class DiscoverParseError extends Schema.TaggedErrorClass<DiscoverParseError>()("ProviderDiscoverParseError", {
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    return "Could not parse the model listing"
  }
}

export type DiscoverError = DiscoverAuthError | DiscoverUnreachableError | DiscoverParseError

// Both OpenAI-compatible and Anthropic listings answer with a `data` array;
// Anthropic additionally carries `display_name`. Extra fields are ignored.
const ListResponse = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      display_name: Schema.optional(Schema.String),
      name: Schema.optional(Schema.String),
    }),
  ),
})

// Anthropic uses `GET {root}/v1/models`; the OpenAI-compatible listing is
// `GET {baseURL}/models`. A base already ending in `/v1` is not doubled.
function listingUrl(baseURL: string, anthropic: boolean) {
  const base = baseURL.replace(/\/+$/, "")
  if (!anthropic) return `${base}/models`
  return base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`
}

export const discoverModelsFromEndpoint = Effect.fn("Provider.discoverModels")(function* (input: {
  baseURL: string
  api?: string
  apiKey?: string
}) {
  const http = yield* HttpClient.HttpClient
  const anthropic = (input.api ?? "").includes("anthropic")
  const url = listingUrl(input.baseURL, anthropic)
  const headers: Record<string, string> = anthropic
    ? { ...(input.apiKey ? { "x-api-key": input.apiKey } : {}), "anthropic-version": "2023-06-01" }
    : input.apiKey
      ? { authorization: `Bearer ${input.apiKey}` }
      : {}

  const response = yield* HttpClientRequest.get(url).pipe(
    HttpClientRequest.setHeaders(headers),
    http.execute,
    Effect.timeout("10 seconds"),
    Effect.mapError((cause) => new DiscoverUnreachableError({ cause })),
  )

  if (response.status === 401 || response.status === 403) {
    return yield* new DiscoverAuthError({ status: response.status })
  }
  if (response.status < 200 || response.status >= 300) {
    return yield* new DiscoverUnreachableError({ status: response.status })
  }

  const body = yield* response.json.pipe(Effect.mapError((cause) => new DiscoverParseError({ cause })))
  const parsed = yield* Schema.decodeUnknownEffect(ListResponse)(body).pipe(
    Effect.mapError((cause) => new DiscoverParseError({ cause })),
  )

  return parsed.data.map((m) => {
    const name = m.display_name ?? m.name
    return { id: m.id, ...(name ? { name } : {}) }
  })
})

export * as ProviderDiscover from "./discover"
