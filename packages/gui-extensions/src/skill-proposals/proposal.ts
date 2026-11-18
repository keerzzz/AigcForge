import type {
  AgentAssetApplyOutput,
  AgentAssetContentOutput,
  AgentAssetListOutput,
  CommandAssetApplyOutput,
  CommandAssetContentOutput,
  CommandAssetListOutput,
  CommandInfo,
  LocationRef,
  McpAssetApplyOutput,
  McpAssetContentOutput,
  McpAssetListOutput,
  PluginAssetApplyOutput,
  PluginAssetContentOutput,
  PluginAssetListOutput,
  PromptAssetApplyOutput,
  PromptAssetContentOutput,
  PromptAssetListOutput,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionMessageToolStateCompleted,
  SkillAssetApplyOutput,
  SkillAssetContentOutput,
  SkillAssetListOutput,
  SkillInfo,
  WorkflowAssetApplyOutput,
  WorkflowAssetContentOutput,
  WorkflowAssetListOutput,
} from "@aigcfroge/client/promise"
import { AgentAsset } from "@aigcfroge/schema/agent-asset"
import { AssetPlacement } from "@aigcfroge/schema/asset-placement"
import { CommandAsset } from "@aigcfroge/schema/command-asset"
import { MCPAsset } from "@aigcfroge/schema/mcp-asset"
import { PluginAsset } from "@aigcfroge/schema/plugin-asset"
import { PromptAsset } from "@aigcfroge/schema/prompt-asset"
import { SkillAsset } from "@aigcfroge/schema/skill-asset"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { Match, Option, Predicate, Schema, type Types } from "effect"
import { SkillProposalContract } from "./contract"
import { candidateKey } from "./index"

const decodeAgentInput = Schema.decodeUnknownOption(SkillProposalContract.AgentInput)

const decodeAgentFacts = Schema.decodeUnknownOption(SkillProposalContract.AgentFacts)

const decodeAgentInfo = Schema.decodeUnknownOption(AgentAsset.Info)

const decodeAgentResult = Schema.decodeUnknownOption(AgentAsset.ApplyResult)

const decodeInput = Schema.decodeUnknownOption(SkillProposalContract.Input)

const decodeCommandInput = Schema.decodeUnknownOption(SkillProposalContract.CommandInput)

const decodePromptInput = Schema.decodeUnknownOption(SkillProposalContract.PromptInput)

const decodeMCPInput = Schema.decodeUnknownOption(SkillProposalContract.MCPInput)

const decodePluginInput = Schema.decodeUnknownOption(SkillProposalContract.PluginInput)

const decodeWorkflowInput = Schema.decodeUnknownOption(SkillProposalContract.WorkflowInput)

const decodeFacts = Schema.decodeUnknownOption(SkillProposalContract.Facts)

const decodeTarget = Schema.decodeUnknownOption(AssetPlacement.Target)

const decodeInspection = Schema.decodeUnknownOption(SkillAsset.Inspection)

const decodeCommandInspection = Schema.decodeUnknownOption(CommandAsset.Inspection)

const decodePromptInspection = Schema.decodeUnknownOption(PromptAsset.Inspection)

const decodeCommandFacts = Schema.decodeUnknownOption(SkillProposalContract.CommandFacts)

const decodePromptFacts = Schema.decodeUnknownOption(SkillProposalContract.PromptFacts)

const decodeMCPFacts = Schema.decodeUnknownOption(SkillProposalContract.MCPFacts)

const decodePluginFacts = Schema.decodeUnknownOption(SkillProposalContract.PluginFacts)

const decodeWorkflowFacts = Schema.decodeUnknownOption(SkillProposalContract.WorkflowFacts)

const decodeInfo = Schema.decodeUnknownOption(SkillAsset.Info)

const decodeCommandInfo = Schema.decodeUnknownOption(CommandAsset.Info)

const decodePromptInfo = Schema.decodeUnknownOption(PromptAsset.Info)

const decodeMCPInfo = Schema.decodeUnknownOption(MCPAsset.Info)

const decodePluginInfo = Schema.decodeUnknownOption(Schema.toCodecJson(PluginAsset.Info))

