export * as SessionModelRequest from "./model-request.js"

import {
  GenerationOptions,
  type GenerationOptionsFields,
  HttpOptions,
  LanguageModel,
  LLM,
  LLMRequest,
  type Media,
  Message,
  SystemPart,
} from "@omnixa/ai"
import type { StreamOptions } from "@omnixa/ai/route"
import type {
  SessionCompaction,
  SessionContext,
  SessionGenerate,
  SessionRequest,
  SessionRequestKind,
  SessionTitle,
} from "@omnixa/plugin/effect/session"
import type { Agent } from "@omnixa/schema/agent"
import type { Content } from "@omnixa/schema/tool"
import { Cause, Clock, Context, Effect, Layer, Option, Result, Stream } from "effect"
import { HttpClientRequest, HttpClientResponse } from "effect/http"
import { makeLocationNode } from "@omnixa/util/effect/app-node"
import { Model } from "../model.js"
import { App } from "../app.js"
import { Permission } from "../permission.js"
import { PluginHooks } from "../plugin/hooks.js"
import { Provider } from "../provider.js"
import { QuestionTool } from "../tool/plugin/question.js"
import { Tool } from "../tool.js"
import { SessionAffinity } from "./affinity.js"
import { SessionModelTransport } from "./model-transport.js"
import { SessionProviderContext } from "./provider-context.js"
import { SessionRunnerModel } from "./runner/model.js"
import { SessionSchema } from "./schema.js"
import { SessionSystemPrompt } from "./system-prompt.js"
import { toLLMMessages } from "./runner/to-llm-message.js"
import type { SessionMessage } from "./message.js"
import { SessionAttempt } from "@omnixa/schema/session-attempt"
import { CorrectionStore } from "./correction-store.js"
import { SessionMagpie } from "./magpie.js"

const IMAGE_BYTES_TRIGGER = 25 * 1024 * 1024 // 25 MiB
const IMAGE_BYTES_TARGET = 15 * 1024 * 1024 // 15 MiB
const IMAGE_REMOVED =
  "[This image was removed to reduce the request size and is no longer visible. Do not make claims about its contents from memory. If needed, retrieve it again with an available tool or ask the user to attach it again.]"
const GENERATION_KEYS = new Set(Object.keys(GenerationOptions.fields))
// Used when the catalog has no output limit for the model.
const OUTPUT_TOKEN_FALLBACK = 32_000
// No reply needs more, however much the model allows.
const OUTPUT_TOKEN_MAX = 256_000
// A summary never needs more, and a request asking for more cannot be shrunk to fit a window the catalog overstates.
const SUMMARY_OUTPUT_MAX = 32_000
// Prompt text is estimated at about 4 characters per token, which can run low on dense text such as code.
const ESTIMATE_ERROR = 0.15
// Never ask for less; only reachable with automatic compaction off, since it keeps the window from filling this far.
const OUTPUT_TOKEN_MIN = 1_024

/** Tool errors, plus the user declining a permission or dismissing a question. */
export type ExecuteError = Tool.Error | Permission.DeclinedError | QuestionTool.CancelledError

export interface Prepared<Event = SessionRequest> {
  readonly event: Event
  readonly request: LLMRequest
  readonly options: StreamOptions
  /** Primary attempts attach durable transport facts; auxiliary calls retain the original options. */
  readonly optionsForAttempt?: (
    observe: (observation: SessionAttempt.Observation) => Effect.Effect<void>,
    context?: { readonly attemptID: string },
  ) => StreamOptions
  readonly attributeGatewayAttempts?: (input: {
    readonly attemptID: string
    readonly started: number
    readonly routeID?: string
  }) => Effect.Effect<readonly SessionAttempt.GatewayAttempt[] | undefined>
  readonly retry: (event: PluginHooks.Domains["session"]["retry"]) => Effect.Effect<void>
  /** Runs a tool call against the tools this request advertised. */
  readonly executeTool: (
    input: Parameters<Tool.Snapshot["execute"]>[0],
  ) => Effect.Effect<Tool.NormalizedResult, ExecuteError>
}

export interface Input {
  readonly session: SessionSchema.Info
  readonly agent: Agent.ID
  readonly request?: Agent.Info["request"]
  readonly model: SessionRunnerModel.Resolved
  readonly tools?: Tool.Snapshot
  readonly system: Array<SystemPart>
  readonly messages: Array<Message>
  readonly toolChoice?: LLM.RequestInput["toolChoice"]
  /** Only the durable runner may use a stateful WebSocket. */
  readonly webSocket?: "session"
  /** Prompt size, measured by the provider or estimated. The default output limit leaves room for it. */
  readonly inputTokens?: { readonly measured: number; readonly estimated: number }
}

