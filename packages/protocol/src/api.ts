import { Context } from "effect"
import { HttpApi, HttpApiGroup, HttpApiMiddleware, OpenApi } from "effect/http-api"
import { SchemaErrorMiddleware } from "./middleware/schema-error.js"
import { GenerateGroup } from "./groups/generate.js"
import { MessageGroup } from "./groups/message.js"
import { ModelGroup } from "./groups/model.js"
import { ProviderGroup } from "./groups/provider.js"
import { makeSessionGroup } from "./groups/session.js"
import { makeSessionGoalGroup } from "./groups/session-goal.js"
import { makeSessionCommunicationGroup } from "./groups/session-communication.js"
import { makePermissionGroup } from "./groups/permission.js"
import { FileSystemGroup } from "./groups/fs.js"
import { makeFormGroup } from "./groups/form.js"
import { CommandGroup } from "./groups/command.js"
import { SkillGroup } from "./groups/skill.js"
import { RpcGroup } from "./groups/rpc.js"
import { EventGroup, makeEventGroup } from "./groups/event.js"
import type { Definition } from "@aigcfroge/schema/event"
import { AgentGroup } from "./groups/agent.js"
import { PluginGroup } from "./groups/plugin.js"
import { ServerGroup } from "./groups/server.js"
import { DebugGroup } from "./groups/debug.js"
import { makePtyGroup } from "./groups/pty.js"
import { PersistentPtyGroup } from "./groups/persistent-pty.js"
import { ShellGroup } from "./groups/shell.js"
import { ReferenceGroup } from "./groups/reference.js"
import { Authorization } from "./middleware/authorization.js"
import { makeLocationGroup } from "./groups/location.js"
import { IntegrationGroup } from "./groups/integration.js"
import { WebSearchGroup } from "./groups/websearch.js"
import { McpGroup } from "./groups/mcp.js"
import { CredentialGroup } from "./groups/credential.js"
import { ProjectGroup } from "./groups/project.js"
import { WorktreeGroup } from "./groups/worktree.js"
import { VcsGroup } from "./groups/vcs.js"
import { MigrationGroup } from "./groups/migration.js"
import { ConfigGroup } from "./groups/config.js"
import { PromptAssetGroup } from "./groups/prompt-asset.js"
import { SkillAssetGroup } from "./groups/skill-asset.js"
import { McpAssetGroup } from "./groups/mcp-asset.js"
import { CommandAssetGroup } from "./groups/command-asset.js"
import { AgentAssetGroup } from "./groups/agent-asset.js"
import { PluginAssetGroup } from "./groups/plugin-asset.js"
import { WorkflowAssetGroup } from "./groups/workflow-asset.js"
import { CustomProfileGroup } from "./groups/custom-profile.js"
import { CustomCompositionGroup } from "./groups/custom-composition.js"
import { MemoryGroup } from "./groups/memory.js"
import { KBGroup } from "./groups/kb.js"
import { ScheduleGroup } from "./groups/schedule.js"
import { ImportParserGroup } from "./groups/import-parser.js"
import { PathIdentityGroup } from "./groups/path-identity.js"
import { GrantGroup } from "./groups/grant.js"
import { AgentTaskGroup } from "./groups/agent-task.js"
import { WorkArtifactGroup } from "./groups/work-artifact.js"
import { ControlPlaneGroup } from "./groups/control-plane.js"
import { ControlGroup } from "./groups/control.js"
import { SyncGroup } from "./groups/sync.js"
import { QuestionGroup } from "./groups/question.js"
import { DelegationGroup } from "./groups/delegation.js"
import { ProjectCopyGroup } from "./groups/project-copy.js"
import { FileGroup } from "./groups/file.js"
import { PtyConnectInstanceGroup, PtyInstanceGroup } from "./groups/pty-instance.js"
import { ProjectInstanceGroup } from "./groups/project-instance.js"
import { PermissionInstanceGroup } from "./groups/permission-instance.js"
import { McpInstanceGroup } from "./groups/mcp-instance.js"
import { ConfigInstanceGroup } from "./groups/config-instance.js"
import { WorkspaceInstanceGroup } from "./groups/workspace-instance.js"
import { ProviderInstanceGroup } from "./groups/provider-instance.js"
import { InstanceGroup } from "./groups/instance-instance.js"
import { SessionInstanceGroup } from "./groups/session-instance.js"

