export * as CompositionReference from "./reference"

import { Result } from "effect"
import { Composition } from "@omnixa/schema/composition"
import { AssetPlacement } from "@omnixa/schema/asset-placement"
import { AbsolutePath } from "@omnixa/schema/schema"
import { AgentAssetPath } from "../agent-asset/path"
import { PromptAssetPath } from "../prompt-asset/path"
import { SkillAssetPath } from "../skill-asset/path"
import { WorkflowAssetPath } from "../workflow-asset/path"
import { CommandAssetPath } from "../command-asset/path"
import { MCPAssetPath } from "../mcp-asset/path"

const validators = {
  agent: AgentAssetPath.validateRelativePath,
  prompt: PromptAssetPath.validateRelativePath,
  skill: SkillAssetPath.validateRelativePath,
  workflow: WorkflowAssetPath.validateRelativePath,
  command: CommandAssetPath.validateRelativePath,
  mcp: MCPAssetPath.validateRelativePath,
} satisfies Record<Composition.AllowedKind, (relativePath: string) => string>

export function normalize(kind: Composition.AllowedKind, relativePath: string) {
  return validators[kind](relativePath)
}

export type Entry = {
  readonly relativePath: string
  readonly target?: AssetPlacement.Target
}

/** Owner-normalized paths determine identity; revisions and asset existence do not change it. */
export function key(kind: Composition.AllowedKind, normalizedPath: string, target?: AssetPlacement.Target) {
  return JSON.stringify([kind, target?.scope ?? null, target?.root ?? null, normalizedPath])
}

export function matches(
  kind: Composition.AllowedKind,
  normalizedPath: string,
  candidatePath: string,
  queryTarget?: AssetPlacement.Target,
  candidateTarget?: AssetPlacement.Target,
) {
  // Historical records can contain paths rejected by the current asset owner.
  const candidate = Result.try(() => normalize(kind, candidatePath))
  return (
    Result.isSuccess(candidate) &&
    key(kind, candidate.success, candidateTarget) === key(kind, normalizedPath, queryTarget)
  )
}

/** Historical omission is interpreted at the saved Location without inspecting current files. */
export function legacyTarget(kind: Composition.AllowedKind, directory: string) {
  const root =
    kind === "prompt"
      ? PromptAssetPath.resolveOwnerRoot(directory)
      : kind === "skill"
        ? SkillAssetPath.resolveOwnerRoot(directory)
        : kind === "command"
          ? CommandAssetPath.resolveOwnerRoot(directory)
          : undefined
  if (root === undefined) return
  return new AssetPlacement.Target({ scope: "location", root: AbsolutePath.make(root) })
}

export function entries(snapshot: Composition.Snapshot, kind: Composition.AllowedKind): ReadonlyArray<Entry> {
  if (snapshot.version === 1) {
    if (kind === "prompt") return snapshot.data.prompts.map(entry)
    if (kind === "skill") return snapshot.data.skills.map(entry)
    return []
  }
  if (kind === "agent")
    return [
      ...(snapshot.data.root?.source === "asset" ? [snapshot.data.root.relativePath] : []),
      ...snapshot.data.agents.map((ref) => ref.relativePath),
      ...(snapshot.data.executors ?? []).flatMap((executor) => [
        executor.relativePath,
        ...(executor.info.originRelativePath === undefined ? [] : [executor.info.originRelativePath]),
      ]),
    ].map((relativePath) => ({ relativePath }))
  if (kind === "workflow") return snapshot.data.workflow ? [{ relativePath: snapshot.data.workflow.relativePath }] : []
  if (kind === "mcp")
    return [
      ...snapshot.data.mcp.bindings.map((binding) => binding.ref.relativePath),
      ...snapshot.data.mcp.tools.map((tool) => tool.ref.relativePath),
    ].map((relativePath) => ({ relativePath }))
  // Every binding is a durable dependency, including consumers not selected now.
  return [snapshot.data, ...Object.values(snapshot.data.bindings ?? {})].flatMap((binding) => {
    if (kind === "prompt") return binding.prompts.map(entry)
    if (kind === "skill") return binding.skills.map(entry)
    return binding.commands.map(entry)
  })
}

export function paths(snapshot: Composition.Snapshot, kind: Composition.AllowedKind): ReadonlyArray<string> {
  return entries(snapshot, kind).map((ref) => ref.relativePath)
}

function entry(ref: Entry): Entry {
  return { relativePath: ref.relativePath, ...(ref.target === undefined ? {} : { target: ref.target }) }
}