/** The default output limit: the catalog limit, fitted to the room the prompt leaves in the context window. */
const outputLimit = (
  limit: Model.Info["limit"],
  kind: "primary" | "compaction",
  inputTokens?: Input["inputTokens"],
) => {
  const model = Math.min(limit.output > 0 ? limit.output : OUTPUT_TOKEN_FALLBACK, OUTPUT_TOKEN_MAX)
  const requested = kind === "compaction" ? Math.min(model, SUMMARY_OUTPUT_MAX) : model
  if (inputTokens === undefined || limit.context <= 0) return requested
  const room = limit.context - inputTokens.measured - Math.ceil(inputTokens.estimated * (1 + ESTIMATE_ERROR))
  return Math.min(requested, Math.max(OUTPUT_TOKEN_MIN, room))
}

export const baseTranscript = (input: {
  readonly agent: Agent.Info
  readonly model: SessionRunnerModel.Resolved
  readonly tools: Tool.Snapshot
  readonly initial: string
  readonly messages: ReadonlyArray<SessionMessage.Info>
}) => {
  const providerMetadataKey = input.model.model.route.providerMetadataKey ?? input.model.model.provider
  return {
    providerMetadataKey,
    system: [
      input.agent.system
        ? input.agent.system
        : SessionSystemPrompt.make(input.tools.definitions.map((tool) => tool.name)),
      input.initial,
    ]
      .filter((part) => part.length > 0)
      .map(SystemPart.make),
    // Stored snapshots remain history. Only the Store's explicitly committed current snapshot is advertised.
    messages: toLLMMessages(
      input.messages.filter((message) => !CorrectionStore.isCorrectionHistory(message)),
      input.model.ref,
      providerMetadataKey,
      SessionProviderContext.provenance(input.model),
    ),
  }
}

const mimeToModality = (mime: string) => {
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("video/")) return "video"
  if (mime === "application/pdf") return "pdf"
}

// xAI rejects any other image type (e.g. GIF) with invalid_image, and the stored image would fail every later turn.
const XAI_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"])

const unsupportedMedia = (
  mime: string,
  name: string | undefined,
  capabilities: Model.Capabilities,
  provider: string | undefined,
) => {
  const modality = mimeToModality(mime)
  if (!modality) return
  const unsupported = !capabilities.input.some((item) => item.startsWith(modality))
    ? modality
    : provider === "xai" && modality === "image" && !XAI_IMAGE_MIMES.has(mime.toLowerCase())
      ? mime
      : undefined
  if (!unsupported) return
  return `ERROR: Cannot read ${name ? `"${name}"` : modality} (this model does not support ${unsupported} input). Inform the user.`
}

// Remote and provider-referenced media carry no local payload and never count toward the inline budget.
const mediaBytes = (media: Media.Asset) => {
  if (media.source.type === "base64") return Buffer.byteLength(media.source.data)
  if (media.source.type === "bytes") return Math.ceil(media.source.data.byteLength / 3) * 4
  return 0
}

/** Replaces media with the returned text; messages without replacements are returned unchanged. */
const replaceMedia = (
  messages: LLMRequest["messages"],
  replace: (media: { mime: string; name: string | undefined; bytes: () => number }) => string | undefined,
) =>
  messages.map((message) => {
    const content = message.content.map((part) => {
      if (part.type === "media") {
        const text = replace({ mime: part.media.mediaType, name: part.filename, bytes: () => mediaBytes(part.media) })
        return text === undefined ? part : Message.text(text)
      }
      if (part.type !== "tool-result" || part.result.type !== "content") return part
      const result = part.result
      const value = result.value.map((item): Content => {
        if (item.type !== "file") return item
        const text = replace({ mime: item.mime, name: item.name, bytes: () => Buffer.byteLength(item.uri) })
        return text === undefined ? item : { type: "text", text }
      })
      return value.every((item, index) => item === result.value[index])
        ? part
        : { ...part, result: { ...result, value } }
    })
    return content.every((part, index) => part === message.content[index])
      ? message
      : new Message({ ...message, content })
  })

export const unsupportedParts = (
  messages: LLMRequest["messages"],
  capabilities: Model.Capabilities,
  provider?: string,
) => replaceMedia(messages, (media) => unsupportedMedia(media.mime, media.name, capabilities, provider))