type LocationGroups<LocationId extends HttpApiMiddleware.AnyId> =
  | HttpApiGroup.AddMiddleware<typeof AgentGroup, LocationId>
  | HttpApiGroup.AddMiddleware<typeof PluginGroup, LocationId>
  | HttpApiGroup.AddMiddleware<typeof ModelGroup, LocationId>
  | HttpApiGroup.AddMiddleware<typeof ProviderGroup, LocationId>
  | HttpApiGroup.AddMiddleware<typeof IntegrationGroup, LocationId>
  | HttpApiGroup.AddMiddleware<typeof WebSearchGroup, LocationId>
  | HttpApiGroup.AddMiddleware<typeof McpGroup, LocationId>
  | HttpApiGroup.AddMiddleware<typeof ProjectGroup, LocationId>
  | HttpApiGroup.AddMiddleware<typeof FileSystemGroup, LocationId>
  | HttpApiGroup.AddMiddleware<typeof CommandGroup, LocationId>
  | HttpApiGroup.AddMiddleware<typeof SkillGroup, LocationId>
  | HttpApiGroup.AddMiddleware<typeof RpcGroup, LocationId>
  | HttpApiGroup.AddMiddleware<typeof ShellGroup, LocationId>
  | HttpApiGroup.AddMiddleware<typeof ReferenceGroup, LocationId>
  | HttpApiGroup.AddMiddleware<typeof VcsGroup, LocationId>
  | HttpApiGroup.AddMiddleware<typeof ConfigGroup, LocationId>
  | HttpApiGroup.AddMiddleware<typeof PathIdentityGroup, LocationId>
  | HttpApiGroup.AddMiddleware<typeof GrantGroup, LocationId>

type PtyGroups<LocationId extends HttpApiMiddleware.AnyId, LocationService> = ReturnType<
  typeof makePtyGroup<LocationId, LocationService>
>

type SessionGroups<
  SessionLocationId extends HttpApiMiddleware.AnyId,
  SessionLocationService,
  FormLocationId extends HttpApiMiddleware.AnyId,
  FormLocationService,
> =
  | ReturnType<typeof makeSessionGroup<SessionLocationId, SessionLocationService, FormLocationId, FormLocationService>>
  | ReturnType<typeof makeSessionGoalGroup<SessionLocationId, SessionLocationService>>
  | ReturnType<typeof makeSessionCommunicationGroup<SessionLocationId, SessionLocationService>>
  | typeof MessageGroup

type FormGroups<LocationId extends HttpApiMiddleware.AnyId, LocationService> = ReturnType<
  typeof makeFormGroup<LocationId, LocationService>
>

type LocationGroup<LocationId extends HttpApiMiddleware.AnyId, LocationService> = ReturnType<
  typeof makeLocationGroup<LocationId, LocationService>
>

type MixedMiddlewareGroups<
  LocationId extends HttpApiMiddleware.AnyId,
  LocationService,
  SessionLocationId extends HttpApiMiddleware.AnyId,
  SessionLocationService,
> = ReturnType<typeof makePermissionGroup<LocationId, LocationService, SessionLocationId, SessionLocationService>>

type ApiGroups<
  LocationId extends HttpApiMiddleware.AnyId,
  LocationService,
  FormLocationId extends HttpApiMiddleware.AnyId,
  FormLocationService,
  SessionLocationId extends HttpApiMiddleware.AnyId,
  SessionLocationService,
  Event extends HttpApiGroup.Constraint,
