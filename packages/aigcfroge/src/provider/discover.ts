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

// Both protocols answer with a `data` array; Anthropic additionally carries
// `display_name` and paginates (its SDK's PageResponse is
// `{data, has_more, first_id, last_id}`), so the page cursor is read too —
// otherwise a probe reports a truncated catalog as success.
const ListResponse = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      display_name: Schema.optional(Schema.String),
      name: Schema.optional(Schema.String),
    }),
  ),
  has_more: Schema.optional(Schema.Boolean),
  last_id: Schema.optional(Schema.NullOr(Schema.String)),
})

// The listing hangs off the configured base URL, the same base the model calls
// use: @ai-sdk/anthropic posts to `${baseURL}/messages` (default
// `https://api.anthropic.com/v1`) and never inserts a `/v1` itself. Inserting
// one here would let a probe pass on a base the real call rejects.
const listingUrl = (baseURL: string) => `${baseURL.replace(/\/+$/, "")}/models`

const fetchPage = Effect.fnUntraced(function* (url: string, headers: Record<string, string>) {
  const http = yield* HttpClient.HttpClient
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
  return yield* Schema.decodeUnknownEffect(ListResponse)(body).pipe(
    Effect.mapError((cause) => new DiscoverParseError({ cause })),
  )
})

export const discoverModelsFromEndpoint = Effect.fn("Provider.discoverModels")(function* (input: {
  baseURL: string
  api?: string
  apiKey?: string
}) {
  const anthropic = (input.api ?? "").includes("anthropic")
  const headers: Record<string, string> = anthropic
    ? { ...(input.apiKey ? { "x-api-key": input.apiKey } : {}), "anthropic-version": "2023-06-01" }
    : input.apiKey
      ? { authorization: `Bearer ${input.apiKey}` }
      : {}
  const url = listingUrl(input.baseURL)

  const models: DiscoveredModel[] = []
  let afterID: string | undefined
  // Anthropic pages the listing; OpenAI-compatible listings omit `has_more` and
  // stop after the first request. The bound keeps a lying cursor from spinning.
  for (let page = 0; page < 20; page++) {
    const body = yield* fetchPage(afterID ? `${url}?after_id=${encodeURIComponent(afterID)}` : url, headers)
    models.push(
      ...body.data.map((model) => {
        const name = model.display_name ?? model.name
        return { id: model.id, ...(name ? { name } : {}) }
      }),
    )

    const next = body.has_more ? body.last_id : undefined
    if (!next || next === afterID) break
    afterID = next
  }

  return models
})

export * as ProviderDiscover from "./discover"