export const boundImages = (messages: LLMRequest["messages"]) => {
  const isImage = (mime: string) => mime.toLowerCase().startsWith("image/")
  const imageBytes = messages.reduce(
    (total, message) =>
      total +
      message.content.reduce((sum, part) => {
        if (part.type === "media" && isImage(part.media.mediaType)) return sum + mediaBytes(part.media)
        if (part.type !== "tool-result" || part.result.type !== "content") return sum
        return (
          sum +
          part.result.value.reduce(
            (bytes: number, item: Content) =>
              bytes + (item.type === "file" && isImage(item.mime) ? Buffer.byteLength(item.uri) : 0),
            0,
          )
        )
      }, 0),
    0,
  )
  if (imageBytes <= IMAGE_BYTES_TRIGGER) return messages

  let removed = 0
  return replaceMedia(messages, (media) => {
    if (!isImage(media.mime) || imageBytes - removed <= IMAGE_BYTES_TARGET) return
    removed += media.bytes()
    return IMAGE_REMOVED
  })
}

type Definitions = PluginHooks.Domains["session"]["context"]["tools"]

/** Builds the model request for each session flow. Each entry runs its own plugin hook. */
export interface Interface {
  readonly primary: (input: Input) => Effect.Effect<Prepared<SessionContext>>
  readonly compaction: (input: Input) => Effect.Effect<Prepared<SessionCompaction>>
  readonly generate: (input: Input) => Effect.Effect<Prepared<SessionGenerate>>
  readonly title: (input: Input) => Effect.Effect<Prepared<SessionTitle>>
}

