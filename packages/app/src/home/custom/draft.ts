import type { CompositionSnapshotV2, WorkflowAssetStepDef } from "@aigcfroge/client/promise"
import { AssetPlacement } from "@aigcfroge/schema/asset-placement"
import { Composition } from "@aigcfroge/schema/composition"
import { CustomProfile } from "@aigcfroge/schema/custom-profile"
import { Model } from "@aigcfroge/schema/model"
import { McpScope } from "@aigcfroge/schema/mcp-scope"
import { Session } from "@aigcfroge/schema/session"
import { SessionMessage } from "@aigcfroge/schema/session-message"
import { encodeFilePath } from "@aigcfroge/util/path"
import { Option, Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"

export const BUILTIN_ROOTS = ["build", "plan", "meta"] as const
export type BuiltinRootID = (typeof BUILTIN_ROOTS)[number]

export const MAX_COMPOSITION_AGENTS = 16

export const ASSET_KINDS = ["agent", "prompt", "skill", "command", "workflow", "mcp", "plugin"] as const
export type AssetKind = (typeof ASSET_KINDS)[number]

export const SCOPED_ASSET_KINDS = ["prompt", "skill", "command"] as const
export type ScopedAssetKind = (typeof SCOPED_ASSET_KINDS)[number]

export function isScopedAssetKind(kind: AssetKind): kind is ScopedAssetKind {
  return kind === "prompt" || kind === "skill" || kind === "command"
}

export const CustomTab = Schema.Literals(["use", "compose", "assets"])
export type CustomTab = typeof CustomTab.Type

export const SelectedUse = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("builtin"),
    id: Schema.Literals(["build", "plan", "meta"]),
  }),
  Schema.Struct({
    kind: Schema.Literal("profile"),
    path: Schema.String,
  }),
])
export type SelectedUse = typeof SelectedUse.Type

export const TaskMaterial = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["file", "image"]),
  path: Schema.String,
  name: Schema.String,
  mime: Schema.String,
  dataUrl: Schema.optional(Schema.String),
})
export type TaskMaterial = typeof TaskMaterial.Type

export const PendingTaskStartStage = Schema.Literals([
  "creating",
  "created_open_failed",
  "admitting",
  "admit_unknown",
  "admitted",
])
export type PendingTaskStartStage = typeof PendingTaskStartStage.Type

export const PendingTaskStart = Schema.Struct({
  sessionID: Schema.String,
  firstInputID: Schema.String,
  text: Schema.String,
  materials: Schema.Array(TaskMaterial),
  stage: PendingTaskStartStage,
  createdSessionID: Schema.optional(Schema.String),
  composition: Schema.optional(Composition.CompositionInput),
  expectedPlanDigest: Schema.optional(Composition.Digest),
  model: Schema.optional(Model.Selection),
})
export type PendingTaskStart = typeof PendingTaskStart.Type

const StoredTarget = Schema.Struct({
  scope: AssetPlacement.Scope,
  root: Schema.String,
})

const StoredPromptRef = Schema.Struct({
  kind: Schema.Literal("prompt"),
  relativePath: Schema.String,
  revision: Schema.String,
  target: Schema.optional(StoredTarget),
})

const StoredSkillRef = Schema.Struct({
  kind: Schema.Literal("skill"),
  relativePath: Schema.String,
  revision: Schema.String,
  target: Schema.optional(StoredTarget),
})

const StoredCommandRef = Schema.Struct({
  kind: Schema.Literal("command"),
  relativePath: Schema.String,
  revision: Schema.String,
  target: Schema.optional(StoredTarget),
})

export const StoredBinding = Schema.Struct({
  prompts: Schema.Array(StoredPromptRef),
  skills: Schema.Array(StoredSkillRef),
  commands: Schema.Array(StoredCommandRef),
})
export type StoredBinding = typeof StoredBinding.Type

export const StoredRoot = Schema.Union([
  Schema.Struct({
    source: Schema.Literal("builtin"),
    id: Schema.Literals(["build", "plan", "meta"]),
    revision: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    source: Schema.Literal("asset"),
    kind: Schema.Literal("agent"),
    id: Schema.String,
    relativePath: Schema.String,
    revision: Schema.String,
  }),
])
export type StoredRoot = typeof StoredRoot.Type

