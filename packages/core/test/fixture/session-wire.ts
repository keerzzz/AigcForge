import {
  AIError,
  CompactionCheckpointResponse,
  CompactionResponse,
  HttpOptions,
  LLMEvent,
  LLMRequest,
} from "@omnixa/ai"
import { OpenAIResponses } from "@omnixa/ai/protocols"
import { Framing, LLMClient, Protocol, RequestExecutor, Route } from "@omnixa/ai/route"
import type {
  CheckpointRequest,
  CompactionRequest,
  EndpointCompactOptions,
  LLMClientShape,
  TriggerCompactOptions,
} from "@omnixa/ai/route"
import { TestLLM } from "@omnixa/ai/testing"
import { Context, Effect, Layer, Schema, Stream } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"

// A fixture protocol preserves scripted LLM events while the original HTTP transport and
// request observer establish the deployment. Native trigger replies use the original parser.
export const route = Route.make({
  id: "session-test-wire",
  provider: "fake",
  providerMetadataKey: "openai",
  endpoint: { baseURL: "https://session-fixture.invalid/v1", path: "/responses" },
  framing: Framing.sse,
  compact: OpenAIResponses.route.compact,
  protocol: Protocol.make({
    id: "session-test-events",
    body: {
      schema: Schema.Struct({ model: Schema.String, messages: Schema.String }),
      from: (request) =>
        Effect.succeed({ model: String(request.model.id), messages: JSON.stringify(request.messages) }),
    },
    stream: {
      event: Protocol.jsonEvent(LLMEvent),
      initial: () => undefined,
      step: (_state, event) => Effect.succeed([undefined, [event]] as const),
      terminal: (event) => LLMEvent.is.finish(event) || LLMEvent.is.providerError(event),
    },
  }),
})

const header = "x-omnixa-test-wire"

export const layer = Layer.effect(
  LLMClient.Service,
  Effect.gen(function* () {
    const scripted = yield* TestLLM.Service
    const pending = new Map<string, { request: LLMRequest; kind: "stream" | "trigger" }>()
    let next = 0
    const register = (request: LLMRequest, kind: "stream" | "trigger") => {
      const id = String(next++)
      pending.set(id, { request, kind })
      return {
        id,
        request: LLMRequest.update(request, {
          http: new HttpOptions({ ...request.http, headers: { ...request.http?.headers, [header]: id } }),
        }),
      }
    }
    const http = HttpClient.make((request) =>
      Effect.gen(function* () {
        const reply = pending.get(request.headers[header])
        if (!reply) return yield* Effect.die(new Error("Missing scripted HTTP request"))
        if (reply.kind === "trigger") {
          if (!LLMClient.canCompact(reply.request, { mechanism: "trigger" }))
            return yield* Effect.die(new Error("The fixture request cannot trigger native compaction"))
          const response = yield* scripted.client.compact(reply.request, { mechanism: "trigger" }).pipe(Effect.orDie)
          return HttpClientResponse.fromWeb(
            request,
            new Response(
              `data: ${JSON.stringify({
                type: "response.completed",
                response: {
                  id: response.responseID,
                  status: "completed",
                  output: [
                    {
                      type: "compaction",
                      id: response.checkpoint.id ?? `${response.responseID}_checkpoint`,
                      encrypted_content: response.checkpoint.encrypted,
                    },
                  ],
                },
              })}\n\n`,
              { headers: { "content-type": "text/event-stream" } },
            ),
          )
        }
        const body = yield* Stream.toReadableStreamEffect(
          Stream.suspend(() => {
            let terminal = false
            return scripted.client.stream(reply.request).pipe(
              Stream.tap((event) =>
                Effect.sync(() => {
                  terminal ||= LLMEvent.is.finish(event) || LLMEvent.is.providerError(event)
                }),
              ),
              Stream.concat(
                Stream.suspend(() =>
                  terminal ? Stream.empty : Stream.make(LLMEvent.finish({ reason: { normalized: "stop" } })),
                ),
              ),
              Stream.map((event) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)),
            )
          }),
        )
        return HttpClientResponse.fromWeb(
          request,
          new Response(body, { headers: { "content-type": "text/event-stream" } }),
        )
      }),
    )
    const original = Context.get(
      yield* Layer.build(
        LLMClient.layer.pipe(
          Layer.provide(RequestExecutor.layer.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, http)))),
        ),
      ),
      LLMClient.Service,
    )
    const stream: LLMClientShape["stream"] = (request, options) =>
      Stream.unwrap(
        Effect.sync(() => {
          const sent = register(request, "stream")
          return original
            .stream(sent.request, options)
            .pipe(Stream.ensuring(Effect.sync(() => pending.delete(sent.id))))
        }),
      )
    function compact(
      request: CompactionRequest,
      options?: EndpointCompactOptions,
    ): Effect.Effect<CompactionResponse, AIError>
    function compact(
      request: CheckpointRequest,
      options: TriggerCompactOptions,
    ): Effect.Effect<CompactionCheckpointResponse, AIError>
    function compact(request: LLMRequest, options?: EndpointCompactOptions | TriggerCompactOptions) {
      return Effect.suspend((): Effect.Effect<CompactionResponse | CompactionCheckpointResponse, AIError> => {
        if (options?.mechanism !== "trigger")
          return Effect.die(new Error("The wire fixture uses native trigger compaction"))
        const sent = register(request, "trigger")
        if (!LLMClient.canCompact(sent.request, { mechanism: "trigger" }))
          return Effect.die(new Error("The wire fixture cannot trigger native compaction"))
        return original.compact(sent.request, options).pipe(Effect.ensuring(Effect.sync(() => pending.delete(sent.id))))
      })
    }
    const generate: LLMClientShape["generate"] = (request, options) =>
      Effect.suspend(() => {
        const sent = register(request, "stream")
        return original
          .generate(sent.request, options)
          .pipe(Effect.ensuring(Effect.sync(() => pending.delete(sent.id))))
      })
    return LLMClient.Service.of({ stream, generate, compact })
  }),
)

export * as SessionWire from "./session-wire"
