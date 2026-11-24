import { NodeFileSystem } from "@effect/platform-node"
import { compile, emitEffectImported, emitEffectShape, emitPromise, write } from "@omnixa/httpapi-codegen"
import { ClientApi, effectOmitEndpoints, groupNames, promiseOmitEndpoints } from "@omnixa/protocol/client"
import { Agent } from "@omnixa/schema/agent"
import { Command } from "@omnixa/schema/command"
import { Config } from "@omnixa/schema/config"
import { Credential } from "@omnixa/schema/credential"
import { Event } from "@omnixa/schema/event"
import { EventLog } from "@omnixa/schema/event-log"
import { FileDiff } from "@omnixa/schema/file-diff"
import { FileSystem } from "@omnixa/schema/filesystem"
import { Form } from "@omnixa/schema/form"
import { Instruction } from "@omnixa/schema/instruction"
import { InstructionEntry } from "@omnixa/schema/instruction-entry"
import { McpScope } from "@omnixa/schema/mcp-scope"
import { Integration } from "@omnixa/schema/integration"
import { Location } from "@omnixa/schema/location"
import { Mcp } from "@omnixa/schema/mcp"
import { Model } from "@omnixa/schema/model"
import { ModelGroup } from "@omnixa/schema/model-group"
import { ModelSource } from "@omnixa/schema/model-source"
import { MetaAgent } from "@omnixa/schema/meta-agent"
import { Money } from "@omnixa/schema/money"
import { Permission } from "@omnixa/schema/permission"
import { PermissionSaved } from "@omnixa/schema/permission-saved"
import { Plugin } from "@omnixa/schema/plugin"
import { Project } from "@omnixa/schema/project"
import { PromptAsset } from "@omnixa/schema/prompt-asset"
import { SkillAsset } from "@omnixa/schema/skill-asset"
import { AssetPlacement } from "@omnixa/schema/asset-placement"
import { MCPAsset } from "@omnixa/schema/mcp-asset"
import { CommandAsset } from "@omnixa/schema/command-asset"
import { AgentAsset } from "@omnixa/schema/agent-asset"
import { PluginAsset } from "@omnixa/schema/plugin-asset"
import { WorkflowAsset } from "@omnixa/schema/workflow-asset"
import { Composition } from "@omnixa/schema/composition"
import { CustomProfile } from "@omnixa/schema/custom-profile"
import { PersonalMemory } from "@omnixa/schema/personal-memory"
import { KBNote } from "@omnixa/schema/kb-note"
import { Schedule } from "@omnixa/schema/schedule"
import { ImportParser } from "@omnixa/schema/import-parser"
import { SessionTask } from "@omnixa/schema/session-task"
import { SessionGoal } from "@omnixa/schema/session-goal"
import { SessionCommunication } from "@omnixa/schema/session-communication"
import { Delegation } from "@omnixa/schema/delegation"
import { DelegationID } from "@omnixa/schema/delegation-id"
import { PermissionV1 } from "@omnixa/schema/v1/permission"
import { ConfigV1 } from "@omnixa/schema/v1/config/config"
import { SessionV1 } from "@omnixa/schema/v1/session"
import { SessionIdentity } from "@omnixa/schema/session-identity"
import { Worktree } from "@omnixa/schema/worktree"
import { AgentAttachment, FileAttachment, Prompt, PromptMention } from "@omnixa/schema/prompt"
import { PromptInput } from "@omnixa/schema/prompt-input"
import { Provider } from "@omnixa/schema/provider"
import { ProviderDefinition } from "@omnixa/schema/provider-definition"
import { ProviderDiscovery } from "@omnixa/schema/provider-discovery"
import { Pty } from "@omnixa/schema/pty"
import { PtyTicket } from "@omnixa/schema/pty-ticket"
import { Question } from "@omnixa/schema/question"
import { Reference } from "@omnixa/schema/reference"
import { AbsolutePath, RelativePath } from "@omnixa/schema/schema"
import { Session } from "@omnixa/schema/session"
import { SessionMessage } from "@omnixa/schema/session-message"
import { SessionInbox } from "@omnixa/schema/session-inbox"
import { Shell } from "@omnixa/schema/shell"
import { Skill } from "@omnixa/schema/skill"
import { Snapshot } from "@omnixa/schema/snapshot"
import { Vcs } from "@omnixa/schema/vcs"
import { WebSearch } from "@omnixa/schema/websearch"
import { Workspace } from "@omnixa/schema/workspace"
import { SessionsCursor } from "@omnixa/protocol/groups/session"
import { AgentWithPrimaryModes } from "@omnixa/protocol/groups/instance-instance"
import { SessionInstanceInfo, SessionInstanceWithParts } from "@omnixa/protocol/groups/session-instance"
import { Effect, Schema } from "effect"
import { fileURLToPath } from "url"