export const StoredAgentRef = Schema.Struct({
  kind: Schema.Literal("agent"),
  relativePath: Schema.String,
  revision: Schema.String,
  name: Schema.optional(Schema.String),
})
export type StoredAgentRef = typeof StoredAgentRef.Type

export const StoredWorkflowRef = Schema.Struct({
  kind: Schema.Literal("workflow"),
  relativePath: Schema.String,
  revision: Schema.String,
  name: Schema.optional(Schema.String),
})
export type StoredWorkflowRef = typeof StoredWorkflowRef.Type

export const StoredMcpBinding = Schema.Struct({
  serverName: Schema.String,
  ref: Schema.Struct({
    relativePath: Schema.String,
    revision: Schema.String,
  }),
  transport: Schema.Literals(["stdio", "remote"]),
  command: Schema.optional(Schema.Array(Schema.String)),
  url: Schema.optional(Schema.String),
  credentialRef: Schema.optional(Schema.String),
})
export type StoredMcpBinding = typeof StoredMcpBinding.Type

export const ComposeDraft = Schema.Struct({
  kind: Schema.Literals(["new", "profile"]),
  profilePath: Schema.optional(Schema.String),
  baseRevision: Schema.optional(Schema.String),
  name: Schema.String,
  description: Schema.String,
  path: Schema.String,
  root: StoredRoot,
  agents: Schema.Array(StoredAgentRef),
  bindings: Schema.Record(Schema.String, StoredBinding),
  workflow: Schema.optional(StoredWorkflowRef),
  mcpBindings: Schema.Array(StoredMcpBinding),
  presentation: Schema.optional(Composition.Presentation),
  requestedCapabilities: Schema.optional(Schema.Array(Schema.String)),
  selectedConsumer: Schema.String,
  dirty: Schema.Boolean,
  editVersion: Schema.Number,
})
export type ComposeDraft = typeof ComposeDraft.Type

export const CustomWorkspaceState = Persistence.struct({
  activeTab: CustomTab,
  selectedUse: SelectedUse,
  taskText: Schema.String,
  taskMaterials: Schema.Array(TaskMaterial),
  pendingStart: Persistence.optional(PendingTaskStart),
  compose: ComposeDraft,
})
export type CustomWorkspaceState = typeof CustomWorkspaceState.Type

export const CUSTOM_WORKSPACE_STORAGE_KEY = "custom.workspace.v1"

export function initialComposeDraft(rootID: BuiltinRootID = "build"): ComposeDraft {
  return {
    kind: "new",
    name: "",
    description: "",
    path: "",
    root: { source: "builtin", id: rootID },
    agents: [],
    bindings: {},
    mcpBindings: [],
    selectedConsumer: "orchestrator",
    dirty: false,
    editVersion: 0,
  }
}

export function initialCustomWorkspaceState(): CustomWorkspaceState {
  return {
    activeTab: "use",
    selectedUse: { kind: "builtin", id: "build" },
    taskText: "",
    taskMaterials: [],
    compose: initialComposeDraft("build"),
  }
}

export const consumerKeyForAgent = Composition.consumerKeyForAgent

export function normalizeStoredBindings(bindings: Record<string, StoredBinding>): Record<string, StoredBinding> {
  const result: Record<string, StoredBinding> = {}

  for (const [key, binding] of Object.entries(bindings)) {
    const prompts = binding.prompts ?? []
    const skills = binding.skills ?? []
    const commands = binding.commands ?? []

    if (prompts.length === 0 && skills.length === 0 && commands.length === 0) continue
    result[key] = {
      prompts: prompts.map((item) => ({ ...item, ...(item.target ? { target: { ...item.target } } : {}) })),
      skills: skills.map((item) => ({ ...item, ...(item.target ? { target: { ...item.target } } : {}) })),
      commands: commands.map((item) => ({ ...item, ...(item.target ? { target: { ...item.target } } : {}) })),
    }
  }

  return result
}

export function bindingCount(binding: StoredBinding | undefined): number {
  if (!binding) return 0

  return binding.prompts.length + binding.skills.length + binding.commands.length
}

export function totalBindingsCount(bindings: Record<string, StoredBinding>): number {
  return Object.values(bindings).reduce((sum, binding) => sum + bindingCount(binding), 0)
}

/**
 * TemporaryInput does not carry mcpBindings; custom MCP bindings must be saved
 * into a CustomProfile first so selections are never silently dropped.
 */