const decodeWorkflowInfo = Schema.decodeUnknownOption(Schema.toCodecJson(WorkflowAsset.Info))

class AgentCatalog extends Schema.Class<AgentCatalog>("AgentProposal.Catalog")({
  assets: Schema.Array(AgentAsset.Summary),
  invalid: Schema.Array(AgentAsset.InvalidEntry),
}) {}

const decodeAgentCatalog = Schema.decodeUnknownOption(AgentCatalog)

class Catalog extends Schema.Class<Catalog>("SkillProposal.Catalog")({
  assets: Schema.Array(SkillAsset.Summary),
  invalid: Schema.Array(SkillAsset.InvalidEntry),
  target: Schema.optionalKey(AssetPlacement.Target),
}) {}

class CommandCatalog extends Schema.Class<CommandCatalog>("CommandProposal.Catalog")({
  assets: Schema.Array(CommandAsset.Summary),
  invalid: Schema.Array(CommandAsset.InvalidEntry),
  target: Schema.optionalKey(AssetPlacement.Target),
}) {}

class PromptCatalog extends Schema.Class<PromptCatalog>("PromptProposal.Catalog")({
  assets: Schema.Array(PromptAsset.Summary),
  invalid: Schema.Array(PromptAsset.InvalidEntry),
  target: Schema.optionalKey(AssetPlacement.Target),
}) {}

class MCPCatalog extends Schema.Class<MCPCatalog>("MCPProposal.Catalog")({
  assets: Schema.Array(MCPAsset.Summary),
  invalid: Schema.Array(MCPAsset.InvalidEntry),
}) {}

class PluginCatalog extends Schema.Class<PluginCatalog>("PluginProposal.Catalog")({
  assets: Schema.Array(PluginAsset.Summary),
  invalid: Schema.Array(PluginAsset.InvalidEntry),
  bridged: Schema.Array(PluginAsset.BridgeEntry),
}) {}

class WorkflowCatalog extends Schema.Class<WorkflowCatalog>("WorkflowProposal.Catalog")({
  assets: Schema.Array(WorkflowAsset.Summary),
  invalid: Schema.Array(WorkflowAsset.InvalidEntry),
}) {}

const decodeCatalog = Schema.decodeUnknownOption(Catalog)

const decodeCommandCatalog = Schema.decodeUnknownOption(CommandCatalog)

const decodePromptCatalog = Schema.decodeUnknownOption(PromptCatalog)

const decodeMCPCatalog = Schema.decodeUnknownOption(MCPCatalog)

const decodePluginCatalog = Schema.decodeUnknownOption(Schema.toCodecJson(PluginCatalog))

const decodeWorkflowCatalog = Schema.decodeUnknownOption(Schema.toCodecJson(WorkflowCatalog))

function completedProposal(
  tool: SessionMessageAssistantTool,
): tool is SessionMessageAssistantTool & { state: SessionMessageToolStateCompleted } {
  return (
    (tool.name === "propose_skill_asset" ||
      tool.name === "propose_command_asset" ||
      tool.name === "propose_prompt_asset" ||
      tool.name === "propose_agent_asset" ||
      tool.name === "propose_mcp_asset" ||
      tool.name === "propose_plugin_asset" ||
      tool.name === "propose_workflow_asset") &&
    tool.state.status === "completed"
  )
}