> =
  | typeof ServerGroup
  | typeof DebugGroup
  | typeof MigrationGroup
  | typeof WorktreeGroup
  | typeof GenerateGroup
  | typeof PersistentPtyGroup
  | typeof CredentialGroup
  | typeof PromptAssetGroup
  | typeof SkillAssetGroup
  | typeof McpAssetGroup
  | typeof CommandAssetGroup
  | typeof AgentAssetGroup
  | typeof PluginAssetGroup
  | typeof WorkflowAssetGroup
  | typeof CustomProfileGroup
  | typeof CustomCompositionGroup
  | typeof MemoryGroup
  | typeof KBGroup
  | typeof ScheduleGroup
  | typeof ImportParserGroup
  | typeof AgentTaskGroup
  | typeof WorkArtifactGroup
  | typeof ControlPlaneGroup
  | typeof ControlGroup
  | typeof SyncGroup
  | typeof QuestionGroup
  | typeof DelegationGroup
  | typeof ProjectCopyGroup
  | typeof FileGroup
  | typeof PtyInstanceGroup
  | typeof PtyConnectInstanceGroup
  | typeof ProjectInstanceGroup
  | typeof PermissionInstanceGroup
  | typeof McpInstanceGroup
  | typeof ConfigInstanceGroup
  | typeof WorkspaceInstanceGroup
  | typeof ProviderInstanceGroup
  | typeof InstanceGroup
  | typeof SessionInstanceGroup
  | LocationGroups<LocationId>
  | LocationGroup<LocationId, LocationService>
  | PtyGroups<LocationId, LocationService>
  | FormGroups<LocationId, LocationService>
  | SessionGroups<SessionLocationId, SessionLocationService, FormLocationId, FormLocationService>
  | MixedMiddlewareGroups<LocationId, LocationService, SessionLocationId, SessionLocationService>
  | Event

type EventGroupFor<Definitions extends ReadonlyArray<Definition>> = ReturnType<typeof makeEventGroup<Definitions>>

export type Api<
  LocationId extends HttpApiMiddleware.AnyId,
  LocationService,
  FormLocationId extends HttpApiMiddleware.AnyId,
  FormLocationService,
  SessionLocationId extends HttpApiMiddleware.AnyId,
  SessionLocationService,
  Event extends HttpApiGroup.Constraint,
> = HttpApi.HttpApi<
  "server",
  HttpApiGroup.AddMiddleware<
    HttpApiGroup.AddMiddleware<
      ApiGroups<
        LocationId,
        LocationService,
        FormLocationId,
        FormLocationService,
        SessionLocationId,
        SessionLocationService,
        Event
      >,
      Authorization
    >,
    SchemaErrorMiddleware
  >
>

// Protocol owns middleware placement, while Server injects concrete keys so Core service identities stay downstream.
const makeApiFromGroup = <
  const Group extends HttpApiGroup.Constraint,
  LocationId extends HttpApiMiddleware.AnyId,
  LocationService,
  FormLocationId extends HttpApiMiddleware.AnyId,
  FormLocationService,
  SessionLocationId extends HttpApiMiddleware.AnyId,
  SessionLocationService,
>(
  eventGroup: Group,
  locationMiddleware: Context.Key<LocationId, LocationService>,
  formLocationMiddleware: Context.Key<FormLocationId, FormLocationService>,
  sessionLocationMiddleware: Context.Key<SessionLocationId, SessionLocationService>,
): Api<
  LocationId,
  LocationService,
  FormLocationId,
  FormLocationService,
  SessionLocationId,
  SessionLocationService,
  Group
