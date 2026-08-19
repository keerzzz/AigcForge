export * as AgentAssetBridge from "./asset-bridge"

import yaml from "js-yaml"
import path from "path"
import { Effect, Layer, Option, Schema, Scope, Stream } from "effect"
import { Agent } from "@aigcfroge/schema/agent"
import { Model } from "@aigcfroge/schema/model"
import { AgentV2 } from "../agent"
import { AgentAsset } from "../agent-asset"
import { ConfigAgent } from "../config/agent"
import { ModelV2 } from "../model"
import { EventV2 } from "../event"
import { Watcher } from "../filesystem/watcher"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { AGENTS_DIR } from "../constants"

export function parseAgentAssetConfig(rawConfig?: string): ConfigAgent.Info | undefined {
  if (!rawConfig) return undefined
  const trimmed = rawConfig.trim()
  if (!trimmed) return undefined

  let parsed: unknown
  try {
    parsed = yaml.load(trimmed)
  } catch {
    return undefined
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined
  }

  const decoded = Schema.decodeUnknownOption(ConfigAgent.Info)(parsed)
  return Option.getOrUndefined(decoded)
}

export function agentAssetToAgentInfo(asset: AgentAsset.Info): AgentV2.Info | undefined {
  // Invariant: AgentAsset cannot replace the root built-in meta agent.
  // Collisions with any other already-registered agent are rejected by
  // registerAgentAssetTransform, which is the enforcement point.
  if (asset.name === "meta") return undefined

  const id = Agent.ID.make(asset.name)
  const config = parseAgentAssetConfig(asset.config)

  let modelRef: Model.Ref | undefined
  if (config?.model) {
    const parsed = ModelV2.parse(config.model)
    modelRef = {
      id: parsed.modelID,
      providerID: parsed.providerID,
      variant: config.variant ? Model.VariantID.make(config.variant) : undefined,
    }
  }

  return {
    ...Agent.Info.empty(id),
    description: asset.description,
    system: asset.source.trim() || undefined,
    model: modelRef,
    mode: config?.mode ?? "all",
    hidden: config?.hidden ?? false,
    color: config?.color,
    steps: config?.steps,
    permissions: config?.permissions ? Array.from(config.permissions) : [],
    handoffs: config?.handoffs ? Array.from(config.handoffs) : [],
  }
}

export const registerAgentAssetTransform = (
  agents: AgentV2.Interface,
  assetRegistry: AgentAsset.Interface,
): Effect.Effect<void, never, Scope.Scope> =>
  agents.transform((draft) =>
    Effect.gen(function* () {
      const assetList = yield* assetRegistry.list()
      for (const asset of assetList) {
        const info = agentAssetToAgentInfo(asset)
        if (!info) continue
        // An Agent Asset may only contribute a NEW candidate. Transforms replay
        // over one shared draft, so a plain `Object.assign` lets a user/LLM
        // authored asset replace an already-registered agent wholesale —
        // including built-in fail-closed permission rulesets (chat-orchestrator,
        // build, plan, …). Name collision must never be an override path.
        if (draft.get(info.id) !== undefined) {
          yield* Effect.logWarning("Ignoring agent asset that collides with an existing agent", {
            agent: info.id,
            relativePath: asset.relativePath,
          })
          continue
        }
        draft.update(info.id, (item) => {
          Object.assign(item, info)
        })
      }
    }),
  ).pipe(Effect.asVoid)

export const refreshAgentAssets = (agents: AgentV2.Interface, assetRegistry: AgentAsset.Interface) =>
  assetRegistry.reload().pipe(Effect.andThen(agents.reload()))

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const agents = yield* AgentV2.Service
    const assetRegistry = yield* AgentAsset.Service
    yield* registerAgentAssetTransform(agents, assetRegistry)
    const events = yield* EventV2.Service
    const location = yield* Location.Service
    const scope = yield* Scope.Scope
    const ownerRoot = path.resolve(location.directory, AGENTS_DIR)
    yield* events
      .subscribe(Watcher.Event.Updated)
      .pipe(
        Stream.filter((event) => FSUtil.contains(ownerRoot, event.data.file) && event.data.file.endsWith(".md")),
        Stream.runForEach(() =>
          refreshAgentAssets(agents, assetRegistry).pipe(
            Effect.catch((error) =>
              Effect.logWarning("Failed to refresh AgentV2 from Agent assets", {
                errorTag: "_tag" in error ? error._tag : "filesystem_error",
              }),
            ),
          ),
        ),
        Effect.forkIn(scope),
      )
  }),
)
