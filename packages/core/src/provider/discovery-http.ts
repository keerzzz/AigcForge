export * as ProviderDiscoveryHTTP from "./discovery-http.js"

import { Effect, Option, Schema, Stream } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { Model } from "@aigcfroge/schema/model"
import { ModelSource } from "@aigcfroge/schema/model-source"
import { optional } from "@aigcfroge/schema/schema"

export class FetchError extends Schema.TaggedError<FetchError>()("ProviderDiscovery.Fetch", {
  kind: Schema.Literals(["auth", "network", "timeout", "invalid", "incomplete"]),
  message: Schema.String,
}) {}

export interface Request {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly timeoutMs?: number
  readonly maxBytes?: number
  readonly maxPages?: number
}

export interface Listing {
  readonly complete: boolean
  readonly models: readonly { readonly id: Model.ID; readonly metadata: ModelSource.Metadata }[]
  readonly error?: { readonly kind: "incomplete"; readonly message: string }
}

const OpenAIPage = Schema.Struct({
  data: Schema.Array(Schema.Struct({
    id: Schema.String.check(Schema.isMinLength(1)),
    // A relay can provide AigcForge's typed metadata extension. Standard OpenAI
    // listings provide IDs only; owned_by and ID spelling imply no capabilities.
    metadata: ModelSource.Metadata.pipe(optional),
  })),
  has_more: Schema.Boolean.pipe(optional),
  next: Schema.NullOr(Schema.String).pipe(optional),
  next_page: Schema.NullOr(Schema.String).pipe(optional),
})

const Support = Schema.Struct({ supported: Schema.Boolean })
const AnthropicPage = Schema.Struct({
  data: Schema.Array(Schema.Struct({
    id: Schema.String.check(Schema.isMinLength(1)),
    display_name: Schema.String.pipe(optional),
    line: Schema.NullOr(Schema.String).pipe(optional),
    max_input_tokens: Schema.NullOr(Schema.Int).pipe(optional),
    max_tokens: Schema.NullOr(Schema.Int).pipe(optional),
    capabilities: Schema.NullOr(Schema.Struct({ image_input: Support.pipe(optional), pdf_input: Support.pipe(optional) })).pipe(optional),
    metadata: ModelSource.Metadata.pipe(optional),
  })),
  has_more: Schema.Boolean,
  last_id: Schema.NullOr(Schema.String).pipe(optional),
})

export const openai = Effect.fn("ProviderDiscoveryHTTP.openai")(function* (input: Request) {
  const http = yield* HttpClient.HttpClient
  const response = yield* http.execute(HttpClientRequest.get(input.url).pipe(HttpClientRequest.setHeaders(input.headers))).pipe(
    Effect.mapError(() => new FetchError({ kind: "network", message: "The model directory could not be reached" })),
  )
  if (response.status === 401 || response.status === 403)
    return yield* new FetchError({ kind: "auth", message: "The selected connection was rejected by the model directory" })
  if (response.status < 200 || response.status >= 300)
    return yield* new FetchError({ kind: "network", message: `The model directory returned HTTP ${response.status}` })
  const body = yield* response.stream.pipe(
    Stream.mapError(() => new FetchError({ kind: "network", message: "The model directory response could not be read" })),
    Stream.runFoldEffect(() => ({ bytes: 0, chunks: [] as Uint8Array[] }), (state, chunk) => {
      if (state.bytes + chunk.byteLength > (input.maxBytes ?? 8 * 1024 * 1024))
        return Effect.fail(new FetchError({ kind: "incomplete", message: "The model directory exceeded the response size limit" }))
      state.chunks.push(chunk)
      return Effect.succeed({ bytes: state.bytes + chunk.byteLength, chunks: state.chunks })
    }),
  )
  const buffer = new Uint8Array(body.bytes)
  let offset = 0
  for (const chunk of body.chunks) {
    buffer.set(chunk, offset)
    offset += chunk.byteLength
  }
  const page = Schema.decodeUnknownOption(Schema.fromJsonString(OpenAIPage))(new TextDecoder().decode(buffer))
  if (Option.isNone(page)) return yield* new FetchError({ kind: "invalid", message: "The model directory returned an invalid OpenAI listing" })
  const incomplete = page.value.has_more === true || Boolean(page.value.next) || Boolean(page.value.next_page)
  return {
    complete: !incomplete,
    models: Array.from(new Map(page.value.data.map((model) => [model.id, { id: Model.ID.make(model.id), metadata: model.metadata ?? {} }])).values()),
    ...(incomplete ? { error: { kind: "incomplete" as const, message: "This listing requires a pagination protocol that is not configured" } } : {}),
  } satisfies Listing
}, (effect, input) => effect.pipe(Effect.timeoutOrElse({
  duration: input.timeoutMs ?? 10_000,
  orElse: () => Effect.fail(new FetchError({ kind: "timeout", message: "The model directory request timed out" })),
})))

