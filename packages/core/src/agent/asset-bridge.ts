export * as AgentAssetBridge from "./asset-bridge"

import { AssetYaml } from "../util/asset-yaml"
import path from "path"
import { Effect, Layer, Option, Schema, Scope, Stream } from "effect"
import { Model } from "../model.js"
import { Agent } from "../agent"
import { AgentAsset } from "../agent-asset"
import { ConfigAgent } from "@aigcfroge/schema/config/agent"
import { Bus } from "../bus"
import { Watcher } from "../filesystem/watcher"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { Location } from "../location"
import { AGENTS_DIR } from "../constants"
import { AgentProtocol } from "./protocol.js"
import { isRecord } from "@aigcfroge/ai/utils/record"

export function parseAgentAssetConfig(rawConfig?: string): ConfigAgent.Info | undefined {
  if (!rawConfig) return undefined
  const trimmed = rawConfig.trim()
  if (!trimmed) return undefined

  let parsed: unknown
  try {
    parsed = AssetYaml.parse(trimmed)
  } catch {
    return undefined
  }

  if (!isRecord(parsed)) return undefined

  const normalized = AgentProtocol.normalizeDefinition(parsed)
  const decoded = Schema.decodeUnknownOption(ConfigAgent.Info)({
    ...normalized.definition,
    ...(normalized.card === undefined ? {} : { card: normalized.card }),
  })
  return Option.getOrUndefined(decoded)
}

export function agentAssetToAgentInfo(asset: AgentAsset.Info): Agent.Info | undefined {
  // Invariant: AgentAsset cannot replace the root built-in meta agent.
  // Collisions with any other already-registered agent are rejected by
  // registerAgentAssetTransform, which is the enforcement point.
  if (asset.name === "meta") return undefined

  const id = Agent.ID.make(asset.name)
  const config = parseAgentAssetConfig(asset.config)
  if (asset.config.trim() && config === undefined) return undefined

  const defaults = Agent.Info.empty(id)
  return {
    ...defaults,
    request: {
      ...defaults.request,
      headers: { ...defaults.request.headers, ...config?.request?.headers },
      body: { ...defaults.request.body, ...config?.request?.body },
    },
    description: asset.description,
    ...(config?.card === undefined ? {} : { card: config.card }),
    system: asset.source.trim() || undefined,
    model: config?.model === undefined ? undefined : Model.fromConfig(config.model),
    mode: config?.mode ?? "all",
    hidden: config?.hidden ?? false,
    color: config?.color,
    steps: config?.steps,
    permissions: config?.permissions ? Array.from(config.permissions) : [],
    // D13 (S3): read handoffs from the asset itself (AgentAsset.Info.handoffs,
    // surfaced by the loader from config YAML and/or top-level frontmatter),
    // falling back to the config parse for callers with stale in-memory assets.
    handoffs: Array.from(asset.handoffs ?? config?.handoffs ?? []),
    originKind: "user",
    originRelativePath: asset.relativePath,
    originRevision: asset.revision,
  }
}

export const registerAgentAssetTransform = (
  agents: Agent.Interface,
  assetRegistry: AgentAsset.Interface,
): Effect.Effect<void, never, Scope.Scope> =>
  agents
    .transform((draft) => {
      // Base State transforms are synchronous void callbacks, so the registry read
      // cannot yield. `AgentAsset.list` is an in-memory snapshot with no
      // requirements, so running it synchronously keeps the fork's
      // fresh-assets-per-rebuild semantics without introducing an async seam.
      const assetList = Effect.runSync(assetRegistry.list())
      for (const asset of assetList) {
        const info = agentAssetToAgentInfo(asset)
        if (!info) continue
        // An Agent Asset may only contribute a NEW candidate. Transforms replay
        // over one shared draft, so a plain `Object.assign` lets a user/LLM
        // authored asset replace an already-registered agent wholesale —
        // including built-in fail-closed permission rulesets (chat-orchestrator,
        // build, plan, …). Name collision must never be an override path.
        if (draft.get(info.id) !== undefined) {
          Effect.runSync(
            Effect.logWarning("Ignoring agent asset that collides with an existing agent", {
              agent: info.id,
              relativePath: asset.relativePath,
            }),
          )
          continue
        }
        draft.update(info.id, (item) => {
          Object.assign(item, info)
        })
      }
    })
    .pipe(Effect.asVoid)

export const refreshAgentAssets = (agents: Agent.Interface, assetRegistry: AgentAsset.Interface) =>
  assetRegistry.reload().pipe(Effect.andThen(agents.reload()))

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const assetRegistry = yield* AgentAsset.Service
    yield* registerAgentAssetTransform(agents, assetRegistry)
    const events = yield* Bus.Service
    const location = yield* Location.Service
    const scope = yield* Scope.Scope
    const ownerRoot = path.resolve(location.directory, AGENTS_DIR)
    yield* events.subscribe(Watcher.Event.Updated).pipe(
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
