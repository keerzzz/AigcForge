import type { DirectorySDK } from "@/context/sdk"
import type { AssetKindId } from "@aigcfroge/schema/asset"
import { AGENTS_DIR, COMMANDS_DIR, MCPS_DIR, PROMPTS_DIR, SKILLS_DIR } from "@aigcfroge/core/constants"

/** kind → owner 目录（apply 后刷新文件树用）。workflow 未开闸，兜底到 PROMPTS_DIR。 */
export function assetKindDir(kind: AssetKindId) {
  if (kind === "skill") return SKILLS_DIR
  if (kind === "mcp") return MCPS_DIR
  if (kind === "command") return COMMANDS_DIR
  if (kind === "agent") return AGENTS_DIR
  return PROMPTS_DIR
}

/**
 * Insert 流程共用：按 kind 调对应 content() API，返回注入 Composer 的文本。
 * 各 kind 的可注入字段不同（prompt=template、skill=content、mcp=configJson、
 * command/agent=markdown source），统一在此分派（M3 计划 §7.2）。
 */
export async function fetchAssetInsertText(client: DirectorySDK["client"], kind: AssetKindId, path: string) {
  if (kind === "prompt") return (await client.promptAsset.content({ path })).data?.template ?? ""
  if (kind === "skill") return (await client.skillAsset.content({ path })).data?.content ?? ""
  if (kind === "mcp") return (await client.mcpAsset.content({ path })).data?.configJson ?? ""
  if (kind === "command") return (await client.commandAsset.content({ path })).data?.source ?? ""
  if (kind === "agent") return (await client.agentAsset.content({ path })).data?.source ?? ""
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

/**
 * 右栏候选 apply：按 kind 分派到对应 apply 端点。candidate 字段在
 * normalizeProposeCandidate 阶段已按 kind 校验，此处补 relativePath 统一透传；
 * 5 个端点的 candidate 形状各异，类型边界由 normalize 保证（故 as never 单点收窄）。
 */
export async function applyAssetCandidate(
  client: DirectorySDK["client"],
  input: {
    sessionID: string
    kind: AssetKindId
    candidate: Record<string, unknown>
    relativePath: string
    baseRevision: string | undefined
    overwrite: boolean
  },
) {
  const body = {
    sessionID: input.sessionID,
    candidate: { ...input.candidate, relativePath: input.relativePath },
    baseRevision: input.baseRevision,
    overwrite: input.overwrite,
  }
  const result: { data?: unknown; error?: unknown } = await (() => {
    if (input.kind === "skill") return client.skillAsset.apply(body as never)
    if (input.kind === "mcp") return client.mcpAsset.apply(body as never)
    if (input.kind === "command") return client.commandAsset.apply(body as never)
    if (input.kind === "agent") return client.agentAsset.apply(body as never)
    return client.promptAsset.apply(body as never)
  })()
  if (result.error) throw new Error(typeof result.error === "string" ? result.error : (result.error as any).message ?? "Apply failed")
  return result
}

/** 按 kind 分派 list（右栏 apply 后 refetch 用）。 */
export async function listAssets(client: DirectorySDK["client"], kind: AssetKindId) {
  if (kind === "skill") return client.skillAsset.list()
  if (kind === "mcp") return client.mcpAsset.list()
  if (kind === "command") return client.commandAsset.list()
  if (kind === "agent") return client.agentAsset.list()
  return client.promptAsset.list()
}
