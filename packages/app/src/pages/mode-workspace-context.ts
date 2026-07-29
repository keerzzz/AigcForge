import { type Accessor, createContext, createMemo, useContext } from "solid-js"
import { type DirectorySDK } from "@/context/sdk"
import { AssetWorkbench } from "@/components/chat/asset-workbench"
import { useGlobal } from "@/context/global"
import { useServer } from "@/context/server"

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

/**
 * Chat 首页 Location 解析：当前 server 的 lastSession 目录，回退首个 project worktree。
 * ChatSidebar / ChatFeatureSidebar / Home 资产 fetch 共用，确保 Location 展示与资产列表目录一致。
 * 定义在此处避免 mode-surfaces ↔ mode-workspace-slots 的循环依赖。
 */
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