> =>
  HttpApi.make("server")
    .add(ServerGroup)
    .add(makeLocationGroup(locationMiddleware))
    .add(AgentGroup.middleware(locationMiddleware))
    .add(PathIdentityGroup.middleware(locationMiddleware))
    .add(GrantGroup.middleware(locationMiddleware))
    .add(PluginGroup.middleware(locationMiddleware))
    .add(makeSessionGroup(sessionLocationMiddleware, formLocationMiddleware))
    .add(makeSessionGoalGroup(sessionLocationMiddleware))
    .add(makeSessionCommunicationGroup(sessionLocationMiddleware))
    .add(MessageGroup)
    .add(ModelGroup.middleware(locationMiddleware))
    .add(GenerateGroup)
    .add(ProviderGroup.middleware(locationMiddleware))
    .add(IntegrationGroup.middleware(locationMiddleware))
    .add(McpGroup.middleware(locationMiddleware))
    .add(CredentialGroup)
    .add(ProjectGroup.middleware(locationMiddleware))
    .add(makeFormGroup(locationMiddleware))
    .add(makePermissionGroup(locationMiddleware, sessionLocationMiddleware))
    .add(FileSystemGroup.middleware(locationMiddleware))
    .add(CommandGroup.middleware(locationMiddleware))
    .add(SkillGroup.middleware(locationMiddleware))
    .add(RpcGroup.middleware(locationMiddleware))
    .add(eventGroup)
    .add(makePtyGroup(locationMiddleware))
    .add(PersistentPtyGroup)
    .add(ShellGroup.middleware(locationMiddleware))
    .add(ReferenceGroup.middleware(locationMiddleware))
    .add(WorktreeGroup)
    .add(VcsGroup.middleware(locationMiddleware))
    .add(DebugGroup)
    .add(MigrationGroup)
    .add(WebSearchGroup.middleware(locationMiddleware))
    .add(ConfigGroup.middleware(locationMiddleware))
    .add(PromptAssetGroup)
    .add(SkillAssetGroup)
    .add(McpAssetGroup)
    .add(CommandAssetGroup)
    .add(AgentAssetGroup)
    .add(PluginAssetGroup)
    .add(WorkflowAssetGroup)
    .add(CustomProfileGroup)
    .add(CustomCompositionGroup)
    .add(MemoryGroup)
    .add(KBGroup)
    .add(ScheduleGroup)
    .add(ImportParserGroup)
    .add(AgentTaskGroup)
    .add(WorkArtifactGroup)
    .add(ControlPlaneGroup)
    .add(ControlGroup)
    .add(SyncGroup)
    .add(QuestionGroup)
    .add(DelegationGroup)
    .add(ProjectCopyGroup)
    .add(FileGroup)
    .add(PtyInstanceGroup)
    .add(PtyConnectInstanceGroup)
    .add(ProjectInstanceGroup)
    .add(PermissionInstanceGroup)
    .add(McpInstanceGroup)
    .add(ConfigInstanceGroup)
    .add(WorkspaceInstanceGroup)
    .add(ProviderInstanceGroup)
    .add(InstanceGroup)
    .add(SessionInstanceGroup)
    .annotateMerge(
      OpenApi.annotations({
        title: "aigcfroge HttpApi",
        version: "0.0.1",
        description: "Experimental HttpApi surface for selected instance routes.",
      }),
    )
    .middleware(Authorization)
    .middleware(SchemaErrorMiddleware)

export const makeApi = <
  const Definitions extends ReadonlyArray<Definition>,
  LocationId extends HttpApiMiddleware.AnyId,
  LocationService,
  FormLocationId extends HttpApiMiddleware.AnyId,
  FormLocationService,
  SessionLocationId extends HttpApiMiddleware.AnyId,
  SessionLocationService,
>(options: {
  readonly definitions: Definitions
  readonly locationMiddleware: Context.Key<LocationId, LocationService>
  readonly formLocationMiddleware: Context.Key<FormLocationId, FormLocationService>
  readonly sessionLocationMiddleware: Context.Key<SessionLocationId, SessionLocationService>
}): Api<
  LocationId,
  LocationService,
  FormLocationId,
  FormLocationService,
  SessionLocationId,
  SessionLocationService,
  EventGroupFor<Definitions>
> =>
  makeApiFromGroup(
    makeEventGroup(options.definitions),
    options.locationMiddleware,
    options.formLocationMiddleware,
    options.sessionLocationMiddleware,
  )

export const makeDefaultApi = <
  LocationId extends HttpApiMiddleware.AnyId,
  LocationService,
  FormLocationId extends HttpApiMiddleware.AnyId,
  FormLocationService,
  SessionLocationId extends HttpApiMiddleware.AnyId,
  SessionLocationService,
>(options: {
  readonly locationMiddleware: Context.Key<LocationId, LocationService>
  readonly formLocationMiddleware: Context.Key<FormLocationId, FormLocationService>
  readonly sessionLocationMiddleware: Context.Key<SessionLocationId, SessionLocationService>
}): Api<
  LocationId,
  LocationService,
  FormLocationId,
  FormLocationService,
  SessionLocationId,
  SessionLocationService,
  typeof EventGroup
> =>
  makeApiFromGroup(
    EventGroup,
    options.locationMiddleware,
    options.formLocationMiddleware,
    options.sessionLocationMiddleware,
  )
