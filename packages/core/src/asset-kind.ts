export * as AssetKind from "./asset-kind"

import { Context, Effect, Layer, Schema } from "effect"
import { Asset } from "@aigcfroge/schema/asset"
import {
  PromptAsset,
  SkillAsset,
  MCPAsset,
  CommandAsset,
  AgentAsset,
  WorkflowAsset,
  PluginAsset,
  CustomProfile,
} from "@aigcfroge/schema"

import {
  AGENTS_DIR,
  COMMANDS_DIR,
  CUSTOM_PROFILES_DIR,
  MCPS_DIR,
  PLUGINS_DIR,
  PROMPTS_DIR,
  SKILLS_DIR,
  WORKFLOWS_DIR,
} from "./constants"

export interface AssetKindDef<K extends Asset.AssetKindId = Asset.AssetKindId> {
  readonly id: K
  readonly schema: {
    readonly Summary: Schema.Top
    readonly Info: Schema.Top
  }
  readonly ownerDir: string
}

export interface AssetKindRegistryInterface {
  readonly register: (def: AssetKindDef) => Effect.Effect<void, Asset.AssetError>
  readonly resolve: (kind: string) => Effect.Effect<AssetKindDef, Asset.AssetError>
  readonly list: () => ReadonlyArray<Asset.AssetKindId>
}

export class Service extends Context.Service<Service, AssetKindRegistryInterface>()(
  "@aigcfroge/v2/AssetKindRegistry",
) {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const kinds = new Map<string, AssetKindDef>()

    const defaultDefs: AssetKindDef[] = [
      { id: "prompt", schema: { Summary: PromptAsset.Summary, Info: PromptAsset.Info }, ownerDir: PROMPTS_DIR },
      { id: "skill", schema: { Summary: SkillAsset.Summary, Info: SkillAsset.Info }, ownerDir: SKILLS_DIR },
      { id: "mcp", schema: { Summary: MCPAsset.Summary, Info: MCPAsset.Info }, ownerDir: MCPS_DIR },
      { id: "command", schema: { Summary: CommandAsset.Summary, Info: CommandAsset.Info }, ownerDir: COMMANDS_DIR },
      { id: "agent", schema: { Summary: AgentAsset.Summary, Info: AgentAsset.Info }, ownerDir: AGENTS_DIR },
      { id: "workflow", schema: { Summary: WorkflowAsset.Summary, Info: WorkflowAsset.Info }, ownerDir: WORKFLOWS_DIR },
      { id: "plugin", schema: { Summary: PluginAsset.Summary, Info: PluginAsset.Info }, ownerDir: PLUGINS_DIR },
      {
        id: "custom-profile",
        schema: { Summary: CustomProfile.Summary, Info: CustomProfile.Info },
        ownerDir: CUSTOM_PROFILES_DIR,
      },
    ]

    for (const def of defaultDefs) {
      kinds.set(def.id, def)
    }

    const register = Effect.fn("AssetKindRegistry.register")(function* (def: AssetKindDef) {
      if (kinds.has(def.id)) {
        return yield* new Asset.AssetError({
          kind: def.id,
          reason: "name_conflict",
          message: `Asset kind already registered: ${def.id}`,
        })
      }
      kinds.set(def.id, def)
    })

    const resolve = Effect.fn("AssetKindRegistry.resolve")(function* (kind: string) {
      const def = kinds.get(kind)
      if (!def) {
        return yield* new Asset.AssetError({
          kind,
          reason: "unknown_kind",
          message: `Unknown asset kind: ${kind}`,
        })
      }
      return def
    })

    const list = () => Array.from(kinds.keys()) as Asset.AssetKindId[]

    return Service.of({ register, resolve, list } satisfies AssetKindRegistryInterface)
  }),
)