export function read(tool: SessionMessageAssistantTool) {
  if (!completedProposal(tool)) return { kind: "invalid", issue: "proposal.pending" } as const

  const declaredInput =
    tool.name === "propose_agent_asset" && Object.hasOwn(tool.state.input, "configAgentID")
      ? tool.state.metadata && Object.hasOwn(tool.state.metadata, "candidate")
        ? tool.state.metadata.candidate
        : undefined
      : tool.state.input

  if (
    !Predicate.isObject(declaredInput) ||
    !Match.value(tool.name)
      .pipe(
        Match.when("propose_agent_asset", () => ["name", "description", "config", "source"]),
        Match.when("propose_command_asset", () => ["name", "description", "invocation", "source"]),
        Match.when("propose_prompt_asset", () => ["name", "description", "template"]),
        Match.when("propose_mcp_asset", () => ["name", "description", "command", "args", "env", "configJson"]),
        Match.when("propose_plugin_asset", () => ["name", "description", "content"]),
        Match.when("propose_workflow_asset", () => ["name", "description", "content"]),
        Match.orElse(() => ["name", "description", "slash", "content"]),
      )
      .every((key) => Object.hasOwn(declaredInput, key))
  )
    return { kind: "invalid", issue: "proposal.inputMissing" } as const

  const input = Match.value(tool.name).pipe(
    Match.when(
      "propose_agent_asset",
      () => ({ assetKind: "agent", value: Option.getOrUndefined(decodeAgentInput(declaredInput)) }) as const,
    ),
    Match.when(
      "propose_command_asset",
      () => ({ assetKind: "command", value: Option.getOrUndefined(decodeCommandInput(tool.state.input)) }) as const,
    ),
    Match.when(
      "propose_prompt_asset",
      () => ({ assetKind: "prompt", value: Option.getOrUndefined(decodePromptInput(tool.state.input)) }) as const,
    ),
    Match.when(
      "propose_mcp_asset",
      () => ({ assetKind: "mcp", value: Option.getOrUndefined(decodeMCPInput(tool.state.input)) }) as const,
    ),
    Match.when(
      "propose_plugin_asset",
      () => ({ assetKind: "plugin", value: Option.getOrUndefined(decodePluginInput(tool.state.input)) }) as const,
    ),
    Match.when(
      "propose_workflow_asset",
      () => ({ assetKind: "workflow", value: Option.getOrUndefined(decodeWorkflowInput(tool.state.input)) }) as const,
    ),
    Match.orElse(() => ({ assetKind: "skill", value: Option.getOrUndefined(decodeInput(tool.state.input)) }) as const),
  )

  if (!input.value) return { kind: "invalid", issue: "proposal.inputInvalid" } as const

  if (
    input.assetKind === "skill" &&
    (input.value.slash ||
      [tool.state.input.triggers, tool.state.input.tags].some(
        (value) => value !== undefined && (!Array.isArray(value) || value.length !== 0),
      ))
  )
    return { kind: "invalid", issue: "proposal.basicOnly" } as const

  const metadata = tool.state.metadata

  if (
    !metadata ||
    !["relativePath", "exists", "revision", "nameConflict", "pathConflict"].every((key) =>
      Object.hasOwn(metadata, key),
    ) ||
    (input.assetKind === "agent" && !Object.hasOwn(metadata, "warnings"))
  )
    return { kind: "invalid", issue: "proposal.factsMissing" } as const

  const facts = Match.value(input.assetKind).pipe(
    Match.when("agent", () => Option.getOrUndefined(decodeAgentFacts(metadata))),
    Match.when("command", () => Option.getOrUndefined(decodeCommandFacts(metadata))),
    Match.when("prompt", () => Option.getOrUndefined(decodePromptFacts(metadata))),
    Match.when("mcp", () => Option.getOrUndefined(decodeMCPFacts(metadata))),
    Match.when("plugin", () => Option.getOrUndefined(decodePluginFacts(metadata))),
    Match.when("workflow", () => Option.getOrUndefined(decodeWorkflowFacts(metadata))),
    Match.orElse(() => Option.getOrUndefined(decodeFacts(metadata))),
  )

  if (!facts || facts.exists !== (facts.revision !== null) || (facts.pathConflict && !facts.exists))
    return { kind: "invalid", issue: "proposal.factsInvalid" } as const

  // Plugin and Workflow candidates share a shape; the persisted tool name owns their identity.
  if (input.assetKind === "workflow")
    return {
      kind: "ready",
      assetKind: input.assetKind,
      candidate: {
        ...WorkflowAsset.Candidate.make({ ...input.value, relativePath: facts.relativePath }),
        relativePath: facts.relativePath,
      },
      facts,
    } as const

  if (input.assetKind === "plugin")
    return {
      kind: "ready",
      assetKind: input.assetKind,
      candidate: {
        ...PluginAsset.Candidate.make({ ...input.value, relativePath: facts.relativePath }),
        relativePath: facts.relativePath,
      },
      facts,
    } as const

  if (input.assetKind === "mcp")
    return {
      kind: "ready",
      assetKind: input.assetKind,
      candidate: MCPAsset.Candidate.make({ ...input.value, relativePath: facts.relativePath }),
      facts,
    } as const

  if (input.assetKind === "agent")
    return {
      kind: "ready",
      assetKind: input.assetKind,
      candidate: AgentAsset.Candidate.make({ ...input.value, relativePath: facts.relativePath }),
      facts,
    } as const

  const placement: Types.Mutable<Pick<SkillAsset.Info, "target">> = {}

  if (Object.hasOwn(metadata, "target")) {
    const target = Option.getOrUndefined(decodeTarget(metadata.target))

    if (!target) return { kind: "invalid", issue: "proposal.factsInvalid" } as const

    placement.target = target
  }

  if (input.assetKind === "prompt")
    return {
      kind: "ready",
      assetKind: input.assetKind,
      candidate: PromptAsset.Candidate.make({ ...input.value, relativePath: facts.relativePath }),
      facts,
      ...placement,
    } as const

  if (input.assetKind === "command")
    return {
      kind: "ready",
      assetKind: input.assetKind,
      candidate: CommandAsset.Candidate.make({ ...input.value, relativePath: facts.relativePath }),
      facts,
      ...placement,
    } as const

  return {
    kind: "ready",
    assetKind: input.assetKind,
    candidate: SkillAsset.Candidate.make({
      ...input.value,
      slash: false,
      triggers: [],
      tags: [],
      relativePath: facts.relativePath,
    }),
    facts,
    ...placement,
  } as const
}

