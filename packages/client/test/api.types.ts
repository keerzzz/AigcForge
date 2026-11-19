import { Effect, Schema } from "effect"
import { CommandAsset } from "@aigcfroge/schema/command-asset"
import { PromptAsset } from "@aigcfroge/schema/prompt-asset"
import { AbsolutePath, AigcForge, AssetPlacement, Session, SkillAsset, type AppApi } from "../src/effect"
import type {
  AigcForgeClient,
  CommandAssetApplyInput,
  CommandAssetApplyOutput,
  CommandAssetContentInput,
  CommandAssetContentOutput,
  CommandAssetDeleteInput,
  CommandAssetDeleteOutput,
  CommandAssetInfo,
  CommandAssetInspectInput,
  CommandAssetInspectOutput,
  CommandAssetInvocation,
  CommandAssetListInput,
  CommandAssetListOutput,
  CommandAssetName,
  CommandAssetRevision,
  CommandAssetSource,
  CommandAssetSummary,
  PromptAssetApplyInput,
  PromptAssetApplyOutput,
  PromptAssetContentInput,
  PromptAssetContentOutput,
  PromptAssetDeleteInput,
  PromptAssetDeleteOutput,
  PromptAssetInfo,
  PromptAssetInspectInput,
  PromptAssetInspectOutput,
  PromptAssetListInput,
  PromptAssetListOutput,
  PromptAssetName,
  PromptAssetRevision,
  PromptAssetSummary,
  PromptAssetTemplate,
  SkillAssetApplyOutput,
  SkillAssetInfo,
  SkillAssetInspectOutput,
  SkillAssetListOutput,
} from "../src/promise"
import type { DiscoverOptions } from "../src/service"

type EffectClient = Effect.Success<ReturnType<typeof AigcForge.make>>

declare const effectClient: EffectClient
declare const promiseClient: AigcForgeClient

const exactVersion: DiscoverOptions = { version: "2.0.0" }
const compatibleVersion: DiscoverOptions = { version: (version) => version.startsWith("2.") }

const effectApi: AppApi<unknown> = effectClient

const effectSession: Effect.Effect<Session.Info, unknown> = effectClient.session.get({
  sessionID: Session.ID.make("ses_test"),
})

declare const sessionID: Parameters<typeof effectApi.session.instructions.entry.list>[0]["sessionID"]

const effectList: Effect.Effect<
  ReadonlyArray<{ readonly key: string; readonly value: unknown }>,
  unknown
> = effectApi.session.instructions.entry.list({ sessionID })
const effectPut: Effect.Effect<void, unknown> = effectApi.session.instructions.entry.put({
  sessionID,
  key: "review-notes",
  value: { text: "Check the diff" },
})
const effectRemove: Effect.Effect<void, unknown> = effectApi.session.instructions.entry.remove({
  sessionID,
  key: "review-notes",
})

const promiseList: Promise<ReadonlyArray<{ readonly key: string; readonly value: unknown }>> =
  promiseClient.session.instructions.entry.list({ sessionID: "ses_test" })
const promisePut: Promise<void> = promiseClient.session.instructions.entry.put({
  sessionID: "ses_test",
  key: "review-notes",
  value: { text: "Check the diff" },
})
const promiseRemove: Promise<void> = promiseClient.session.instructions.entry.remove({
  sessionID: "ses_test",
  key: "review-notes",
})

const skillQuery = { directory: "/tmp/project/packages/app", workspace: "wrk_test" }
const skillCandidate = {
  name: "review",
  description: "Review changes.",
  slash: false,
  content: "Read the diff.",
  triggers: [],
  tags: [],
  relativePath: "review.md",
}
const skillTarget = { scope: "project" as const, root: "/tmp/project/.aigcfroge/skills" }
const canonicalCandidate = SkillAsset.Candidate.make(skillCandidate)
const canonicalTarget = AssetPlacement.Target.make({ ...skillTarget, root: AbsolutePath.make(skillTarget.root) })

const effectSkillInspect: Effect.Effect<SkillAsset.Inspection, unknown> = effectApi["skill-asset"].inspect({
  ...skillQuery,
  sessionID,
  candidate: canonicalCandidate,
  scope: canonicalTarget.scope,
})
const effectSkillList: Effect.Effect<
  {
    readonly assets: ReadonlyArray<SkillAsset.Summary>
    readonly invalid: ReadonlyArray<SkillAsset.InvalidEntry>
    readonly target?: AssetPlacement.Target | undefined
  },
  unknown