const promiseContract = compile(ClientApi, { groupNames, omitEndpoints: promiseOmitEndpoints })
const effectContract = compile(ClientApi, { groupNames, omitEndpoints: effectOmitEndpoints })
const effectTypeReferences = [
  ...namespaceTypes("Agent", "@omnixa/schema/agent", Agent),
  ...namespaceTypes("Command", "@omnixa/schema/command", Command),
  ...namespaceTypes("Config", "@omnixa/schema/config", Config),
  ...namespaceTypes("Credential", "@omnixa/schema/credential", Credential),
  ...namespaceTypes("Event", "@omnixa/schema/event", Event),
  ...namespaceTypes("EventLog", "@omnixa/schema/event-log", EventLog),
  ...namespaceTypes("FileDiff", "@omnixa/schema/file-diff", FileDiff),
  ...namespaceTypes("FileSystem", "@omnixa/schema/filesystem", FileSystem),
  ...namespaceTypes("Form", "@omnixa/schema/form", Form),
  ...namespaceTypes("Instruction", "@omnixa/schema/instruction", Instruction),
  ...namespaceTypes("McpScope", "@omnixa/schema/mcp-scope", McpScope),
  ...namespaceTypes("InstructionEntry", "@omnixa/schema/instruction-entry", InstructionEntry),
  ...namespaceTypes("Integration", "@omnixa/schema/integration", Integration),
  typeReference("Location.PublicRef", "@omnixa/schema/location", Location.PublicRef),
  typeReference("Location.PublicInfo", "@omnixa/schema/location", Location.PublicInfo),
  ...namespaceTypes("Mcp", "@omnixa/schema/mcp", Mcp),
  ...namespaceTypes("Model", "@omnixa/schema/model", Model),
  ...namespaceTypes("ModelGroup", "@omnixa/schema/model-group", ModelGroup),
  ...namespaceTypes("ModelSource", "@omnixa/schema/model-source", ModelSource),
  ...namespaceTypes("MetaAgent", "@omnixa/schema/meta-agent", MetaAgent),
  ...namespaceTypes("Money", "@omnixa/schema/money", Money),
  ...namespaceTypes("Permission", "@omnixa/schema/permission", Permission),
  ...namespaceTypes("PermissionSaved", "@omnixa/schema/permission-saved", PermissionSaved),
  ...namespaceTypes("Plugin", "@omnixa/schema/plugin", Plugin),
  ...namespaceTypes("Project", "@omnixa/schema/project", Project),
  ...namespaceTypes("PromptAsset", "@omnixa/schema/prompt-asset", PromptAsset),
  ...namespaceTypes("SkillAsset", "@omnixa/schema/skill-asset", SkillAsset),
  ...namespaceTypes("AssetPlacement", "@omnixa/schema/asset-placement", AssetPlacement),
  ...namespaceTypes("MCPAsset", "@omnixa/schema/mcp-asset", MCPAsset),
  ...namespaceTypes("CommandAsset", "@omnixa/schema/command-asset", CommandAsset),
  ...namespaceTypes("AgentAsset", "@omnixa/schema/agent-asset", AgentAsset),
  ...namespaceTypes("PluginAsset", "@omnixa/schema/plugin-asset", PluginAsset),
  ...namespaceTypes("WorkflowAsset", "@omnixa/schema/workflow-asset", WorkflowAsset),
  ...namespaceTypes("Composition", "@omnixa/schema/composition", Composition),
  ...namespaceTypes("CustomProfile", "@omnixa/schema/custom-profile", CustomProfile),
  ...namespaceTypes("PersonalMemory", "@omnixa/schema/personal-memory", PersonalMemory),
  ...namespaceTypes("KBNote", "@omnixa/schema/kb-note", KBNote),
  ...namespaceTypes("Schedule", "@omnixa/schema/schedule", Schedule),
  ...namespaceTypes("ImportParser", "@omnixa/schema/import-parser", ImportParser),
  ...namespaceTypes("SessionTask", "@omnixa/schema/session-task", SessionTask),
  ...namespaceTypes("SessionGoal", "@omnixa/schema/session-goal", SessionGoal),
  ...namespaceTypes("SessionCommunication", "@omnixa/schema/session-communication", SessionCommunication),
  ...namespaceTypes("Delegation", "@omnixa/schema/delegation", Delegation),
  ...namespaceTypes("DelegationID", "@omnixa/schema/delegation-id", DelegationID),
  ...namespaceTypes("PermissionV1", "@omnixa/schema/v1/permission", PermissionV1),
  ...namespaceTypes("ConfigV1", "@omnixa/schema/v1/config/config", ConfigV1),
  ...namespaceTypes("SessionV1", "@omnixa/schema/v1/session", SessionV1),
  ...namespaceTypes("SessionIdentity", "@omnixa/schema/session-identity", SessionIdentity),
  ...namespaceTypes("Worktree", "@omnixa/schema/worktree", Worktree),
  ...namespaceTypes("PromptInput", "@omnixa/schema/prompt-input", PromptInput),
  ...namespaceTypes("Provider", "@omnixa/schema/provider", Provider),
  ...namespaceTypes("ProviderDefinition", "@omnixa/schema/provider-definition", ProviderDefinition),
  ...namespaceTypes("ProviderDiscovery", "@omnixa/schema/provider-discovery", ProviderDiscovery),
  ...namespaceTypes("Pty", "@omnixa/schema/pty", Pty),
  ...namespaceTypes("PtyTicket", "@omnixa/schema/pty-ticket", PtyTicket),
  ...namespaceTypes("Question", "@omnixa/schema/question", Question),
  ...namespaceTypes("Reference", "@omnixa/schema/reference", Reference),
  ...namespaceTypes("Session", "@omnixa/schema/session", Session),
  ...namespaceTypes("SessionMessage", "@omnixa/schema/session-message", SessionMessage),
  ...namespaceTypes("SessionInbox", "@omnixa/schema/session-inbox", SessionInbox),
  ...namespaceTypes("Shell", "@omnixa/schema/shell", Shell),
  ...namespaceTypes("Skill", "@omnixa/schema/skill", Skill),
  ...namespaceTypes("Snapshot", "@omnixa/schema/snapshot", Snapshot),
  ...namespaceTypes("Vcs", "@omnixa/schema/vcs", Vcs),
  ...namespaceTypes("WebSearch", "@omnixa/schema/websearch", WebSearch),
  ...namespaceTypes("Workspace", "@omnixa/schema/workspace", Workspace),
  typeReference("Prompt", "@omnixa/schema/prompt", Prompt),
  typeReference("PromptMention", "@omnixa/schema/prompt", PromptMention),
  typeReference("FileAttachment", "@omnixa/schema/prompt", FileAttachment),
  typeReference("AgentAttachment", "@omnixa/schema/prompt", AgentAttachment),
  typeReference("AbsolutePath", "@omnixa/schema/schema", AbsolutePath),
  typeReference("RelativePath", "@omnixa/schema/schema", RelativePath),
  typeReference("SessionsCursor", "@omnixa/protocol/groups/session", SessionsCursor),
  typeReference("AgentWithPrimaryModes", "@omnixa/protocol/groups/instance-instance", AgentWithPrimaryModes),
  typeReference("SessionInstanceInfo", "@omnixa/protocol/groups/session-instance", SessionInstanceInfo),
  typeReference("SessionInstanceWithParts", "@omnixa/protocol/groups/session-instance", SessionInstanceWithParts),
]