export function requiresProfileForMcp(draft: Pick<ComposeDraft, "mcpBindings">): boolean {
  return draft.mcpBindings.length > 0
}

export function toTemporaryCompositionInput(draft: ComposeDraft) {
  if (requiresProfileForMcp(draft)) return undefined

  const rawRoot =
    draft.root.source === "builtin"
      ? draft.root.revision
        ? { source: "builtin" as const, id: draft.root.id, revision: draft.root.revision }
        : { source: "builtin" as const, id: draft.root.id }
      : {
          source: "asset" as const,
          kind: "agent" as const,
          id: draft.root.id,
          relativePath: draft.root.relativePath,
          revision: draft.root.revision,
        }

  const raw = {
    source: "temporary" as const,
    root: rawRoot,
    agents: draft.agents.map((agent) => ({
      kind: "agent" as const,
      relativePath: agent.relativePath,
      revision: agent.revision,
    })),
    bindings: normalizeStoredBindings(draft.bindings),
    ...(draft.workflow
      ? {
          workflow: {
            kind: "workflow" as const,
            relativePath: draft.workflow.relativePath,
            revision: draft.workflow.revision,
          },
        }
      : {}),
    presentation: draft.presentation ?? ("native" as const),
    requestedCapabilities: [...(draft.requestedCapabilities ?? [])],
  }

  return Option.getOrUndefined(Schema.decodeUnknownOption(Composition.TemporaryInput)(raw))
}