export type Ready = Extract<ReturnType<typeof read>, { kind: "ready" }>

export function inspected(
  proposal: Extract<Ready, { assetKind: "skill" | "command" | "prompt" }>,
  // SAFETY: This HTTP reply parser checks own fields and the family's canonical Inspection/Facts before returning a review.
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- see SAFETY above
  response: unknown,
  requestedScope: AssetPlacement.Scope,
) {
  if (
    !Predicate.isObject(response) ||
    !Object.keys(
      Match.value(proposal.assetKind).pipe(
        Match.when("prompt", () => PromptAsset.Inspection.fields),
        Match.when("command", () => CommandAsset.Inspection.fields),
        Match.orElse(() => SkillAsset.Inspection.fields),
      ),
    ).every((key) => Object.hasOwn(response, key))
  )
    return undefined

  const inspection = Match.value(proposal.assetKind).pipe(
    Match.when("prompt", () => Option.getOrUndefined(decodePromptInspection(response))),
    Match.when("command", () => Option.getOrUndefined(decodeCommandInspection(response))),
    Match.orElse(() => Option.getOrUndefined(decodeInspection(response))),
  )

  const reviewed = Match.value(proposal).pipe(
    Match.when({ assetKind: "prompt" }, (selected) => {
      const facts = Option.getOrUndefined(decodePromptFacts(response))

      return facts ? { ...selected, facts } : undefined
    }),
    Match.when({ assetKind: "command" }, (selected) => {
      const facts = Option.getOrUndefined(decodeCommandFacts(response))

      return facts ? { ...selected, facts } : undefined
    }),
    Match.when({ assetKind: "skill" }, (selected) => {
      const facts = Option.getOrUndefined(decodeFacts(response))

      return facts ? { ...selected, facts } : undefined
    }),
    Match.exhaustive,
  )

  if (
    !inspection ||
    !reviewed ||
    inspection.target.scope !== requestedScope ||
    reviewed.facts.relativePath !== proposal.candidate.relativePath ||
    reviewed.facts.exists !== (reviewed.facts.revision !== null) ||
    (reviewed.facts.pathConflict && !reviewed.facts.exists)
  )
    return undefined

  return { ...reviewed, target: inspection.target }
}

export function list(messages: readonly SessionMessageInfo[], kind: Ready["assetKind"] = "skill") {
  return messages.flatMap((message) => {
    if (message.type !== "assistant") return []

    return message.content.flatMap((tool) => {
      if (tool.type !== "tool" || !completedProposal(tool)) return []

      if (tool.name !== `propose_${kind}_asset`) return []

      const name = Schema.decodeUnknownOption(Schema.String)(tool.state.input.name)

      return [
        {
          key: candidateKey(message.id, tool.id),
          name: Option.isSome(name) ? name.value : tool.id,
          tool,
          proposal: read(tool),
          // This is a derived identity, not a proposal store. Changed persisted input/facts revoke the old confirmation.
          stamp: JSON.stringify([message.id, tool.id, tool.state.input, tool.state.metadata, tool.state.content]),
        },
      ]
    })
  })
}