await Effect.runPromise(
  Effect.all(
    [
      write(
        emitPromise(promiseContract, {
          mutableOutputs: true,
        }),
        fileURLToPath(new URL("../src/promise/generated", import.meta.url)),
      ),
      write(
        emitEffectImported(effectContract, {
          module: "../../contract",
          api: "ClientApi",
          shapeModule: "../api/api.js",
        }),
        fileURLToPath(new URL("../src/effect/generated", import.meta.url)),
      ),
      write(
        emitEffectShape(effectContract, {
          typeReferences: effectTypeReferences,
          outputTypes: {
            "event.subscribe": {
              name: "OmnixaEvent",
              import: 'import type { OmnixaEvent } from "@omnixa/protocol/groups/event"',
            },
            "session.log": {
              name: "SessionLogItem",
              import: 'import type { SessionLogItem } from "@omnixa/protocol/groups/session"',
            },
          },
        }),
        fileURLToPath(new URL("../src/effect/api", import.meta.url)),
      ),
    ],
    { concurrency: 3, discard: true },
  ).pipe(Effect.provide(NodeFileSystem.layer)),
)

function namespaceTypes(namespace: string, module: string, values: object) {
  return Object.entries(values).flatMap(([name, schema]) =>
    Schema.isSchema(schema) ? [typeReference(`${namespace}.${name}`, module, schema)] : [],
  )
}

function typeReference(name: string, module: string, schema: Schema.Top) {
  return {
    schema,
    name,
    import: `import type { ${name.split(".")[0]} } from ${JSON.stringify(module)}`,
  }
}
