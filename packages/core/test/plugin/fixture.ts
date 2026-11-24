import { Agent } from "@omnixa/core/agent"
import { AISDK } from "@omnixa/core/aisdk"
import { Command } from "@omnixa/core/command"
import { Config } from "@omnixa/core/config"
import { CorrectionStore } from "@omnixa/core/session/correction-store"
import { Credential } from "@omnixa/core/credential"
import { Database } from "@omnixa/core/database/database"
import { FileAccess } from "@omnixa/core/file-access"
import { LayerNodePlatform } from "@omnixa/util/effect/app-node-platform"
import { AppProcess } from "@omnixa/util/process"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { Bus } from "@omnixa/core/bus"
import { FileSystem } from "@omnixa/core/filesystem"
import { FSUtil } from "@omnixa/util/fs-util"
import { Form } from "@omnixa/core/form"
import { Generate } from "@omnixa/core/generate"
import { Integration } from "@omnixa/core/integration"
import { KV } from "@omnixa/core/kv"
import { Location } from "@omnixa/core/location"
import { ManagedPolicy } from "@omnixa/core/managed-policy"
import { Mcp } from "@omnixa/core/mcp/index"
import { Model } from "@omnixa/core/model"
import { Npm } from "@omnixa/util/npm"
import { Plugin } from "@omnixa/core/plugin"
import { PluginHooks } from "@omnixa/core/plugin/hooks"
import { Provider } from "@omnixa/core/provider"
import { Session } from "@omnixa/core/session"
import { SessionComposition } from "@omnixa/core/session/composition"
import { PersistentPty } from "@omnixa/core/persistent-pty"
import { LocationServiceMap } from "@omnixa/core/location-service-map"
import { AppNodeBuilder } from "@omnixa/core/effect/app-node-builder"
import { Permission } from "@omnixa/core/permission"
import { Reference } from "@omnixa/core/reference"
import { Rpc } from "@omnixa/core/rpc"
import { Skill } from "@omnixa/core/skill"
import { SkillDiscovery } from "@omnixa/core/skill/discovery"
import { Watcher } from "@omnixa/core/filesystem/watcher"
import { Tool } from "@omnixa/core/tool"
import { Vcs } from "@omnixa/core/vcs"
import { WebSearch } from "@omnixa/core/websearch"
import { Worktree } from "@omnixa/core/worktree"
import { WorktreeStrategies } from "@omnixa/core/worktree/strategies"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"
import { emptyMcpLayer } from "../fixture/mcp"
import { offlineModels } from "../fixture/models"

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: (name) => Effect.succeed({ directory: "", name }),
    resolve: (name) => Effect.succeed({ directory: "", name }),
    check: () => Effect.succeed(false),
    update: (name) => Effect.succeed({ directory: "", name }),
    which: () => Effect.undefined,
  }),
)

const generateLayer = Layer.succeed(Generate.Service, Generate.Service.of({ text: () => Effect.succeed("") }))

const configLayer = Config.testLayer()

const permissionLayer = Layer.succeed(
  Permission.Service,
  Permission.Service.of({
    close: Effect.void,
    ask: (input) => Effect.succeed({ id: input.id ?? Permission.ID.create(), effect: "ask" }),
    assert: () => Effect.void,
    reply: () => Effect.void,
    get: () => Effect.succeed(undefined),
    forSession: () => Effect.succeed([]),
    effectiveRules: () => Effect.succeed([]),
    list: () => Effect.succeed([]),
  }),
)

export const makePluginTestLayerWith = <A, E>(roots: LayerNode.Graph<A, E>, permission = permissionLayer) =>
  AppNodeBuilder.build(
    LayerNode.group([
      AppProcess.node,
      FileSystem.node,
      FSUtil.node,
      Location.node,
      Npm.node,
      Credential.node,
      Config.node,
      CorrectionStore.node,
      Database.node,
      FileAccess.node,
      Bus.node,
      Form.node,
      Generate.node,
      LayerNodePlatform.httpClient,
      Plugin.node,
      Agent.node,
      AISDK.node,
      Provider.node,
      Model.node,
      Command.node,
      Integration.node,
      KV.node,
      ManagedPolicy.node,
      Mcp.node,
      Session.node,
      SessionComposition.node,
      PersistentPty.node,
      LocationServiceMap.node,
      Permission.node,
      PluginHooks.node,
      Reference.node,
      Rpc.node,
      Skill.node,
      SkillDiscovery.node,
      Tool.node,
      Vcs.node,
      Watcher.node,
      WebSearch.node,
      Worktree.node,
      WorktreeStrategies.node,
      roots,
    ]),
    [
      offlineModels,
      Location.node.replace(tempLocationLayer),
      Npm.node.replace(npmLayer),
      Config.node.replace(configLayer),
      Mcp.node.replace(emptyMcpLayer),
      Generate.node.replace(generateLayer),
      Permission.node.replace(permission),
    ],
  ).pipe(Layer.provideMerge(configLayer))

export const makePluginTestLayer = (permission = permissionLayer) =>
  makePluginTestLayerWith(LayerNode.group([]), permission)

export const PluginTestLayer = makePluginTestLayer()