> = effectApi["skill-asset"].list({ ...skillQuery, scope: canonicalTarget.scope })
const effectSkillContent: Effect.Effect<SkillAsset.Info, unknown> = effectApi["skill-asset"].content({
  ...skillQuery,
  scope: canonicalTarget.scope,
  path: skillCandidate.relativePath,
})
const effectSkillApply: Effect.Effect<SkillAsset.Info, unknown> = effectApi["skill-asset"].apply({
  ...skillQuery,
  sessionID,
  candidate: canonicalCandidate,
  target: canonicalTarget,
  overwrite: false,
})
const effectSkillDelete: Effect.Effect<void, unknown> = effectApi["skill-asset"].delete({
  ...skillQuery,
  sessionID,
  relativePath: skillCandidate.relativePath,
  target: canonicalTarget,
  baseRevision: "a".repeat(64),
})
const effectLegacySkill: Effect.Effect<SkillAsset.Info, unknown> = effectApi["skill-asset"].apply({
  ...skillQuery,
  sessionID,
  candidate: canonicalCandidate,
  overwrite: false,
})

const promiseSkillInspect: Promise<SkillAssetInspectOutput> = promiseClient["skill-asset"].inspect({
  ...skillQuery,
  sessionID: "ses_test",
  candidate: skillCandidate,
  scope: "global",
})
const promiseInspectionValue: SkillAssetInspectOutput = {
  relativePath: skillCandidate.relativePath,
  exists: false,
  revision: null,
  nameConflict: false,
  pathConflict: false,
  target: skillTarget,
}
const promiseSkillList: Promise<SkillAssetListOutput> = promiseClient["skill-asset"].list({
  ...skillQuery,
  scope: "project",
})
const promiseSkillContent: Promise<SkillAssetInfo> = promiseClient["skill-asset"].content({
  ...skillQuery,
  scope: "project",
  path: skillCandidate.relativePath,
})
const promiseSkillApply: Promise<SkillAssetApplyOutput> = promiseClient["skill-asset"].apply({
  ...skillQuery,
  sessionID: "ses_test",
  candidate: skillCandidate,
  target: skillTarget,
  overwrite: false,
})
const promiseSkillDelete: Promise<void> = promiseClient["skill-asset"].delete({
  ...skillQuery,
  sessionID: "ses_test",
  relativePath: skillCandidate.relativePath,
  target: skillTarget,
  baseRevision: "a".repeat(64),
})
const promiseLegacySkill: Promise<SkillAssetApplyOutput> = promiseClient["skill-asset"].apply({
  ...skillQuery,
  sessionID: "ses_test",
  candidate: skillCandidate,
  overwrite: false,
})

const commandQuery = { directory: "/tmp/project/packages/app", workspace: "wrk_command" }
const commandCandidate = {
  name: "review-command",
  description: "Review the selected Command owner.",
  invocation: "/review-command",
  args: "",
  source: "",
  relativePath: "review-command.md",
}
const commandTarget = { scope: "global" as const, root: "/tmp/config/aigcfroge/commands" }
const canonicalCommandCandidate = Schema.decodeUnknownSync(CommandAsset.Candidate)(commandCandidate)
const canonicalCommandTarget = AssetPlacement.Target.make({
  ...commandTarget,
  root: AbsolutePath.make(commandTarget.root),
})

const effectCommandInspect: Effect.Effect<CommandAsset.Inspection, unknown> = effectApi["command-asset"].inspect({
  ...commandQuery,
  sessionID,
  candidate: canonicalCommandCandidate,
  scope: canonicalCommandTarget.scope,
})
const effectCommandList: Effect.Effect<
  {
    readonly assets: ReadonlyArray<CommandAsset.Summary>
    readonly invalid: ReadonlyArray<CommandAsset.InvalidEntry>
    readonly target?: AssetPlacement.Target | undefined
  },
  unknown
