import { NodeFileSystem } from "@effect/platform-node"
import { compile, emitEffectImported, emitEffectShape, emitPromise, write } from "@aigcfroge/httpapi-codegen"
import { ClientApi, effectOmitEndpoints, groupNames, promiseOmitEndpoints } from "@aigcfroge/protocol/client"
import { Agent } from "@aigcfroge/schema/agent"
import { Command } from "@aigcfroge/schema/command"
import { Config } from "@aigcfroge/schema/config"
import { Credential } from "@aigcfroge/schema/credential"
import { Event } from "@aigcfroge/schema/event"
import { EventLog } from "@aigcfroge/schema/event-log"
import { FileDiff } from "@aigcfroge/schema/file-diff"
import { FileSystem } from "@aigcfroge/schema/filesystem"
import { Form } from "@aigcfroge/schema/form"
import { Instruction } from "@aigcfroge/schema/instruction"
import { InstructionEntry } from "@aigcfroge/schema/instruction-entry"
import { McpScope } from "@aigcfroge/schema/mcp-scope"
import { Integration } from "@aigcfroge/schema/integration"
import { Location } from "@aigcfroge/schema/location"
import { Mcp } from "@aigcfroge/schema/mcp"
import { Model } from "@aigcfroge/schema/model"
import { ModelGroup } from "@aigcfroge/schema/model-group"
import { ModelSource } from "@aigcfroge/schema/model-source"
import { MetaAgent } from "@aigcfroge/schema/meta-agent"
import { Money } from "@aigcfroge/schema/money"
import { Permission } from "@aigcfroge/schema/permission"
import { PermissionSaved } from "@aigcfroge/schema/permission-saved"
import { Plugin } from "@aigcfroge/schema/plugin"
import { Project } from "@aigcfroge/schema/project"
import { PromptAsset } from "@aigcfroge/schema/prompt-asset"
import { SkillAsset } from "@aigcfroge/schema/skill-asset"
import { AssetPlacement } from "@aigcfroge/schema/asset-placement"
import { MCPAsset } from "@aigcfroge/schema/mcp-asset"
import { CommandAsset } from "@aigcfroge/schema/command-asset"
import { AgentAsset } from "@aigcfroge/schema/agent-asset"
import { PluginAsset } from "@aigcfroge/schema/plugin-asset"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { Composition } from "@aigcfroge/schema/composition"
import { CustomProfile } from "@aigcfroge/schema/custom-profile"
import { PersonalMemory } from "@aigcfroge/schema/personal-memory"
import { KBNote } from "@aigcfroge/schema/kb-note"
import { Schedule } from "@aigcfroge/schema/schedule"
import { ImportParser } from "@aigcfroge/schema/import-parser"
import { SessionTask } from "@aigcfroge/schema/session-task"
import { SessionGoal } from "@aigcfroge/schema/session-goal"
import { SessionCommunication } from "@aigcfroge/schema/session-communication"
import { Delegation } from "@aigcfroge/schema/delegation"
import { DelegationID } from "@aigcfroge/schema/delegation-id"
import { PermissionV1 } from "@aigcfroge/schema/v1/permission"
import { ConfigV1 } from "@aigcfroge/schema/v1/config/config"
import { SessionV1 } from "@aigcfroge/schema/v1/session"
import { SessionIdentity } from "@aigcfroge/schema/session-identity"
import { Worktree } from "@aigcfroge/schema/worktree"
import { AgentAttachment, FileAttachment, Prompt, PromptMention } from "@aigcfroge/schema/prompt"
import { PromptInput } from "@aigcfroge/schema/prompt-input"
import { Provider } from "@aigcfroge/schema/provider"
import { ProviderDefinition } from "@aigcfroge/schema/provider-definition"
import { ProviderDiscovery } from "@aigcfroge/schema/provider-discovery"
import { Pty } from "@aigcfroge/schema/pty"
import { PtyTicket } from "@aigcfroge/schema/pty-ticket"
import { Question } from "@aigcfroge/schema/question"
import { Reference } from "@aigcfroge/schema/reference"
import { AbsolutePath, RelativePath } from "@aigcfroge/schema/schema"
import { Session } from "@aigcfroge/schema/session"
import { SessionMessage } from "@aigcfroge/schema/session-message"
import { SessionInbox } from "@aigcfroge/schema/session-inbox"
import { Shell } from "@aigcfroge/schema/shell"
import { Skill } from "@aigcfroge/schema/skill"
import { Snapshot } from "@aigcfroge/schema/snapshot"
import { Vcs } from "@aigcfroge/schema/vcs"
import { WebSearch } from "@aigcfroge/schema/websearch"
import { Workspace } from "@aigcfroge/schema/workspace"
import { SessionsCursor } from "@aigcfroge/protocol/groups/session"
import { AgentWithPrimaryModes } from "@aigcfroge/protocol/groups/instance-instance"
import { SessionInstanceInfo, SessionInstanceWithParts } from "@aigcfroge/protocol/groups/session-instance"
import { Effect, Schema } from "effect"
import { fileURLToPath } from "url"