export const anthropic = Effect.fn("ProviderDiscoveryHTTP.anthropic")(function* (input: Request) {
  const http = yield* HttpClient.HttpClient
  const models = new Map<string, Listing["models"][number]>()
  const cursors = new Set<string>()
  let cursor: string | undefined
  let bytes = 0
  for (let index = 0; index < (input.maxPages ?? 100); index++) {
    const url = new URL(input.url)
    if (cursor) url.searchParams.set("after_id", cursor)
    const response = yield* http.execute(HttpClientRequest.get(url.href).pipe(HttpClientRequest.setHeaders(input.headers))).pipe(
      Effect.mapError(() => new FetchError({ kind: "network", message: "The model directory could not be reached" })),
    )
    if (response.status === 401 || response.status === 403)
      return yield* new FetchError({ kind: "auth", message: "The selected connection was rejected by the model directory" })
    if (response.status < 200 || response.status >= 300)
      return yield* new FetchError({ kind: "network", message: `The model directory returned HTTP ${response.status}` })
    const body = yield* response.stream.pipe(
      Stream.mapError(() => new FetchError({ kind: "network", message: "The model directory response could not be read" })),
      Stream.runFoldEffect(() => ({ bytes, chunks: [] as Uint8Array[] }), (state, chunk) => {
        if (state.bytes + chunk.byteLength > (input.maxBytes ?? 8 * 1024 * 1024))
          return Effect.fail(new FetchError({ kind: "incomplete", message: "The model directory exceeded the response size limit" }))
        state.chunks.push(chunk)
        return Effect.succeed({ bytes: state.bytes + chunk.byteLength, chunks: state.chunks })
      }),
    )
    const buffer = new Uint8Array(body.bytes - bytes)
    let offset = 0
    for (const chunk of body.chunks) {
      buffer.set(chunk, offset)
      offset += chunk.byteLength
    }
    bytes = body.bytes
    const page = Schema.decodeUnknownOption(Schema.fromJsonString(AnthropicPage))(new TextDecoder().decode(buffer))
    if (Option.isNone(page)) return yield* new FetchError({ kind: "invalid", message: "The model directory returned an invalid Anthropic listing" })
    for (const model of page.value.data) {
      const capabilities = model.capabilities
      const nativeInput = capabilities?.image_input !== undefined && capabilities.pdf_input !== undefined
        ? ["text", ...(capabilities.image_input.supported ? ["image"] : []), ...(capabilities.pdf_input.supported ? ["pdf"] : [])]
        : undefined
      models.set(model.id, {
        id: Model.ID.make(model.id),
        metadata: {
          ...(model.display_name === undefined ? {} : { name: model.display_name }),
          ...(model.line == null ? {} : { family: Model.Family.make(model.line) }),
          ...model.metadata,
          ...(nativeInput || model.metadata?.capabilities ? { capabilities: { ...(nativeInput ? { input: nativeInput } : {}), ...model.metadata?.capabilities } } : {}),
          ...(model.max_input_tokens == null && model.max_tokens == null && !model.metadata?.limit ? {} : {
            limit: { ...(model.max_input_tokens == null ? {} : { context: model.max_input_tokens, input: model.max_input_tokens }), ...(model.max_tokens == null ? {} : { output: model.max_tokens }), ...model.metadata?.limit },
          }),
        },
      })
    }
    if (!page.value.has_more) return { complete: true, models: [...models.values()] } satisfies Listing
    const next = page.value.last_id
    if (!next || cursors.has(next))
      return { complete: false, models: [...models.values()], error: { kind: "incomplete", message: "The model directory did not advance its pagination cursor" } } satisfies Listing
    cursor = next
    cursors.add(next)
  }
  return { complete: false, models: [...models.values()], error: { kind: "incomplete", message: "The model directory exceeded the page limit" } } satisfies Listing
}, (effect, input) => effect.pipe(Effect.timeoutOrElse({
  duration: input.timeoutMs ?? 10_000,
  orElse: () => Effect.fail(new FetchError({ kind: "timeout", message: "The model directory request timed out" })),
})))
