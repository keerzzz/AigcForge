import { Database } from "@aigcfroge/core/database/database"
import { V1Migration } from "@aigcfroge/core/database/v1-migration"
import { App } from "@aigcfroge/core/app"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Node } from "@aigcfroge/util/effect/app-node"
import { httpClient } from "@aigcfroge/util/effect/app-node-platform"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { Bus } from "@aigcfroge/core/bus"
import { DelegationService } from "@aigcfroge/core/delegation/service"
import { DelegationExecution } from "@aigcfroge/core/delegation/execution"
import { MetaAgentMemory } from "@aigcfroge/core/agent/meta/memory"
import { MetaAgentService } from "@aigcfroge/core/meta-agent/service"
import { Flag } from "@aigcfroge/core/flag/flag"
import { EventLogger } from "@aigcfroge/core/event-logger"
import { FileSystemSearch } from "@aigcfroge/core/filesystem/search"
import { Credential } from "@aigcfroge/core/credential"
import { Config } from "@aigcfroge/core/config"
import { PermissionSaved } from "@aigcfroge/core/permission/saved"
import { ApprovalPresence } from "@aigcfroge/core/permission/approval-presence"
import { PtyTicket } from "@aigcfroge/core/pty/ticket"
import { PersistentPty } from "@aigcfroge/core/persistent-pty"
import { Project } from "@aigcfroge/core/project"
import { Worktree } from "@aigcfroge/core/worktree"
import { Session } from "@aigcfroge/core/session"
import { SessionTask } from "@aigcfroge/core/session/task"
import { SessionGoal } from "@aigcfroge/core/session/goal"
import { SessionShareV2 } from "@aigcfroge/core/session/share-v2"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { ScheduleService } from "@aigcfroge/core/session/schedule-service"
import { ScheduleExecution } from "@aigcfroge/core/session/schedule-execution"
import { SessionTodo } from "@aigcfroge/core/session/todo"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { WorkflowRun } from "@aigcfroge/core/workflow/workflow-run"
import { WorkflowExecution } from "@aigcfroge/core/workflow/execution"
import { Instance } from "@aigcfroge/core/instance/service"
import { SessionTransfer } from "@aigcfroge/core/session/transfer"
import { ShellSelect } from "@aigcfroge/core/shell/select"
import { Job } from "@aigcfroge/core/job"
import { Mcp } from "@aigcfroge/core/mcp/index"
import { Global } from "@aigcfroge/util/global"
import { InstructionDiscovery } from "@aigcfroge/core/instruction-discovery"
import { LocationServiceMap } from "@aigcfroge/core/location-service-map"
import { LocationActivity } from "@aigcfroge/core/location-activity"
import { ModelsDev } from "@aigcfroge/core/models-dev"
import { SessionRestart } from "@aigcfroge/core/session/execution/restart"
import { PluginUpdate } from "@aigcfroge/core/plugin/update"
import { SdkPlugins } from "@aigcfroge/core/plugin/sdk"
import { WellKnown } from "@aigcfroge/core/wellknown"
import { Workspace } from "@aigcfroge/core/workspace"
import { Watcher } from "@aigcfroge/core/filesystem/watcher"
import { HttpRouter } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Context, Effect, Layer, Option } from "effect"
import { Api } from "./api"
import { ServerAuth } from "./auth"
import { CorsConfig } from "./cors"
import { handlers } from "./handlers"
import { authorizationLayer } from "./middleware/authorization"
import { schemaErrorLayer } from "./middleware/schema-error"
import { instanceContextLayer, workspaceRoutingLayer } from "./middleware/workspace-routing"
import { ptyConnectStubLayer } from "./middleware/pty-connect"
import { PtyEnvironment } from "./pty-environment"
import { ServerPairing } from "./pairing"
import { layer } from "./location"
import { formLocationLayer } from "./middleware/form-location"
import { sessionLocationLayer } from "./middleware/session-location"
import { ServerInfo } from "./server-info"
import type { ServerOptions } from "./options"

const applicationServiceNodes = [
  Global.node,
  Database.node,
  Bus.node,
  DelegationService.node,
  DelegationExecution.node,
  MetaAgentMemory.node,
  MetaAgentService.node,
  EventLogger.node,
  httpClient,
  Job.node,
  Project.node,
  Worktree.node,
  Session.node,
  SessionComposition.node,
  SessionTask.node,
  SessionGoal.node,
  SessionShareV2.node,
  SessionExecution.node,
  ScheduleService.node,
  ScheduleService.deliveryNode,
  ScheduleExecution.node,
  SessionTodo.node,
  WorkflowRun.node,
  WorkflowExecution.node,
  Instance.node,
  SessionTransfer.node,
  SdkPlugins.node,
  PluginUpdate.node,
  PermissionSaved.node,
  ApprovalPresence.node,
  PtyTicket.node,
  PersistentPty.node,
  Credential.node,
  WellKnown.node,
  PtyEnvironment.node,
  ServerPairing.node,
  LocationServiceMap.node,
  LocationActivity.node,
  SessionRestart.node,
  Workspace.node,
] as const
const applicationServices = LayerNode.group(applicationServiceNodes)

