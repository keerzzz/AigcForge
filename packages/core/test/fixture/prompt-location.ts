import type { FileSystem } from "@omnixa/core/filesystem"
import { Bus } from "@omnixa/core/bus"
import { Image } from "@omnixa/core/image"
import { LocationServiceMap } from "@omnixa/core/location-service-map"
import type { LocationServices } from "@omnixa/core/location-services"
import { Plugin } from "@omnixa/core/plugin"
import { Model } from "@omnixa/core/model"
import { ModelResolver } from "@omnixa/core/model-resolver"
import { Provider } from "@omnixa/core/provider"
import { Agent } from "@omnixa/core/agent"
import { Npm } from "@omnixa/util/npm"
import { PluginHooks } from "@omnixa/core/plugin/hooks"
import { Skill } from "@omnixa/core/skill"
import type { Location } from "@omnixa/schema/location"
import { makeGlobalNode } from "@omnixa/util/effect/app-node"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { Effect, Layer, LayerMap } from "effect"

// Plain-prompt unit fixtures use virtual directories.
export const promptLocationNode = makeGlobalNode({
  service: LocationServiceMap.Service,
  layer: Layer.effect(
    LocationServiceMap.Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      return yield* LayerMap.make(
        (_ref: Location.Ref) =>
          LayerNode.compile(
            LayerNode.group([
              PluginHooks.node,
              Image.node,
              Skill.node,
              Plugin.node,
              ModelResolver.node,
              Model.node,
              Agent.node,
            ]),
            {
              replacements: [
                Bus.node.replace(Layer.succeed(Bus.Service, bus)),
                Plugin.node.replace(Layer.mock(Plugin.Service, { awaitActivation: Effect.void })),
                Model.node.replace(
                  Layer.mock(Model.Service, {
                    selection: () => Effect.succeed(Model.Ref.parse("test/cpu")),
                    available: () =>
                      Effect.succeed([
                        {
                          ...Model.Info.default(Provider.ID.make("test"), Model.ID.make("cpu")),
                          package: "@omnixa/ai/providers/openai",
                          settings: { baseURL: "http://offline.invalid", apiKey: "offline" },
                        },
                      ]),
                    default: () =>
                      Effect.succeed({
                        ...Model.Info.default(Provider.ID.make("test"), Model.ID.make("cpu")),
                        package: "@omnixa/ai/providers/openai",
                        settings: { baseURL: "http://offline.invalid", apiKey: "offline" },
                      }),
                    get: (providerID, modelID) =>
                      Effect.succeed(
                        providerID === "test" && modelID === "cpu"
                          ? {
                              ...Model.Info.default(providerID, modelID),
                              package: "@omnixa/ai/providers/openai",
                              settings: { baseURL: "http://offline.invalid", apiKey: "offline" },
                            }
                          : undefined,
                      ),
                  }),
                ),
                Agent.node.replace(
                  Layer.mock(Agent.Service, {
                    get: (id) => Effect.succeed(virtualAgent(id)),
                    select: (id) => {
                      const selected = id === undefined ? Agent.defaultID : Agent.ID.make(id)
                      return Effect.succeed({ id: selected, info: virtualAgent(selected) })
                    },
                  }),
                ),
                Provider.node.replace(Layer.mock(Provider.Service, { get: () => Effect.succeed(undefined) })),
                Npm.node.replace(Layer.mock(Npm.Service, {})),
              ],
            },
          ) as unknown as Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError>,
      )
    }),
  ),
  deps: [Bus.node],
})

function virtualAgent(id: Agent.ID) {
  if (!["meta", "build", "explore"].includes(id)) return
  return { ...Agent.Info.default(id), mode: id === "meta" ? "primary" : "all" } satisfies Agent.Info
}
