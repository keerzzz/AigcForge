import type { DirectorySDK } from "@/context/sdk"
import type { AssetKindId } from "@aigcfroge/schema/asset"
import { AGENTS_DIR, COMMANDS_DIR, MCPS_DIR, PROMPTS_DIR, SKILLS_DIR } from "@aigcfroge/core/constants"
import type { CandidateInfo } from "./prompt-asset-candidate"

/** kind → owner 目录（apply 后刷新文件树用）。workflow 未开闸，兜底到 PROMPTS_DIR。 */
export function assetKindDir(kind: AssetKindId) {
  if (kind === "skill") return SKILLS_DIR
  if (kind === "mcp") return MCPS_DIR
  if (kind === "command") return COMMANDS_DIR
  if (kind === "agent") return AGENTS_DIR
  return PROMPTS_DIR
}

/** 按 kind 调对应 content API，返回注入 Composer 的文本。 */
export async function fetchAssetInsertText(client: DirectorySDK["client"], kind: AssetKindId, path: string) {
  if (kind === "prompt") return (await client.promptAsset.content({ path }, { throwOnError: true })).data?.template ?? ""
  if (kind === "skill") return (await client.skillAsset.content({ path }, { throwOnError: true })).data?.content ?? ""
  if (kind === "mcp") return (await client.mcpAsset.content({ path }, { throwOnError: true })).data?.configJson ?? ""
  if (kind === "command") return (await client.commandAsset.content({ path }, { throwOnError: true })).data?.source ?? ""
  if (kind === "agent") return (await client.agentAsset.content({ path }, { throwOnError: true })).data?.source ?? ""
  return ""
}

/** URL search param 是外部输入：收窄到已实现 content() 的 5 种 kind（workflow 未开闸）。 */
export function parseInsertKind(value: string | undefined): AssetKindId | undefined {
  if (value === "prompt") return value
  if (value === "skill") return value
  if (value === "mcp") return value
  if (value === "command") return value
  if (value === "agent") return value
  return undefined
}

/** 右栏候选 apply：保持 kind 与 candidate 的判别联合，不绕过生成 SDK 类型。 */
export async function applyAssetCandidate(
  client: DirectorySDK["client"],
  input: { sessionID: string; candidate: CandidateInfo; overwrite: boolean },
) {
  const shared = {
    sessionID: input.sessionID,
    baseRevision: input.candidate.revision ?? undefined,
    overwrite: input.overwrite,
  }
  const candidate = input.candidate

  if (candidate.kind === "skill") {
    return client.skillAsset.apply(
      { ...shared, candidate: { ...candidate.candidate, relativePath: candidate.relativePath } },
      { throwOnError: true },
    )
  }
  if (candidate.kind === "mcp") {
    return client.mcpAsset.apply(
      { ...shared, candidate: { ...candidate.candidate, relativePath: candidate.relativePath } },
      { throwOnError: true },
    )
  }
  if (candidate.kind === "command") {
    return client.commandAsset.apply(
      { ...shared, candidate: { ...candidate.candidate, relativePath: candidate.relativePath } },
      { throwOnError: true },
    )
  }
  if (candidate.kind === "agent") {
    return client.agentAsset.apply(
      { ...shared, candidate: { ...candidate.candidate, relativePath: candidate.relativePath } },
      { throwOnError: true },
    )
  }
  return client.promptAsset.apply(
    { ...shared, candidate: { ...candidate.candidate, relativePath: candidate.relativePath } },
    { throwOnError: true },
  )
}

/** 按 kind 分派 list（右栏 apply 后 refetch 用）。 */
export async function listAssets(client: DirectorySDK["client"], kind: AssetKindId) {
  if (kind === "skill") return client.skillAsset.list(undefined, { throwOnError: true })
  if (kind === "mcp") return client.mcpAsset.list(undefined, { throwOnError: true })
  if (kind === "command") return client.commandAsset.list(undefined, { throwOnError: true })
  if (kind === "agent") return client.agentAsset.list(undefined, { throwOnError: true })
  return client.promptAsset.list(undefined, { throwOnError: true })
}