export function current(
  proposal: Ready,
  content:
    | SkillAssetContentOutput
    | CommandAssetContentOutput
    | PromptAssetContentOutput
    | AgentAssetContentOutput
    | McpAssetContentOutput
    | PluginAssetContentOutput
    | WorkflowAssetContentOutput,
  catalog:
    | SkillAssetListOutput
    | CommandAssetListOutput
    | PromptAssetListOutput
    | AgentAssetListOutput
    | McpAssetListOutput
    | PluginAssetListOutput
    | WorkflowAssetListOutput,
) {
  const candidate = proposal.candidate

  const info = Match.value(proposal.assetKind).pipe(
    Match.when("workflow", () => Option.getOrUndefined(decodeWorkflowInfo(content))),
    Match.when("plugin", () => Option.getOrUndefined(decodePluginInfo(content))),
    Match.when("mcp", () => Option.getOrUndefined(decodeMCPInfo(content))),
    Match.when("agent", () => Option.getOrUndefined(decodeAgentInfo(content))),
    Match.when("prompt", () => Option.getOrUndefined(decodePromptInfo(content))),
    Match.when("command", () => Option.getOrUndefined(decodeCommandInfo(content))),
    Match.orElse(() => Option.getOrUndefined(decodeInfo(content))),
  )

  const inventory = Match.value(proposal.assetKind).pipe(
    Match.when("workflow", () => Option.getOrUndefined(decodeWorkflowCatalog(catalog))),
    Match.when("plugin", () => Option.getOrUndefined(decodePluginCatalog(catalog))),
    Match.when("mcp", () => Option.getOrUndefined(decodeMCPCatalog(catalog))),
    Match.when("agent", () => Option.getOrUndefined(decodeAgentCatalog(catalog))),
    Match.when("prompt", () => Option.getOrUndefined(decodePromptCatalog(catalog))),
    Match.when("command", () => Option.getOrUndefined(decodeCommandCatalog(catalog))),
    Match.orElse(() => Option.getOrUndefined(decodeCatalog(catalog))),
  )

  if (
    !info ||
    !inventory ||
    info.relativePath !== candidate.relativePath ||
    inventory.invalid.some((entry) => entry.relativePath === candidate.relativePath)
  )
    return { kind: "blocked", issue: "error.current" } as const

  if (
    (proposal.assetKind === "skill" || proposal.assetKind === "command" || proposal.assetKind === "prompt") &&
    (info.kind !== proposal.assetKind ||
      !sameTarget(proposal.target, "target" in info ? info.target : undefined) ||
      !sameTarget(proposal.target, "target" in inventory ? inventory.target : undefined))
  )
    return { kind: "blocked", issue: "error.current" } as const

  if (inventory.assets.some((entry) => entry.name === candidate.name && entry.relativePath !== candidate.relativePath))
    return { kind: "blocked", issue: "error.nameConflict" } as const

  const summary = inventory.assets.find((entry) => entry.relativePath === candidate.relativePath)

  if (
    !summary ||
    summary.revision !== info.revision ||
    summary.name !== info.name ||
    summary.description !== info.description
  )
    return { kind: "blocked", issue: "error.changed" } as const

  return { kind: "ready", current: info } as const
}

