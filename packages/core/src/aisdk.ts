export * as AISDK from "./aisdk"

import type { LanguageModelV3 } from "@ai-sdk/provider"
import { Cause, Context, Effect, Layer, Schema, Scope } from "effect"
import { AISDKTransport } from "./aisdk/transport"
import { ModelV2 } from "./model"
import { ProviderV2 } from "./provider"
import { State } from "./state"

type SDK = any

export interface SDKEvent {
  readonly model: ModelV2.Info
  readonly package: string
  readonly options: Record<string, any>
  sdk?: SDK
}

export interface LanguageEvent {
  readonly model: ModelV2.Info
  readonly sdk: SDK
  readonly options: Record<string, any>
  language?: LanguageModelV3
}

/**
 * Build the option bag a provider package is constructed with.
 *
 * Exported and structurally typed so the deadline precedence can be asserted without standing
 * up a provider: it reads a provider id, the api and the model-level request body, nothing
 * else. `ModelV2.Info` satisfies it.
 */
export function prepareOptions(
  model: {
    readonly providerID: string
    readonly api: { readonly type: string; readonly settings?: Record<string, unknown>; readonly url?: string }
    readonly request: { readonly body: Record<string, unknown> }
  },
  pkg: string,
): Record<string, any> & { fetch: AISDKTransport.Fetch } {
  const settings = model.api.type === "aisdk" ? (model.api.settings ?? {}) : {}
  // Deadlines are read from the provider api settings only. The request body is model-level
  // and is spread over the settings below, so without reading them first a body field named
  // `timeout` would silently change the transport deadline for the whole provider.
  const deadlines = AISDKTransport.withFallbacks(AISDKTransport.pick(settings), {
    // Every provider gets the chunk deadline, as in V1: a stream that goes quiet mid-answer is
    // never legitimate. The header deadline is scoped to the OpenAI package for the same reason
    // V1 scopes it to that provider — elsewhere it is opt-in.
    chunk: AISDKTransport.DEFAULT_CHUNK_TIMEOUT,
    header: pkg === "@ai-sdk/openai" ? AISDKTransport.DEFAULT_HEADER_TIMEOUT : undefined,
  })
  const options: Record<string, any> = {
    name: model.providerID,
    ...settings,
    ...model.request.body,
  }
  if (model.api.type === "aisdk" && model.api.url) options.baseURL = model.api.url

  const custom = options.fetch
  // The three are ours to enforce; a provider package that saw them would apply its own.
  delete options.timeout
  delete options.headerTimeout
  delete options.chunkTimeout

  const send = AISDKTransport.withDeadlines({
    deadlines,
    fetch: typeof custom === "function" ? custom : fetch,
  })

  const wrapped: AISDKTransport.Fetch = async (input, init) => {
    const opts = { ...init }

    if (
      (pkg === "@ai-sdk/openai" || pkg === "@ai-sdk/azure" || pkg === "@ai-sdk/amazon-bedrock/mantle") &&
      opts.body &&
      opts.method === "POST"
    ) {
      const body = JSON.parse(opts.body as string)
      if (body.store !== true && Array.isArray(body.input)) {
        for (const item of body.input) {
          if ("id" in item) delete item.id
        }
        opts.body = JSON.stringify(body)
      }
    }

    // `timeout: false` is Bun's own fetch knob, switched off so the deadlines above are the
    // only ones in play. Assign rather than a literal: it is not part of `RequestInit`.
    return send(input, Object.assign({}, opts, { timeout: false }))
  }

  // Assigned through `Object.assign` rather than by index: writing to a `Record<string, any>`
  // key does not tell the type system the bag now carries a fetch, and callers rely on it.
  return Object.assign(options, { fetch: wrapped })
}

export class InitError extends Schema.TaggedErrorClass<InitError>()("AISDK.InitError", {
  providerID: ProviderV2.ID,
  cause: Schema.Defect(),
}) {}

function initError(providerID: ProviderV2.ID) {
  return Effect.catchCause((cause) => Effect.fail(new InitError({ providerID, cause: Cause.squash(cause) })))
}

export interface Interface {
  readonly hook: {
    readonly sdk: (
      callback: (event: SDKEvent) => Effect.Effect<void> | void,
    ) => Effect.Effect<State.Registration, never, Scope.Scope>
    readonly language: (
      callback: (event: LanguageEvent) => Effect.Effect<void> | void,
    ) => Effect.Effect<State.Registration, never, Scope.Scope>
  }
  readonly runSDK: (event: SDKEvent) => Effect.Effect<SDKEvent>
  readonly runLanguage: (event: LanguageEvent) => Effect.Effect<LanguageEvent>
  readonly language: (model: ModelV2.Info) => Effect.Effect<LanguageModelV3, InitError>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/AISDK") {}

export const locationLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    let sdkHooks: ((event: SDKEvent) => Effect.Effect<void> | void)[] = []
    let languageHooks: ((event: LanguageEvent) => Effect.Effect<void> | void)[] = []
    const languages = new Map<string, LanguageModelV3>()
    const sdks = new Map<string, SDK>()

    const register = <Event>(
      hooks: () => ((event: Event) => Effect.Effect<void> | void)[],
      update: (hooks: ((event: Event) => Effect.Effect<void> | void)[]) => void,
    ) =>
      Effect.fn("AISDK.hook")(function* (callback: (event: Event) => Effect.Effect<void> | void) {
        const scope = yield* Scope.Scope
        let active = true
        update([...hooks(), callback])
        const dispose = Effect.sync(() => {
          if (!active) return
          active = false
          update(hooks().filter((item) => item !== callback))
        })
        yield* Scope.addFinalizer(scope, dispose)
        return { dispose }
      })

    const run = Effect.fnUntraced(function* <Event>(
      hooks: readonly ((event: Event) => Effect.Effect<void> | void)[],
      event: Event,
    ) {
      for (const hook of hooks) {
        const result = hook(event)
        if (Effect.isEffect(result)) yield* result
      }
      return event
    })

    const service = Service.of({
      hook: {
        sdk: register(
          () => sdkHooks,
          (next) => (sdkHooks = next),
        ),
        language: register(
          () => languageHooks,
          (next) => (languageHooks = next),
        ),
      },
      runSDK: (event) => run(sdkHooks, event),
      runLanguage: (event) => run(languageHooks, event),
      language: Effect.fn("AISDK.language")(function* (model) {
        const key = `${model.providerID}/${model.id}/${model.request.variant ?? "default"}`
        const existing = languages.get(key)
        if (existing) return existing
        if (model.api.type !== "aisdk")
          return yield* new InitError({
            providerID: model.providerID,
            cause: new Error(`Unsupported api ${model.api.type}`),
          })

        const options = prepareOptions(model, model.api.package)
        const sdkKey = JSON.stringify({
          providerID: model.providerID,
          api: model.api,
          options,
        })
        const sdk =
          sdks.get(sdkKey) ??
          (yield* service.runSDK({ model, package: model.api.package, options }).pipe(initError(model.providerID))).sdk
        if (!sdk)
          return yield* new InitError({
            providerID: model.providerID,
            cause: new Error("No AISDK provider plugin returned an SDK"),
          })
        sdks.set(sdkKey, sdk)
        const result = yield* service.runLanguage({ model, sdk, options }).pipe(initError(model.providerID))
        const language = yield* Effect.sync(() => result.language ?? sdk.languageModel(model.api.id)).pipe(
          initError(model.providerID),
        )
        languages.set(key, language)
        return language
      }),
    })
    return service
  }),
)

export const defaultLayer = locationLayer