export class Service extends Context.Service<Service, Interface>()("@omnixa/SessionModelRequest") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const hooks = yield* PluginHooks.Service
    const transport = yield* SessionModelTransport.Service
    const app = yield* App.Metadata
    const corrections = yield* CorrectionStore.Service
    const prepare = Effect.fn("SessionModelRequest.prepare")(function* <
      S extends SessionRequest & { tools?: Definitions },
    >(kind: SessionRequestKind, input: Input, shape: (draft: SessionRequest, tools: Definitions) => Effect.Effect<S>) {
      const session = input.session
      const model = input.model
      const scope = { sessionID: session.id, agent: input.agent, model: model.ref, connection: model.connection, kind }
      const snapshot = yield* corrections.snapshot(session.id)
      const messages = input.messages.filter((message) => message.id === undefined || !snapshot.owned.has(message.id))
      const tools = input.tools ?? {
        definitions: [],
        execute: () => new Tool.Error({ message: "Tools are not available for this request" }),
      }
      // Remember which tool each definition object came from. Hooks rename a tool by moving
      // its definition to a new key, so after the hook we find the tool by object identity.
      const given = new Map(
        tools.definitions.map((t) => [{ description: t.description, input: { ...t.inputSchema } }, t] as const),
      )
      // Hooks see the default output limit and may change or remove it. Titles and generate keep the provider default,
      // because their reasoning is hard to budget.
      const shaped = yield* shape(
        {
          sessionID: session.id,
          model: model.ref,
          connection: model.connection,
          system: input.system,
          messages:
            (kind === "primary" || kind === "compaction") && snapshot.current
              ? [...messages, Message.make({ id: snapshot.current.id, role: "user", content: snapshot.current.text })]
              : messages,
          options:
            kind === "primary" || kind === "compaction"
              ? { maxTokens: outputLimit(model.limit, kind, input.inputTokens) }
              : {},
        },
        Object.fromEntries(Array.from(given, ([d, t]) => [t.name, d])),
      )
      // Match by identity first, then by key. Entries matching neither were invented by a
      // hook and are dropped. `t.name` stays the real name so execution can map renames back.
      const byName = new Map(tools.definitions.map((t) => [t.name, t]))
      const hooked = new Map(
        Object.entries(shaped.tools ?? {}).flatMap(([name, d]) => {
          const t = given.get(d) ?? byName.get(name)
          return t ? [[name, { ...t, description: d.description, inputSchema: d.input }] as const] : []
        }),
      )
      const entries = Object.entries(shaped.options)
      const generation = Object.fromEntries(entries.filter(([k]) => GENERATION_KEYS.has(k))) as GenerationOptionsFields
      const providerOptions = Object.fromEntries(entries.filter(([k]) => !GENERATION_KEYS.has(k)))
      const affinity = SessionAffinity.get(session)
      const base = LLM.request({
        model: model.model,
        http: {
          body: input.request?.body,
          headers: Provider.mergeHeaders(
            {
              "x-omnixa-session-id": session.id,
              ...(session.parentID ? { "x-omnixa-parent-session-id": session.parentID } : {}),
              "x-session-affinity": affinity,
              "X-Session-Id": affinity,
              ...(session.parentID ? { "x-parent-session-id": session.parentID } : {}),
              "User-Agent": App.useragent(app),
              "x-omnixa-project": session.projectID,
              "x-omnixa-session": affinity,
              "x-omnixa-client": app.name,
            },
            input.request?.headers,
          ),
        },
        // TODO: Persist cache lineage so nested forks reuse the root session's cache key.
        promptCacheKey: /^ses_[0-9a-f]{64}$/.test(affinity) ? affinity.slice(4) : affinity,
        system: shaped.system,
        messages: boundImages(unsupportedParts(shaped.messages, model.capabilities, model.model.provider)),
        tools: Array.from(hooked, ([name, t]) => ({ ...t, name })),
        toolChoice: input.toolChoice,
        generation: Object.keys(generation).length === 0 ? undefined : generation,
        providerOptions: Object.keys(providerOptions).length === 0 ? undefined : providerOptions,
      })

      const baseURL = base.model.route.endpoint.baseURL
      const modelHook = yield* hooks.trigger("session", "model.request", {
        ...scope,
        baseURL: typeof baseURL === "string" ? baseURL : undefined,
        headers: { ...base.http?.headers },
      })
      const route =
        modelHook.baseURL !== undefined && modelHook.baseURL !== baseURL
          ? base.model.route.with({ endpoint: { baseURL: modelHook.baseURL } })
          : base.model.route
      const routed = LLMRequest.update(base, {
        model: route === base.model.route ? base.model : LanguageModel.update(base.model, { route }),
        http: new HttpOptions({
          ...base.http,
          headers: Object.keys(modelHook.headers).length === 0 ? undefined : modelHook.headers,
        }),
      })
      // History selects native windows against the catalog route before hooks run. A newly installed
      // routing hook must not send an existing opaque window to another deployment; `prepare` has no
      // error channel, so like hook failures this surfaces as a defect.
      const selected = SessionProviderContext.provenance(model)
      const sameDeployment =
        selected !== undefined &&
        SessionProviderContext.compatible(
          selected,
          SessionProviderContext.provenance(
            { model: routed.model, ref: model.ref, connection: model.connection },
            undefined,
            routed,
          ),
        )
      if (
        !sameDeployment &&
        routed.messages.some((message) => message.content.some((part) => part.type === "compaction"))
      )
        return yield* Effect.die(
          new Error("Provider context is incompatible with the route selected by model request hooks"),
        )
      const request = sameDeployment
        ? routed
        : LLMRequest.update(routed, {
            messages: routed.messages.map((message) =>
              message.role === "user" || message.role === "system"
                ? message
                : new Message({
                    ...message,
                    providerMetadata: undefined,
                    content: message.content.map((part) => ({ ...part, providerMetadata: undefined })),
                  }),
            ),
          })
      const hasOpaqueHistory = request.messages.some(
        (message) =>
          message.role !== "user" &&
          message.role !== "system" &&
          (message.providerMetadata !== undefined ||
            message.content.some(
              (part) =>
                part.type === "compaction" || ("providerMetadata" in part && part.providerMetadata !== undefined),
            )),
      )
      const requestDeployment = SessionProviderContext.provenance(
        { model: request.model, ref: model.ref, connection: model.connection },
        undefined,
        request,
      )

      let observedGatewayURL: string | undefined
      const hasHttpHooks =
        (yield* hooks.has("session", "http.request", model.ref.providerID)) ||
        (yield* hooks.has("session", "http.response", model.ref.providerID))
      const optionsForAttempt = (
        observe?: (observation: SessionAttempt.Observation) => Effect.Effect<void>,
        context?: { readonly attemptID: string },
      ): StreamOptions => {
        const recordTransport = (
          url: string | undefined,
          transport: SessionAttempt.Observation["transport"],
          delivery: SessionAttempt.Delivery,
        ) =>
          observe === undefined
            ? Effect.void
            : Effect.gen(function* () {
                yield* observe(
                  new SessionAttempt.Observation({
                    observedAt: yield* Clock.currentTimeMillis,
                    deployment:
                      url === undefined
                        ? undefined
                        : SessionProviderContext.provenance(
                            { model: request.model, ref: model.ref, connection: model.connection },
                            url,
                          ),
                    transport,
                    delivery,
                  }),
                )
              })
        const http: StreamOptions["http"] =
          hasHttpHooks || observe !== undefined
            ? (req, handler) =>
                Effect.gen(function* () {
                  const before = hasHttpHooks
                    ? yield* hooks.trigger("session", "http.request", {
                        ...scope,
                        request: yield* HttpClientRequest.toWeb(req),
                      })
                    : undefined
                  let sent = before === undefined ? req : HttpClientRequest.fromWeb(before.request)
                  if (before?.request.body)
                    sent = HttpClientRequest.bodyUint8Array(
                      sent,
                      new Uint8Array(yield* Effect.promise(() => before.request.clone().arrayBuffer())),
                      before.request.headers.get("content-type") ?? undefined,
                    )
                  const url = Option.getOrUndefined(HttpClientRequest.toUrl(sent))?.href
                  if (url !== undefined) observedGatewayURL = url
                  if (
                    SessionMagpie.isGatewayTarget({
                      providerID: model.ref.providerID,
                      baseURL: url ?? request.model.route.endpoint.baseURL,
                      headers: sent.headers,
                    })
                  )
                    sent = HttpClientRequest.setHeaders(
                      sent,
                      SessionMagpie.correlateHeaders({
                        sessionID: session.id,
                        attemptID: context?.attemptID,
                        headers: sent.headers,
                      }),
                    )
                  if (
                    kind === "primary" &&
                    hasOpaqueHistory &&
                    (requestDeployment === undefined ||
                      !SessionProviderContext.compatible(
                        requestDeployment,
                        url === undefined
                          ? undefined
                          : SessionProviderContext.provenance(
                              { model: request.model, ref: model.ref, connection: model.connection },
                              url,
                            ),
                      ))
                  )
                    return yield* Effect.die(
                      new Error("Provider history is incompatible with the deployment selected by HTTP request hooks"),
                    )
                  yield* recordTransport(url, "http", "unknown")
                  const res = yield* handler(sent)
                  yield* recordTransport(
                    url,
                    "http",
                    res.status >= 200 && res.status < 300
                      ? "accepted"
                      : res.status >= 400 && res.status < 500
                        ? "rejected"
                        : "unknown",
                  )
                  const gatewayReport = SessionMagpie.parseResponseHeaders(res.headers)
                  if (observe !== undefined && gatewayReport !== undefined)
                    yield* observe(
                      new SessionAttempt.Observation({
                        observedAt: yield* Clock.currentTimeMillis,
                        gatewayReport,
                      }),
                    )
                  if (before === undefined) return res
                  const after = yield* hooks.trigger("session", "http.response", {
                    ...scope,
                    request: before.request,
                    response: new Response(
                      [204, 205, 304].includes(res.status) ? null : yield* Stream.toReadableStreamEffect(res.stream),
                      { status: res.status, headers: res.headers },
                    ),
                  })
                  return HttpClientResponse.fromWeb(sent, after.response)
                }).pipe(Effect.mapError((cause) => (cause instanceof Error ? cause : new Error(String(cause)))))
            : undefined
        let handshakeURL: string | undefined
        const bound =
          input.webSocket === "session" && model.transport === "websocket"
            ? transport.bind(
                session.id,
                {
                  provenance: (url) =>
                    SessionProviderContext.provenance(
                      { model: request.model, ref: model.ref, connection: model.connection },
                      url,
                    ),
                  handshake: (connect) =>
                    hooks
                      .trigger("session", "experimental.ws.handshake", {
                        ...scope,
                        url: connect.url,
                        headers: connect.headers,
                      })
                      .pipe(
                        Effect.flatMap((event) =>
                          Effect.gen(function* () {
                            if (
                              hasOpaqueHistory &&
                              (requestDeployment === undefined ||
                                !SessionProviderContext.compatible(
                                  requestDeployment,
                                  SessionProviderContext.provenance(
                                    { model: request.model, ref: model.ref, connection: model.connection },
                                    event.url,
                                  ),
                                ))
                            )
                              return yield* Effect.die(
                                new Error(
                                  "Provider history is incompatible with the deployment selected by WebSocket handshake hooks",
                                ),
                              )
                            handshakeURL = event.url
                            return { url: event.url, headers: event.headers }
                          }),
                        ),
                      ),
                  send: (frame) =>
                    hooks
                      .trigger("session", "experimental.ws.send", { ...scope, frame })
                      .pipe(Effect.map((event) => event.frame)),
                  sent: (url) => recordTransport(url, "websocket", "ambiguous"),
                  receive: (frame) =>
                    hooks
                      .trigger("session", "experimental.ws.receive", { ...scope, frame })
                      .pipe(Effect.map((event) => event.frame)),
                },
                model.chunkTimeout,
              )
            : undefined
        const webSocket: StreamOptions["webSocket"] =
          bound === undefined || observe === undefined
            ? bound
            : {
                execute: (exchange) =>
                  Effect.gen(function* () {
                    let delivery: SessionAttempt.Delivery = "unknown"
                    return yield* bound.execute({
                      ...exchange,
                      driver: {
                        create: exchange.driver.create,
                        observe: (create, frame) =>
                          exchange.driver.observe(create, frame).pipe(
                            Effect.tap((observation) => {
                              const next = observation.type === "rejected" ? "rejected" : "accepted"
                              if (next === delivery) return Effect.void
                              delivery = next
                              return recordTransport(handshakeURL ?? exchange.connect.url, "websocket", next)
                            }),
                          ),
                      },
                    })
                  }),
              }
        return { ...(http ? { http } : {}), ...(webSocket ? { webSocket } : {}) }
      }

      const attributeGatewayAttempts: NonNullable<Prepared["attributeGatewayAttempts"]> = ({
        attemptID,
        started,
        routeID,
      }) =>
        Effect.gen(function* () {
          const baseURL = observedGatewayURL ?? request.model.route.endpoint.baseURL
          if (!baseURL) return undefined
          const rawAttempts = yield* SessionMagpie.fetchRouteTrace({
            baseURL,
            routeID,
            attemptID,
            sessionID: session.id,
            started,
          })
          if (!rawAttempts || rawAttempts.length === 0) return undefined
          const modelService = yield* Effect.serviceOption(Model.Service)
          const catalog: readonly Model.Info[] = Option.isSome(modelService) ? yield* modelService.value.all() : []
          return SessionMagpie.attributeAttempts({
            rawAttempts,
            started,
            resolveQuote: (provider, candidateModel) => {
              const fromCatalog = SessionMagpie.resolveCatalogQuote(catalog, provider, candidateModel)
              if (fromCatalog.status !== "unknown") return fromCatalog
              if (
                provider === model.ref.providerID &&
                (candidateModel === model.ref.id || candidateModel === `${model.ref.providerID}/${model.ref.id}`) &&
                model.quote !== undefined
              )
                return model.quote
              return { status: "unknown" }
            },
          })
        })

      return {
        event: shaped,
        request,
        options: optionsForAttempt(),
        optionsForAttempt,
        attributeGatewayAttempts,
        retry: (event: Parameters<Prepared["retry"]>[0]) =>
          Effect.gen(function* () {
            const updated = yield* hooks.trigger("session", "retry", { ...event, connection: model.connection })
            event.decision = updated.decision
          }),
        // Permission.assert and the question tool throw declines as defects so tools cannot
        // catch them and turn a "no" into model-visible output. Recover them here as failures.
        executeTool: (call: Parameters<Prepared["executeTool"]>[0]) =>
          tools.execute({ ...call, definitions: hooked }).pipe(
            Effect.catchCauseFilter(
              (cause) => {
                const decline = cause.reasons.flatMap((r) =>
                  Cause.isDieReason(r) &&
                  (r.defect instanceof Permission.DeclinedError || r.defect instanceof QuestionTool.CancelledError)
                    ? [r.defect]
                    : [],
                )[0]
                return decline ? Result.succeed(decline) : Result.fail(cause)
              },
              (decline) => Effect.fail(decline),
            ),
          ),
      }
    })

    const agentHook =
      (name: "context" | "compaction" | "generate", agent: Agent.ID) => (draft: SessionRequest, tools: Definitions) =>
        hooks.trigger("session", name, { ...draft, agent, tools })

    return Service.of({
      primary: (input) => prepare("primary", input, agentHook("context", input.agent)),
      compaction: (input) => prepare("compaction", input, agentHook("compaction", input.agent)),
      generate: (input) => prepare("generate", input, agentHook("generate", input.agent)),
      title: (input) => prepare("title", input, (draft) => hooks.trigger("session", "title", draft)),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [PluginHooks.node, SessionModelTransport.node, App.node, CorrectionStore.node],
})
