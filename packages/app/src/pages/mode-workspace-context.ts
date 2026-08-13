import { type Accessor, createContext, createMemo, useContext } from "solid-js"
import type { HomeProjectSelection } from "@/pages/layout/helpers"
import type { ServerConnection } from "@/context/server"
import { type DirectorySDK } from "@/context/sdk"
import { AssetWorkbench } from "@/components/chat/asset-workbench"
import { useGlobal } from "@/context/global"
import { useServer } from "@/context/server"
import type { AssistantNavSelection } from "@/components/assistant-nav-model"

export type ModeWorkspaceAssetContext = {
  chatDirSdk: Accessor<DirectorySDK | undefined>
  chatAssetList: Accessor<{ assets: AssetWorkbench.AssetInput[]; invalid: AssetWorkbench.AssetRow[] } | undefined>
  chatSystemData: Accessor<{ command: any[]; agent: any[]; mcp: any } | undefined>
  mergedAssetData: Accessor<{ assets: AssetWorkbench.AssetInput[]; invalid: AssetWorkbench.AssetRow[] }>
  refetchAssets: () => void
}

const ModeWorkspaceAssetCtx = createContext<ModeWorkspaceAssetContext>()

export function useModeWorkspaceAssets() {
  return useContext(ModeWorkspaceAssetCtx)
}

export { ModeWorkspaceAssetCtx }

/** Coding 模式左侧栏 ↔ 主区共享的 project selection（联动联动） */
export type CodingSelectionValue = {
  selection: HomeProjectSelection
  selectServer: (key: ServerConnection.Key) => void
  selectProject: (key: ServerConnection.Key, directory: string) => void
}

export const CodingSelectionCtx = createContext<CodingSelectionValue>()

export function useCodingSelection() {
  return useContext(CodingSelectionCtx)!
}

/** Assistant 模式左侧栏 ↔ 主区会话列表共享的实体选中态（D5，计划 §3.3）。 */
export type AssistantSelectionValue = {
  selection: AssistantNavSelection
  select: (selection: AssistantNavSelection) => void
}

export const AssistantSelectionCtx = createContext<AssistantSelectionValue>()

export function useAssistantSelection() {
  return useContext(AssistantSelectionCtx)!
}

/** Chat 首页 Location 解析：当前 server 的 lastSession 目录，回退首个 project worktree。 */
export function useChatDirectory() {
  const global = useGlobal()
  const server = useServer()
  const conn = createMemo(() => server.current ?? server.list[0])
  const ctx = createMemo(() => {
    const current = conn()
    if (!current) return undefined
    return global.ensureServerCtx(current)
  })
  const directory = createMemo(() => {
    const current = ctx()
    if (!current) return undefined
    return global.lastSession.directory(current.sdk.scope) ?? current.projects.list()[0]?.worktree
  })
  return { conn, ctx, directory }
}