export function validateMcpBindingInput(binding: StoredMcpBinding): {
  valid: boolean
  decoded?: McpScope.McpServerBinding
  error?: string
} {
  const normalized: Record<string, unknown> = {
    serverName: binding.serverName.trim(),
    ref: {
      relativePath: binding.ref.relativePath.trim(),
      revision: binding.ref.revision.trim(),
    },
    transport: binding.transport,
    ...(binding.transport === "stdio" && binding.command && binding.command.length > 0
      ? { command: binding.command.map((item) => item.trim()).filter(Boolean) }
      : {}),
    ...(binding.transport === "remote" && binding.url?.trim() ? { url: binding.url.trim() } : {}),
    ...(binding.credentialRef?.trim() ? { credentialRef: binding.credentialRef.trim() } : {}),
  }

  try {
    const decoded = McpScope.decodeBinding(normalized)

    if (decoded.transport === "stdio" && (!decoded.command || decoded.command.length === 0)) {
      return { valid: false, error: "Stdio MCP binding requires a non-empty command." }
    }

    if (decoded.transport === "remote" && !decoded.url) {
      return { valid: false, error: "Remote MCP binding requires an http(s) URL without credentials." }
    }

    return { valid: true, decoded }
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function buildProfileCandidate(
  draft: ComposeDraft,
  resolvedRoot?: Composition.Root,
): { candidate?: CustomProfile.Candidate; error?: string } {
  const name = Schema.decodeUnknownOption(CustomProfile.Name)(draft.name.trim())

  if (Option.isNone(name)) return { error: "invalid_name" }
  const description = Schema.decodeUnknownOption(CustomProfile.Description)(draft.description)

  if (Option.isNone(description)) return { error: "invalid_description" }
  const relativePath = draft.path.trim()

  if (!relativePath) return { error: "missing_path" }

  const rootCandidate =
    draft.root.source === "asset"
      ? {
          source: "asset" as const,
          kind: "agent" as const,
          id: draft.root.id,
          relativePath: draft.root.relativePath,
          revision: draft.root.revision,
        }
      : draft.root.revision
        ? { source: "builtin" as const, id: draft.root.id, revision: draft.root.revision }
        : resolvedRoot &&
            resolvedRoot.source === "builtin" &&
            resolvedRoot.id === draft.root.id &&
            resolvedRoot.revision
          ? { source: "builtin" as const, id: resolvedRoot.id, revision: resolvedRoot.revision }
          : undefined

  if (!rootCandidate) return { error: "missing_root_revision" }

  const mcpBindings: McpScope.McpServerBinding[] = []

  for (const item of draft.mcpBindings) {
    const checked = validateMcpBindingInput(item)

    if (!checked.valid || !checked.decoded) return { error: checked.error ?? "invalid_mcp_binding" }
    mcpBindings.push(checked.decoded)
  }

  try {
    const profile = CustomProfile.decodeProfile({
      kind: "custom-profile",
      name: name.value,
      description: description.value,
      root: rootCandidate,
      agents: draft.agents.map((agent) => ({
        kind: "agent" as const,
        relativePath: agent.relativePath,
        revision: agent.revision,
      })),
      bindings: normalizeStoredBindings(draft.bindings),
      ...(draft.workflow
        ? {
            workflow: {
              kind: "workflow" as const,
              relativePath: draft.workflow.relativePath,
              revision: draft.workflow.revision,
            },
          }
        : {}),
      presentation: draft.presentation ?? "native",
      requestedCapabilities: [...(draft.requestedCapabilities ?? [])],
      mcpBindings,
    })

    return {
      candidate: new CustomProfile.Candidate({
        name: name.value,
        description: description.value,
        relativePath,
        profile,
      }),
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

type ProfileBindingRefLike = {
  readonly relativePath: string
  readonly revision: string
  readonly target?: { readonly scope: AssetPlacement.Scope; readonly root: string } | null
}

type ProfileBindingLike = {
  readonly prompts?: readonly ProfileBindingRefLike[]
  readonly skills?: readonly ProfileBindingRefLike[]
  readonly commands?: readonly ProfileBindingRefLike[]
}

type ProfileMcpBindingLike = {
  readonly serverName: string
  readonly ref: { readonly relativePath: string; readonly revision: string }
  readonly transport: "stdio" | "remote"
  readonly command?: readonly string[] | null
  readonly url?: string | null
  readonly credentialRef?: string | null
}

type ProfileInfoLike = {
  readonly name: string
  readonly description: string
  readonly relativePath: string
  readonly revision: string
  readonly profile: {
    readonly root?:
      | { readonly source: "builtin"; readonly id: BuiltinRootID; readonly revision?: string }
      | {
          readonly source: "asset"
          readonly kind: "agent"
          readonly id: string
          readonly relativePath: string
          readonly revision: string
        }
    readonly agents: readonly { readonly relativePath: string; readonly revision: string }[]
    readonly bindings?: Readonly<Record<string, ProfileBindingLike>>
    readonly workflow?: { readonly relativePath: string; readonly revision: string } | null
    readonly presentation?: Composition.Presentation
    readonly requestedCapabilities?: readonly string[]
    readonly mcpBindings?: readonly ProfileMcpBindingLike[]
  }
}

export function composeDraftFromProfile(
  info: ProfileInfoLike,
  agentNameByPath?: ReadonlyMap<string, string>,
  workflowName?: string,
): ComposeDraft {
  const root: StoredRoot = info.profile.root
    ? info.profile.root.source === "asset"
      ? {
          source: "asset",
          kind: "agent",
          id: info.profile.root.id,
          relativePath: info.profile.root.relativePath,
          revision: info.profile.root.revision,
        }
      : {
          source: "builtin",
          id: info.profile.root.id,
          revision: info.profile.root.revision,
        }
    : { source: "builtin", id: "meta" }

  const bindings: Record<string, StoredBinding> = {}

  for (const [consumer, binding] of Object.entries(info.profile.bindings ?? {})) {
    bindings[consumer] = {
      prompts: (binding.prompts ?? []).map((ref) => ({
        kind: "prompt",
        relativePath: ref.relativePath,
        revision: ref.revision,
        ...(ref.target ? { target: { scope: ref.target.scope, root: ref.target.root } } : {}),
      })),
      skills: (binding.skills ?? []).map((ref) => ({
        kind: "skill",
        relativePath: ref.relativePath,
        revision: ref.revision,
        ...(ref.target ? { target: { scope: ref.target.scope, root: ref.target.root } } : {}),
      })),
      commands: (binding.commands ?? []).map((ref) => ({
        kind: "command",
        relativePath: ref.relativePath,
        revision: ref.revision,
        ...(ref.target ? { target: { scope: ref.target.scope, root: ref.target.root } } : {}),
      })),
    }
  }

  return {
    kind: "profile",
    profilePath: info.relativePath,
    baseRevision: info.revision,
    name: info.name,
    description: info.description,
    path: info.relativePath,
    root,
    agents: info.profile.agents.map((agent) => ({
      kind: "agent",
      relativePath: agent.relativePath,
      revision: agent.revision,
      ...(agentNameByPath?.get(agent.relativePath) ? { name: agentNameByPath.get(agent.relativePath) } : {}),
    })),
    bindings,
    ...(info.profile.workflow
      ? {
          workflow: {
            kind: "workflow",
            relativePath: info.profile.workflow.relativePath,
            revision: info.profile.workflow.revision,
            ...(workflowName ? { name: workflowName } : {}),
          },
        }
      : {}),
    mcpBindings: (info.profile.mcpBindings ?? []).map((binding) => ({
      serverName: binding.serverName,
      ref: { relativePath: binding.ref.relativePath, revision: binding.ref.revision },
      transport: binding.transport,
      ...(binding.command ? { command: [...binding.command] } : {}),
      ...(binding.url ? { url: binding.url } : {}),
      ...(binding.credentialRef ? { credentialRef: binding.credentialRef } : {}),
    })),
    ...(info.profile.presentation ? { presentation: info.profile.presentation } : {}),
    ...(info.profile.requestedCapabilities ? { requestedCapabilities: [...info.profile.requestedCapabilities] } : {}),
    selectedConsumer: "orchestrator",
    dirty: false,
    editVersion: 0,
  }
}

export function composeDraftFromSnapshot(snapshot: CompositionSnapshotV2): ComposeDraft {
  const root: StoredRoot = snapshot.data.root
    ? snapshot.data.root.source === "asset"
      ? {
          source: "asset",
          kind: "agent",
          id: snapshot.data.root.id,
          relativePath: snapshot.data.root.relativePath,
          revision: snapshot.data.root.revision,
        }
      : {
          source: "builtin",
          id: snapshot.data.root.id,
          ...(snapshot.data.root.revision ? { revision: snapshot.data.root.revision } : {}),
        }
    : { source: "builtin", id: "meta" }

  const agents: StoredAgentRef[] = (snapshot.data.executors ?? []).map((executor) => ({
    kind: "agent",
    relativePath: executor.relativePath,
    revision: executor.revision,
    name: executor.info.name,
  }))

  const bindings: Record<string, StoredBinding> = {}

  for (const [consumer, bundle] of Object.entries(snapshot.data.bindings ?? {})) {
    bindings[consumer] = {
      prompts: bundle.prompts.map((item) => ({
        kind: "prompt",
        relativePath: item.relativePath,
        revision: item.revision,
        ...(item.target ? { target: { scope: item.target.scope, root: item.target.root } } : {}),
      })),
      skills: bundle.skills.map((item) => ({
        kind: "skill",
        relativePath: item.relativePath,
        revision: item.revision,
        ...(item.target ? { target: { scope: item.target.scope, root: item.target.root } } : {}),
      })),
      commands: bundle.commands.map((item) => ({
        kind: "command",
        relativePath: item.relativePath,
        revision: item.revision,
        ...(item.target ? { target: { scope: item.target.scope, root: item.target.root } } : {}),
      })),
    }
  }

  return {
    kind: snapshot.profilePath ? "profile" : "new",
    ...(snapshot.profilePath ? { profilePath: snapshot.profilePath } : {}),
    ...(snapshot.profileRevision ? { baseRevision: snapshot.profileRevision } : {}),
    name: snapshot.profilePath
      ? (snapshot.profilePath
          .replace(/\.yaml$/i, "")
          .split("/")
          .at(-1) ?? "")
      : "",
    description: "",
    path: snapshot.profilePath ?? "",
    root,
    agents,
    bindings,
    ...(snapshot.data.workflow
      ? {
          workflow: {
            kind: "workflow",
            relativePath: snapshot.data.workflow.relativePath,
            revision: snapshot.data.workflow.revision,
            name: snapshot.data.workflow.name,
          },
        }
      : {}),
    // SnapshotV2 stores MCP fingerprints rather than transport command/url; profile-backed
    // drafts hydrate full mcpBindings when Compose loads the authoritative profile file.
    mcpBindings: [],
    selectedConsumer: "orchestrator",
    dirty: !snapshot.profilePath,
    editVersion: 1,
  }
}

export type WorkflowStepDiagnostic = {
  stepID: string
  stepName: string
  agent: string
  matched: boolean
  matchesRootOnly: boolean
}

/**
 * Mirrors Core's CompositionResolver workflow validation: step.agent must match
 * a declared executor member (`agents`), never `root`.
 */
export function diagnoseWorkflowSteps(
  steps: readonly Pick<WorkflowAssetStepDef, "id" | "name" | "agent">[],
  members: readonly { id: string; name: string }[],
  rootID: string,
): WorkflowStepDiagnostic[] {
  const knownMembers = new Set(members.flatMap((member) => [member.id, member.name]))

  return steps.map((step) => {
    const matched = knownMembers.has(step.agent)

    return {
      stepID: step.id,
      stepName: step.name,
      agent: step.agent,
      matched,
      matchesRootOnly: !matched && step.agent === rootID,
    }
  })
}

export function findDanglingBindingConsumers(
  bindings: Record<string, StoredBinding>,
  knownConsumers: readonly string[],
): string[] {
  const allowed = new Set(["orchestrator", ...knownConsumers])

  return Object.entries(bindings)
    .filter(([consumer, binding]) => bindingCount(binding) > 0 && !allowed.has(consumer))
    .map(([consumer]) => consumer)
}

export function sameMaterials(a: readonly TaskMaterial[], b: readonly TaskMaterial[]): boolean {
  if (a.length !== b.length) return false

  return a.every(
    (item, index) =>
      item.id === b[index]?.id &&
      item.kind === b[index]?.kind &&
      item.path === b[index]?.path &&
      item.mime === b[index]?.mime &&
      item.dataUrl === b[index]?.dataUrl,
  )
}

/**
 * Reserves a stable sessionID + firstInputID for a two-stage Start Task attempt.
 * Reuses existing IDs when retrying an unacknowledged start or admission; allocates
 * fresh IDs after prior admission or when no pending attempt exists.
 */
export function preparePendingTaskStart(
  existing: PendingTaskStart | undefined,
  text: string,
  materials: readonly TaskMaterial[],
): PendingTaskStart {
  if (
    existing &&
    (existing.stage === "creating" || existing.stage === "admitting" || existing.stage === "admit_unknown")
  ) {
    if (existing.text === text && sameMaterials(existing.materials, materials)) {
      return existing
    }
  }

  return {
    sessionID: Session.ID.create(),
    firstInputID: SessionMessage.ID.create(),
    text,
    materials: materials.map((item) => ({ ...item })),
    stage: "creating",
  }
}

/**
 * First-admission-wins: editing task text/materials after admission (or deciding to
 * change the prompt content) MUST allocate a new SessionMessage.ID instead of reusing
 * the admitted ID.
 */
export function nextInputIDAfterEdit(
  pending: PendingTaskStart | undefined,
  nextText: string,
  nextMaterials: readonly TaskMaterial[],
): PendingTaskStart | undefined {
  if (!pending) return undefined

  if (pending.text === nextText && sameMaterials(pending.materials, nextMaterials)) return pending

  // A changed uncertain admission keeps the created Session and uses a new input ID.
  if ((pending.stage === "admitting" || pending.stage === "admit_unknown") && pending.createdSessionID) {
    return {
      ...pending,
      firstInputID: SessionMessage.ID.create(),
      text: nextText,
      materials: nextMaterials.map((item) => ({ ...item })),
    }
  }

  // Once admitted (or if user explicitly changes content while creating), a fresh attempt
  // uses a fresh SessionMessage.ID so first-admission-wins is never violated.
  return undefined
}

function absolutePath(directory: string, value: string): string {
  if (value.startsWith("/")) return value

  if (/^[A-Za-z]:[\\/]/.test(value) || /^[A-Za-z]:$/.test(value)) return value

  if (value.startsWith("\\\\") || value.startsWith("//")) return value

  return `${directory.replace(/[\\/]+$/, "")}/${value}`
}

export function buildFirstPromptPayload(input: {
  sessionID: string
  firstInputID: string
  directory: string
  text: string
  materials: readonly TaskMaterial[]
}) {
  const files = input.materials.map((item) => {
    if (item.kind === "image" && item.dataUrl) {
      return {
        uri: item.dataUrl,
        name: item.name,
      }
    }

    const resolved = absolutePath(input.directory, item.path)

    return {
      uri: `file://${encodeFilePath(resolved)}`,
      name: item.name,
    }
  })

  return {
    id: input.firstInputID,
    sessionID: input.sessionID,
    delivery: "steer" as const,
    text: input.text.trim(),
    ...(files.length > 0 ? { files } : {}),
  }
}
