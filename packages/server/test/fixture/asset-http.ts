import { mkdir } from "node:fs/promises"
import path from "node:path"
import { LanguageModel, LLMClient } from "@aigcfroge/ai"
import { OpenAIChat } from "@aigcfroge/ai/protocols"
import { TestLLM } from "@aigcfroge/ai/testing"
import { Bus } from "@aigcfroge/core/bus"
import { Database } from "@aigcfroge/core/database/database"
import { LayerNodePlatform } from "@aigcfroge/core/effect/app-node-platform"
import { Watcher } from "@aigcfroge/core/filesystem/watcher"
import { Location } from "@aigcfroge/core/location"
import { LocationServiceMap } from "@aigcfroge/core/location-services"
import { Model } from "@aigcfroge/core/model"
import { Plugin } from "@aigcfroge/core/plugin"
import { Session } from "@aigcfroge/core/session"
import { SessionRunnerModel } from "@aigcfroge/core/session/runner/model"
import { Global } from "@aigcfroge/util/global"
import { Context, Effect, Layer, Option, Stream } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tempGlobalLayer } from "../../../core/test/fixture/global"
import { tmpdirScoped } from "../../../core/test/fixture/tmpdir"
import { locationRefForRoute } from "../../src/middleware/workspace-routing"
import { createRoutes } from "../../src/routes"

// Share only real HTTP/runtime bootstrapping. Asset schemas, native readers and assertions stay with each suite.
export const setup = Effect.fnUntraced(function* (input: {
  prefix: string
  assetDirectory: string
  model: Model.Ref
  files: readonly { relativePath: string; content: string }[]
  prepare?: (directory: string) => Promise<void>
  watcher?: Layer.Layer<Watcher.Service>
}) {
  const temporary = yield* tmpdirScoped(input.prefix)
  const directory = path.join(temporary.path, "project")
  const other = path.join(temporary.path, "other")
  yield* Effect.promise(() =>
    Promise.all([directory, other].map((item) => mkdir(path.join(item, input.assetDirectory), { recursive: true }))),
  )
  yield* Effect.forEach(input.files, (file) =>
    Effect.promise(() => Bun.write(path.join(directory, input.assetDirectory, file.relativePath), file.content)),
  )
  const prepare = input.prepare
  if (prepare) yield* Effect.promise(() => prepare(directory))
  const llm = Context.get(yield* Layer.build(TestLLM.testLayer()), TestLLM.Test)
  const context = yield* Layer.build(
    createRoutes(
      {
        password: "secret",
        app: { version: "test" },
        database: { path: ":memory:" },
        events: { persist: true },
        config: { directory: path.join(temporary.path, "config"), project: true, content: "{}" },
        models: { fetch: false },
        fs: { filewatcher: true },
      },
      () => [],
      [
        Global.node.replace(tempGlobalLayer),
        ...(input.watcher ? [Watcher.node.replace(input.watcher)] : []),
        LayerNodePlatform.llmClient.replace(Layer.succeed(LLMClient.Service, llm)),
        SessionRunnerModel.node.replace(
          Layer.succeed(SessionRunnerModel.Service, {
            resolve: () =>
              Effect.succeed(
                SessionRunnerModel.resolved(
                  LanguageModel.make({ id: input.model.id, provider: input.model.providerID, route: OpenAIChat.route }),
                  {
                    capabilities: { tools: true, input: ["text"], output: ["text"] },
                    cost: [],
                    limit: { context: 200_000, output: 32_000 },
                  },
                ),
              ),
          }),
        ),
      ],
    ).pipe(Layer.provide(HttpServer.layerServices)),
  )
  const handler = Context.get(context, HttpRouter.HttpRouter).asHttpEffect().pipe(HttpEffect.toWebHandlerWith(context))
  const locations = Context.get(context, LocationServiceMap.Service)
  const local = yield* locations.contextEffect(locationRefForRoute({ directory }))
  yield* Plugin.awaitActivation.pipe(Effect.provideContext(local))
  const second = yield* locations.contextEffect(locationRefForRoute({ directory: other }))
  yield* Plugin.awaitActivation.pipe(Effect.provideContext(second))
  const request = (
    route: string,
    options: {
      body?: unknown
      directory?: string
      authenticated?: boolean
      method?: "GET" | "POST" | "PATCH" | "DELETE"
    } = {},
  ) =>
    Effect.promise(() => {
      const url = new URL(route, "http://aigcfroge.local")
      url.searchParams.set(
        route.startsWith("/api/") ? "location[directory]" : "directory",
        options.directory ?? directory,
      )
      return handler(
        new Request(url, {
          method: options.method ?? (options.body === undefined ? "GET" : "POST"),
          headers: {
            "content-type": "application/json",
            ...(options.authenticated === false ? {} : { authorization: `Basic ${btoa("aigcfroge:secret")}` }),
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        }),
      )
    })
  return {
    directory,
    other,
    local,
    locations,
    llm,
    handler,
    request,
    global: Context.get(context, Global.Service),
    sessions: Context.get(context, Session.Service),
    bus: Context.get(context, Bus.Service),
    database: Context.get(context, Database.Service),
  }
})

export type WatchedSubscription = {
  generation: number
  location: Location.Ref | undefined
  input: Watcher.WatchInput
}

export type WatchObservation =
  | { phase: "acquire-request" | "ready" | "release"; subscription: WatchedSubscription }
  | { phase: "event"; subscription: WatchedSubscription; update: Watcher.Update }

export function observeWatchers(onObservation?: (observation: WatchObservation) => void) {
  const sequence = { value: 0 }
  const active = new Set<WatchedSubscription>()
  const events: { subscription: WatchedSubscription; update: Watcher.Update }[] = []
  const layer = Layer.effect(
    Watcher.Service,
    Effect.gen(function* () {
      const service = yield* Watcher.Service
      return Watcher.Service.of({
        subscribe: (input, onReady) =>
          Effect.gen(function* () {
            // Capture the caller before the stream moves into its consumer fiber.
            const caller = Option.getOrUndefined(yield* Effect.serviceOption(Location.Service))
            const subscription: WatchedSubscription = {
              generation: ++sequence.value,
              location: caller
                ? Location.Ref.make({ directory: caller.directory, workspaceID: caller.workspaceID })
                : undefined,
              input,
            }
            yield* Effect.sync(() => onObservation?.({ phase: "acquire-request", subscription }))
            const stream = yield* service.subscribe(
              input,
              (onReady ?? Effect.void).pipe(
                Effect.andThen(
                  Effect.sync(() => {
                    active.add(subscription)
                    onObservation?.({ phase: "ready", subscription })
                  }),
                ),
              ),
            )
            return stream.pipe(
              Stream.tap((update) =>
                Effect.sync(() => {
                  events.push({ subscription, update })
                  onObservation?.({ phase: "event", subscription, update })
                }),
              ),
              Stream.ensuring(
                Effect.sync(() => {
                  active.delete(subscription)
                  onObservation?.({ phase: "release", subscription })
                }),
              ),
            )
          }),
      })
    }),
  ).pipe(Layer.provide(Watcher.layer().pipe(Layer.provide(Watcher.nativeLayer))))
  return { layer, active, events }
}

export * as AssetHttpFixture from "./asset-http"