export function createRoutes(
  options: ServerOptions = {},
  serviceURLs: () => ReadonlyArray<string> = () => [],
  overrides: LayerNode.Replacements = [],
) {
  return makeRoutes(
    options.password
      ? ServerAuth.Config.configLayer({ password: Option.some(options.password) })
      : ServerAuth.Config.layer,
    options,
    serviceURLs,
    overrides,
  )
}

type InstanceNode = (
  replacements: () => LayerNode.Replacements,
) => LayerNode.Provider<Instance.Service, never, typeof Node.tags.values.global>

export function createEmbeddedRoutes(
  options: ServerOptions = {},
  overrides: LayerNode.Replacements = [],
  instances?: InstanceNode,
) {
  return makeRoutes(ServerAuth.Config.configLayer({ password: Option.none() }), options, () => [], overrides, instances)
}

function makeRoutes<AuthError, AuthServices>(
  auth: Layer.Layer<ServerAuth.Config, AuthError, AuthServices>,
  options: ServerOptions,
  serviceURLs: () => ReadonlyArray<string>,
  // Runtime-profile replacements (e.g. workerd) applied after the standard set, so later entries win.
  overrides: LayerNode.Replacements,
  instances?: InstanceNode,
) {
  const standard: LayerNode.Replacements = [
    Database.node.replace(Database.configured(options.database)),
    PersistentPty.node.replace(PersistentPty.configured(options.pty)),
    Bus.node.replace(
      Bus.configured({ persist: options.events?.persist ?? Flag.AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS }),
    ),
    App.node.replace(App.configured(options.app)),
    ModelsDev.node.replace(ModelsDev.configured(options.models)),
    Watcher.node.replace(Watcher.configured({ enabled: options.fs?.filewatcher })),
    FileSystemSearch.node.replace(FileSystemSearch.configured({ fff: options.fs?.fff })),
    Global.node.replace(Global.layerWith(options.config?.directory ? { config: options.config.directory } : {})),
    Config.node.replace(
      Config.configured({
        project: options.config?.project,
        file: options.config?.file,
        content: options.config?.content,
      }),
    ),
    InstructionDiscovery.node.replace(InstructionDiscovery.configured({ project: options.config?.project })),
    ShellSelect.node.replace(ShellSelect.configured({ gitbash: options.windows?.gitbash })),
    Mcp.node.replace(
      Mcp.configured({
        clientInfo: {
          name: "aigcfroge",
          version: options.app?.version ?? "unknown",
        },
      }),
    ),
  ]
  const build = (overrides: LayerNode.Replacements) => {
    const replacements: LayerNode.Replacements = [
      ...standard,
      // Private instances resolve this list lazily so they inherit the complete host graph, including the selector.
      ...(instances ? [Instance.node.replace(instances(() => replacements))] : []),
      ...overrides,
    ]
    return AppNodeBuilder.build(applicationServices, replacements)
  }
  const serviceLayer = options.simulation
    ? Layer.unwrap(
        Effect.gen(function* () {
          const { simulationReplacements } = yield* Effect.promise(() => import("@aigcfroge/simulation/backend"))
          const simulation = yield* simulationReplacements({ version: App.make(options.app).version })
          return build([...overrides, ...simulation])
        }),
      )
    : build(overrides)
  return serviceLayer.pipe(
    Layer.flatMap((context) => {
      const services = Layer.succeedContext(context)
      const requestServices = Layer.merge(
        Layer.succeedContext(
          Context.pick(
            Database.Service,
            Credential.Service,
            PermissionSaved.Service,
            PluginUpdate.Service,
            Project.Service,
            SessionGoal.Service,
            WellKnown.Service,
          )(context),
        ),
        ServerInfo.layer(serviceURLs, Context.get(context, Global.Service).tmp, options.app),
      )
      const api = HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
        Layer.provide(handlers.pipe(Layer.provide(services), Layer.provide(Layer.succeed(CorsConfig, options)))),
        Layer.provide(formLocationLayer),
        Layer.provide(sessionLocationLayer),
        Layer.provide(layer),
        Layer.provide(authorizationLayer),
        Layer.provide(schemaErrorLayer),
        Layer.provide(workspaceRoutingLayer),
        Layer.provide(instanceContextLayer),
        Layer.provide(ptyConnectStubLayer),
        Layer.provide(auth),
        HttpRouter.provideRequest(requestServices),
        Layer.provideMerge(services),
        Layer.provideMerge(HttpRouter.layer),
      )
      return Layer.merge(api, V1Migration.layer.pipe(Layer.provide(services)))
    }),
  )
}