> = effectApi["command-asset"].list({ ...commandQuery, scope: canonicalCommandTarget.scope })
const effectCommandContent: Effect.Effect<CommandAsset.Info, unknown> = effectApi["command-asset"].content({
  ...commandQuery,
  scope: canonicalCommandTarget.scope,
  path: commandCandidate.relativePath,
})
const effectCommandApply: Effect.Effect<CommandAsset.Info, unknown> = effectApi["command-asset"].apply({
  ...commandQuery,
  sessionID,
  candidate: canonicalCommandCandidate,
  target: canonicalCommandTarget,
  overwrite: false,
})
const effectCommandDelete: Effect.Effect<void, unknown> = effectApi["command-asset"].delete({
  ...commandQuery,
  sessionID,
  relativePath: commandCandidate.relativePath,
  target: canonicalCommandTarget,
  baseRevision: "b".repeat(64),
})
const effectLegacyCommand: Effect.Effect<CommandAsset.Info, unknown> = effectApi["command-asset"].apply({
  ...commandQuery,
  sessionID,
  candidate: canonicalCommandCandidate,
  overwrite: false,
})
const effectLegacyCommandDelete: Effect.Effect<void, unknown> = effectApi["command-asset"].delete({
  ...commandQuery,
  sessionID,
  relativePath: commandCandidate.relativePath,
})

const commandPublicFields: {
  name: CommandAssetName
  invocation: CommandAssetInvocation
  source: CommandAssetSource
  revision: CommandAssetRevision
} = { ...commandCandidate, revision: "b".repeat(64) }
const commandSummary: CommandAssetSummary = {
  kind: "command",
  name: commandPublicFields.name,
  description: commandCandidate.description,
  relativePath: commandCandidate.relativePath,
  revision: commandPublicFields.revision,
}
const legacyCommandInfo: CommandAssetInfo = {
  ...commandSummary,
  invocation: commandPublicFields.invocation,
  source: commandPublicFields.source,
}
const commandInspectInput: CommandAssetInspectInput = {
  ...commandQuery,
  sessionID: "ses_command",
  candidate: commandCandidate,
  scope: commandTarget.scope,
}
const commandInspectionValue: CommandAssetInspectOutput = {
  relativePath: commandCandidate.relativePath,
  exists: false,
  revision: null,
  nameConflict: false,
  pathConflict: false,
  target: commandTarget,
}
const commandListInput: CommandAssetListInput = { ...commandQuery, scope: "project", search: "REVIEW" }
const commandContentInput: CommandAssetContentInput = {
  ...commandQuery,
  scope: "location",
  path: commandCandidate.relativePath,
}
const commandApplyInput: CommandAssetApplyInput = {
  ...commandQuery,
  sessionID: "ses_command",
  candidate: commandCandidate,
  target: commandTarget,
  overwrite: false,
}
const commandDeleteInput: CommandAssetDeleteInput = {
  ...commandQuery,
  sessionID: "ses_command",
  relativePath: commandCandidate.relativePath,
  target: commandTarget,
  baseRevision: "b".repeat(64),
}
const promiseCommandInspect: Promise<CommandAssetInspectOutput> =
  promiseClient["command-asset"].inspect(commandInspectInput)
const promiseCommandList: Promise<CommandAssetListOutput> = promiseClient["command-asset"].list(commandListInput)
const promiseCommandContent: Promise<CommandAssetContentOutput> =
  promiseClient["command-asset"].content(commandContentInput)
const promiseCommandApply: Promise<CommandAssetApplyOutput> = promiseClient["command-asset"].apply(commandApplyInput)
const promiseCommandDelete: Promise<CommandAssetDeleteOutput> =
  promiseClient["command-asset"].delete(commandDeleteInput)
const promiseLegacyCommand: Promise<CommandAssetApplyOutput> = promiseClient["command-asset"].apply({
  ...commandQuery,
  sessionID: "ses_command",
  candidate: commandCandidate,
  overwrite: false,
})
const promiseLegacyCommandDelete: Promise<CommandAssetDeleteOutput> = promiseClient["command-asset"].delete({
  ...commandQuery,
  sessionID: "ses_command",
  relativePath: commandCandidate.relativePath,
})
const commandNullApplyRevision: CommandAssetApplyInput = {
  ...commandApplyInput,
  // Command HTTP callers omit an absent revision; null is only a Core service input.
  // @ts-expect-error HTTP baseRevision remains an optional string.
  baseRevision: null,
}
const commandNullDeleteRevision: CommandAssetDeleteInput = {
  ...commandDeleteInput,
  // @ts-expect-error HTTP baseRevision remains an optional string.
  baseRevision: null,
}