const promiseContract = compile(ClientApi, { groupNames, omitEndpoints: promiseOmitEndpoints })
const effectContract = compile(ClientApi, { groupNames, omitEndpoints: effectOmitEndpoints })
const effectTypeReferences = [
  ...namespaceTypes("Agent", "@aigcfroge/schema/agent", Agent),
  ...namespaceTypes("Command", "@aigcfroge/schema/command", Command),
  ...namespaceTypes("Config", "@aigcfroge/schema/config", Config),
  ...namespaceTypes("Credential", "@aigcfroge/schema/credential", Credential),
  ...namespaceTypes("Event", "@aigcfroge/schema/event", Event),
  ...namespaceTypes("EventLog", "@aigcfroge/schema/event-log", EventLog),
  ...namespaceTypes("FileDiff", "@aigcfroge/schema/file-diff", FileDiff),
  ...namespaceTypes("FileSystem", "@aigcfroge/schema/filesystem", FileSystem),
  ...namespaceTypes("Form", "@aigcfroge/schema/form", Form),
  ...namespaceTypes("Instruction", "@aigcfroge/schema/instruction", Instruction),
  ...namespaceTypes("McpScope", "@aigcfroge/schema/mcp-scope", McpScope),
  ...namespaceTypes("InstructionEntry", "@aigcfroge/schema/instruction-entry", InstructionEntry),
  ...namespaceTypes("Integration", "@aigcfroge/schema/integration", Integration),
  typeReference("Location.PublicRef", "@aigcfroge/schema/location", Location.PublicRef),
  typeReference("Location.PublicInfo", "@aigcfroge/schema/location", Location.PublicInfo),
  ...namespaceTypes("Mcp", "@aigcfroge/schema/mcp", Mcp),
  ...namespaceTypes("Model", "@aigcfroge/schema/model", Model),
  ...namespaceTypes("ModelGroup", "@aigcfroge/schema/model-group", ModelGroup),
  ...namespaceTypes("ModelSource", "@aigcfroge/schema/model-source", ModelSource),
  ...namespaceTypes("MetaAgent", "@aigcfroge/schema/meta-agent", MetaAgent),
  ...namespaceTypes("Money", "@aigcfroge/schema/money", Money),
  ...namespaceTypes("Permission", "@aigcfroge/schema/permission", Permission),
  ...namespaceTypes("PermissionSaved", "@aigcfroge/schema/permission-saved", PermissionSaved),
  ...namespaceTypes("Plugin", "@aigcfroge/schema/plugin", Plugin),
  ...namespaceTypes("Project", "@aigcfroge/schema/project", Project),
  ...namespaceTypes("PromptAsset", "@aigcfroge/schema/prompt-asset", PromptAsset),
  ...namespaceTypes("SkillAsset", "@aigcfroge/schema/skill-asset", SkillAsset),
  ...namespaceTypes("AssetPlacement", "@aigcfroge/schema/asset-placement", AssetPlacement),
  ...namespaceTypes("MCPAsset", "@aigcfroge/schema/mcp-asset", MCPAsset),
  ...namespaceTypes("CommandAsset", "@aigcfroge/schema/command-asset", CommandAsset),
  ...namespaceTypes("AgentAsset", "@aigcfroge/schema/agent-asset", AgentAsset),
  ...namespaceTypes("PluginAsset", "@aigcfroge/schema/plugin-asset", PluginAsset),
  ...namespaceTypes("WorkflowAsset", "@aigcfroge/schema/workflow-asset", WorkflowAsset),
  ...namespaceTypes("Composition", "@aigcfroge/schema/composition", Composition),
  ...namespaceTypes("CustomProfile", "@aigcfroge/schema/custom-profile", CustomProfile),
  ...namespaceTypes("PersonalMemory", "@aigcfroge/schema/personal-memory", PersonalMemory),
  ...namespaceTypes("KBNote", "@aigcfroge/schema/kb-note", KBNote),
  ...namespaceTypes("Schedule", "@aigcfroge/schema/schedule", Schedule),
  ...namespaceTypes("ImportParser", "@aigcfroge/schema/import-parser", ImportParser),
  ...namespaceTypes("SessionTask", "@aigcfroge/schema/session-task", SessionTask),
  ...namespaceTypes("SessionGoal", "@aigcfroge/schema/session-goal", SessionGoal),
  ...namespaceTypes("SessionCommunication", "@aigcfroge/schema/session-communication", SessionCommunication),
  ...namespaceTypes("Delegation", "@aigcfroge/schema/delegation", Delegation),
  ...namespaceTypes("DelegationID", "@aigcfroge/schema/delegation-id", DelegationID),
  ...namespaceTypes("PermissionV1", "@aigcfroge/schema/v1/permission", PermissionV1),
  ...namespaceTypes("ConfigV1", "@aigcfroge/schema/v1/config/config", ConfigV1),
  ...namespaceTypes("SessionV1", "@aigcfroge/schema/v1/session", SessionV1),
  ...namespaceTypes("SessionIdentity", "@aigcfroge/schema/session-identity", SessionIdentity),
  ...namespaceTypes("Worktree", "@aigcfroge/schema/worktree", Worktree),
  ...namespaceTypes("PromptInput", "@aigcfroge/schema/prompt-input", PromptInput),
  ...namespaceTypes("Provider", "@aigcfroge/schema/provider", Provider),
  ...namespaceTypes("ProviderDefinition", "@aigcfroge/schema/provider-definition", ProviderDefinition),
  ...namespaceTypes("ProviderDiscovery", "@aigcfroge/schema/provider-discovery", ProviderDiscovery),
  ...namespaceTypes("Pty", "@aigcfroge/schema/pty", Pty),
  ...namespaceTypes("PtyTicket", "@aigcfroge/schema/pty-ticket", PtyTicket),
  ...namespaceTypes("Question", "@aigcfroge/schema/question", Question),
  ...namespaceTypes("Reference", "@aigcfroge/schema/reference", Reference),
  ...namespaceTypes("Session", "@aigcfroge/schema/session", Session),
  ...namespaceTypes("SessionMessage", "@aigcfroge/schema/session-message", SessionMessage),
  ...namespaceTypes("SessionInbox", "@aigcfroge/schema/session-inbox", SessionInbox),
  ...namespaceTypes("Shell", "@aigcfroge/schema/shell", Shell),
  ...namespaceTypes("Skill", "@aigcfroge/schema/skill", Skill),
  ...namespaceTypes("Snapshot", "@aigcfroge/schema/snapshot", Snapshot),
  ...namespaceTypes("Vcs", "@aigcfroge/schema/vcs", Vcs),
  ...namespaceTypes("WebSearch", "@aigcfroge/schema/websearch", WebSearch),
  ...namespaceTypes("Workspace", "@aigcfroge/schema/workspace", Workspace),
  typeReference("Prompt", "@aigcfroge/schema/prompt", Prompt),
  typeReference("PromptMention", "@aigcfroge/schema/prompt", PromptMention),
  typeReference("FileAttachment", "@aigcfroge/schema/prompt", FileAttachment),
  typeReference("AgentAttachment", "@aigcfroge/schema/prompt", AgentAttachment),
  typeReference("AbsolutePath", "@aigcfroge/schema/schema", AbsolutePath),
  typeReference("RelativePath", "@aigcfroge/schema/schema", RelativePath),
  typeReference("SessionsCursor", "@aigcfroge/protocol/groups/session", SessionsCursor),
  typeReference("AgentWithPrimaryModes", "@aigcfroge/protocol/groups/instance-instance", AgentWithPrimaryModes),
  typeReference("SessionInstanceInfo", "@aigcfroge/protocol/groups/session-instance", SessionInstanceInfo),
  typeReference("SessionInstanceWithParts", "@aigcfroge/protocol/groups/session-instance", SessionInstanceWithParts),
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
              name: "AigcForgeEvent",
              import: 'import type { AigcForgeEvent } from "@aigcfroge/protocol/groups/event"',
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