export function applied(
  proposal: Ready,
  response:
    | SkillAssetApplyOutput
    | CommandAssetApplyOutput
    | PromptAssetApplyOutput
    | AgentAssetApplyOutput
    | McpAssetApplyOutput
    | PluginAssetApplyOutput
    | WorkflowAssetApplyOutput,
) {
  if (proposal.assetKind === "agent") {
    const candidate = proposal.candidate
    const result = Option.getOrUndefined(decodeAgentResult(response))

    if (
      !result ||
      result.asset.relativePath !== candidate.relativePath ||
      result.asset.name !== candidate.name ||
      result.asset.description !== candidate.description ||
      result.asset.config !== candidate.config ||
      result.asset.source !== candidate.source ||
      result.asset.handoffs.length !== 0
    )
      return undefined

    return { ...result.asset, warnings: result.warnings }
  }

  const info = Match.value(proposal.assetKind).pipe(
    Match.when("workflow", () => Option.getOrUndefined(decodeWorkflowInfo(response))),
    Match.when("plugin", () => Option.getOrUndefined(decodePluginInfo(response))),
    Match.when("mcp", () => Option.getOrUndefined(decodeMCPInfo(response))),
    Match.when("prompt", () => Option.getOrUndefined(decodePromptInfo(response))),
    Match.when("command", () => Option.getOrUndefined(decodeCommandInfo(response))),
    Match.orElse(() => Option.getOrUndefined(decodeInfo(response))),
  )

  if (
    !info ||
    info.relativePath !== proposal.candidate.relativePath ||
    info.name !== proposal.candidate.name ||
    info.description !== proposal.candidate.description
  )
    return undefined

  if (proposal.assetKind === "workflow") {
    if (info.kind !== "workflow" || info.content !== proposal.candidate.content) return undefined

    return info
  }

  if (proposal.assetKind === "plugin") {
    if (info.kind !== "plugin" || info.content !== proposal.candidate.content) return undefined

    return info
  }

  if (proposal.assetKind === "mcp") {
    const candidate = proposal.candidate

    if (
      info.kind !== "mcp" ||
      info.command !== candidate.command ||
      info.args.length !== candidate.args.length ||
      info.args.some((value, index) => value !== candidate.args[index]) ||
      Object.keys(info.env).length !== Object.keys(candidate.env).length ||
      Object.entries(candidate.env).some(([key, value]) => !Object.hasOwn(info.env, key) || info.env[key] !== value) ||
      info.configJson !== candidate.configJson
    )
      return undefined

    return info
  }

  if (proposal.assetKind === "prompt") {
    if (
      info.kind !== "prompt" ||
      !sameTarget(proposal.target, info.target) ||
      info.template !== proposal.candidate.template
    )
      return undefined

    return info
  }

  if (proposal.assetKind === "command") {
    const candidate = proposal.candidate

    if (
      info.kind !== "command" ||
      !sameTarget(proposal.target, info.target) ||
      info.invocation !== candidate.invocation ||
      info.args !== candidate.args ||
      info.source !== candidate.source
    )
      return undefined

    return info
  }

  if (
    info.kind !== "skill" ||
    !sameTarget(proposal.target, info.target) ||
    info.content !== proposal.candidate.content ||
    info.slash ||
    info.triggers.length !== 0 ||
    info.tags.length !== 0
  )
    return undefined

  return info
}

function sameTarget(expected: AssetPlacement.Target | undefined, actual: AssetPlacement.Target | undefined) {
  if (!expected || !actual) return expected === actual

  return expected.scope === actual.scope && expected.root === actual.root
}

export function native(
  asset: Pick<SkillAssetApplyOutput, "relativePath" | "name" | "description" | "content" | "target">,
  location: LocationRef,
  skills: readonly SkillInfo[],
) {
  // Explicit targets were checked at readback; only legacy replies derive their owner from the Session Location.
  // ConfigSkillPlugin.refresh and SkillFile.id decide the native winner and ID.
  const path =
    (asset.target?.root ?? location.directory.replace(/[\\/]+$/, "") + "/.aigcfroge/skills")
      .replaceAll("\\", "/")
      .replace(/\/+$/, "") +
    "/" +
    asset.relativePath

  return skills.find(
    (skill) =>
      skill.path.replaceAll("\\", "/") === path &&
      skill.name === asset.name &&
      (skill.description ?? "") === asset.description &&
      skill.content === asset.content,
  )
}

export function nativeCommand(
  asset: Pick<CommandAssetApplyOutput, "relativePath" | "description">,
  commands: readonly CommandInfo[],
) {
  // ConfigCommandPlugin.decode owns the filename lookup. Public Command.Info carries no path/body provenance.
  const name = asset.relativePath.replace(/\.md$/, "")

  return commands.find((command) => command.name === name && (command.description ?? "") === asset.description)
}

export * as SkillProposal from "./proposal"