const promptQuery = { directory: "/tmp/project/packages/app", workspace: "wrk_prompt" }
const promptCandidate = {
  name: "review-prompt",
  description: "Review the selected Prompt owner.",
  template: "\uFEFF \tReview {{CODE}}, $ARGUMENTS, $HOME and 中文.\r\n\r\nKeep trailing space. \t\r\n",
  relativePath: "review-prompt.md",
}
const promptTarget = { scope: "global" as const, root: "/tmp/config/aigcfroge/prompts" }
const canonicalPromptCandidate = Schema.decodeUnknownSync(PromptAsset.Candidate)(promptCandidate)
const canonicalPromptTarget = AssetPlacement.Target.make({
  ...promptTarget,
  root: AbsolutePath.make(promptTarget.root),
})

const effectPromptInspect: Effect.Effect<PromptAsset.Inspection, unknown> = effectApi["prompt-asset"].inspect({
  ...promptQuery,
  sessionID,
  candidate: canonicalPromptCandidate,
  scope: canonicalPromptTarget.scope,
})
const effectPromptList: Effect.Effect<
  {
    readonly assets: ReadonlyArray<PromptAsset.Summary>
    readonly invalid: ReadonlyArray<PromptAsset.InvalidEntry>
    readonly target?: AssetPlacement.Target | undefined
  },
  unknown
> = effectApi["prompt-asset"].list({ ...promptQuery, scope: canonicalPromptTarget.scope })
const effectPromptContent: Effect.Effect<PromptAsset.Info, unknown> = effectApi["prompt-asset"].content({
  ...promptQuery,
  scope: canonicalPromptTarget.scope,
  path: promptCandidate.relativePath,
})
const effectPromptApply: Effect.Effect<PromptAsset.Info, unknown> = effectApi["prompt-asset"].apply({
  ...promptQuery,
  sessionID,
  candidate: canonicalPromptCandidate,
  target: canonicalPromptTarget,
  overwrite: false,
})
const effectPromptDelete: Effect.Effect<void, unknown> = effectApi["prompt-asset"].delete({
  ...promptQuery,
  sessionID,
  relativePath: promptCandidate.relativePath,
  target: canonicalPromptTarget,
  baseRevision: "b".repeat(64),
})
const effectLegacyPrompt: Effect.Effect<PromptAsset.Info, unknown> = effectApi["prompt-asset"].apply({
  ...promptQuery,
  sessionID,
  candidate: canonicalPromptCandidate,
  overwrite: false,
})
const effectLegacyPromptDelete: Effect.Effect<void, unknown> = effectApi["prompt-asset"].delete({
  ...promptQuery,
  sessionID,
  relativePath: promptCandidate.relativePath,
})
const effectPromptNullApplyRevision: Parameters<EffectClient["prompt-asset"]["apply"]>[0] = {
  ...promptQuery,
  sessionID,
  candidate: canonicalPromptCandidate,
  target: canonicalPromptTarget,
  overwrite: false,
  // @ts-expect-error Effect client inputs use decoded revisions and omit an absent value.
  baseRevision: null,
}
const effectPromptNullDeleteRevision: Parameters<EffectClient["prompt-asset"]["delete"]>[0] = {
  ...promptQuery,
  sessionID,
  relativePath: promptCandidate.relativePath,
  target: canonicalPromptTarget,
  // @ts-expect-error Effect client inputs use decoded revisions and omit an absent value.
  baseRevision: null,
}

