import { Agent } from "@aigcfroge/core/agent"
import { AISDK } from "@aigcfroge/core/aisdk"
import { Command } from "@aigcfroge/core/command"
import { Config } from "@aigcfroge/core/config"
import { CorrectionStore } from "@aigcfroge/core/session/correction-store"
import { Credential } from "@aigcfroge/core/credential"
import { Database } from "@aigcfroge/core/database/database"
import { FileAccess } from "@aigcfroge/core/file-access"
import { LayerNodePlatform } from "@aigcfroge/util/effect/app-node-platform"
import { AppProcess } from "@aigcfroge/util/process"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Bus } from "@aigcfroge/core/bus"
import { FileSystem } from "@aigcfroge/core/filesystem"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { Form } from "@aigcfroge/core/form"
import { Generate } from "@aigcfroge/core/generate"
import { Integration } from "@aigcfroge/core/integration"
import { KV } from "@aigcfroge/core/kv"
import { Location } from "@aigcfroge/core/location"
import { ManagedPolicy } from "@aigcfroge/core/managed-policy"
import { Mcp } from "@aigcfroge/core/mcp/index"
import { Model } from "@aigcfroge/core/model"
import { Npm } from "@aigcfroge/util/npm"
import { Plugin } from "@aigcfroge/core/plugin"
import { PluginHooks } from "@aigcfroge/core/plugin/hooks"
import { Provider } from "@aigcfroge/core/provider"
import { Session } from "@aigcfroge/core/session"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { PersistentPty } from "@aigcfroge/core/persistent-pty"
import { LocationServiceMap } from "@aigcfroge/core/location-service-map"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { Permission } from "@aigcfroge/core/permission"
import { Reference } from "@aigcfroge/core/reference"
import { Rpc } from "@aigcfroge/core/rpc"
import { Skill } from "@aigcfroge/core/skill"
import { SkillDiscovery } from "@aigcfroge/core/skill/discovery"
import { Watcher } from "@aigcfroge/core/filesystem/watcher"
import { Tool } from "@aigcfroge/core/tool"
import { Vcs } from "@aigcfroge/core/vcs"
import { WebSearch } from "@aigcfroge/core/websearch"
import { Worktree } from "@aigcfroge/core/worktree"
import { WorktreeStrategies } from "@aigcfroge/core/worktree/strategies"
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