const promptPublicFields: {
  name: PromptAssetName
  template: PromptAssetTemplate
  revision: PromptAssetRevision
} = { ...promptCandidate, revision: "b".repeat(64) }
const promptSummary: PromptAssetSummary = {
  kind: "prompt",
  name: promptPublicFields.name,
  description: promptCandidate.description,
  relativePath: promptCandidate.relativePath,
  revision: promptPublicFields.revision,
}
const legacyPromptInfo: PromptAssetInfo = {
  ...promptSummary,
  template: promptPublicFields.template,
}
const promptInspectInput: PromptAssetInspectInput = {
  ...promptQuery,
  sessionID: "ses_prompt",
  candidate: promptCandidate,
  scope: promptTarget.scope,
}
const promptInspectionValue: PromptAssetInspectOutput = {
  relativePath: promptCandidate.relativePath,
  exists: false,
  revision: null,
  nameConflict: false,
  pathConflict: false,
  target: promptTarget,
}
const promptListInput: PromptAssetListInput = { ...promptQuery, scope: "project", search: "REVIEW" }
const promptContentInput: PromptAssetContentInput = {
  ...promptQuery,
  scope: "location",
  path: promptCandidate.relativePath,
}
const promptApplyInput: PromptAssetApplyInput = {
  ...promptQuery,
  sessionID: "ses_prompt",
  candidate: promptCandidate,
  target: promptTarget,
  overwrite: false,
}
const promptDeleteInput: PromptAssetDeleteInput = {
  ...promptQuery,
  sessionID: "ses_prompt",
  relativePath: promptCandidate.relativePath,
  target: promptTarget,
  baseRevision: "b".repeat(64),
}
const promisePromptInspect: Promise<PromptAssetInspectOutput> =
  promiseClient["prompt-asset"].inspect(promptInspectInput)
const promisePromptList: Promise<PromptAssetListOutput> = promiseClient["prompt-asset"].list(promptListInput)
const promisePromptContent: Promise<PromptAssetContentOutput> =
  promiseClient["prompt-asset"].content(promptContentInput)
const promisePromptApply: Promise<PromptAssetApplyOutput> = promiseClient["prompt-asset"].apply(promptApplyInput)
const promisePromptDelete: Promise<PromptAssetDeleteOutput> = promiseClient["prompt-asset"].delete(promptDeleteInput)
const promiseLegacyPrompt: Promise<PromptAssetApplyOutput> = promiseClient["prompt-asset"].apply({
  ...promptQuery,
  sessionID: "ses_prompt",
  candidate: promptCandidate,
  overwrite: false,
})
const promiseLegacyPromptDelete: Promise<PromptAssetDeleteOutput> = promiseClient["prompt-asset"].delete({
  ...promptQuery,
  sessionID: "ses_prompt",
  relativePath: promptCandidate.relativePath,
})
// Promise inputs follow the existing JSON wire codec, which accepts null revisions.
const promptNullApplyRevision: PromptAssetApplyInput = {
  ...promptApplyInput,
  baseRevision: null,
}
const promptNullDeleteRevision: PromptAssetDeleteInput = {
  ...promptDeleteInput,
  baseRevision: null,
}

void [
  effectSession,
  effectList,
  effectPut,
  effectRemove,
  promiseList,
  promisePut,
  promiseRemove,
  effectSkillInspect,
  effectSkillList,
  effectSkillContent,
  effectSkillApply,
  effectSkillDelete,
  effectLegacySkill,
  promiseSkillInspect,
  promiseInspectionValue,
  promiseSkillList,
  promiseSkillContent,
  promiseSkillApply,
  promiseSkillDelete,
  promiseLegacySkill,
  effectCommandInspect,
  effectCommandList,
  effectCommandContent,
  effectCommandApply,
  effectCommandDelete,
  effectLegacyCommand,
  effectLegacyCommandDelete,
  legacyCommandInfo,
  commandInspectionValue,
  promiseCommandInspect,
  promiseCommandList,
  promiseCommandContent,
  promiseCommandApply,
  promiseCommandDelete,
  promiseLegacyCommand,
  promiseLegacyCommandDelete,
  commandNullApplyRevision,
  commandNullDeleteRevision,
  promptQuery,
  promptCandidate,
  promptTarget,
  canonicalPromptCandidate,
  canonicalPromptTarget,
  effectPromptInspect,
  effectPromptList,
  effectPromptContent,
  effectPromptApply,
  effectPromptDelete,
  effectLegacyPrompt,
  effectLegacyPromptDelete,
  effectPromptNullApplyRevision,
  effectPromptNullDeleteRevision,
  promptPublicFields,
  promptSummary,
  legacyPromptInfo,
  promptInspectInput,
  promptInspectionValue,
  promptListInput,
  promptContentInput,
  promptApplyInput,
  promptDeleteInput,
  promisePromptInspect,
  promisePromptList,
  promisePromptContent,
  promisePromptApply,
  promisePromptDelete,
  promiseLegacyPrompt,
  promiseLegacyPromptDelete,
  promptNullApplyRevision,
  promptNullDeleteRevision,
  exactVersion,
  compatibleVersion,
]
