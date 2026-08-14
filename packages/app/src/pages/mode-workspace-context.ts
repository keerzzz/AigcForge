import { type Accessor, createContext, createMemo, useContext } from "solid-js"
import type { HomeProjectSelection } from "@/pages/layout/helpers"
import type { ServerConnection } from "@/context/server"
import { type DirectorySDK } from "@/context/sdk"
import { AssetWorkbench } from "@/components/chat/asset-workbench"
import { useGlobal } from "@/context/global"
import { useServer } from "@/context/server"
import type { AssistantNavSelection } from "@/components/assistant-nav-model"
import type { State } from "@/context/global-sync/types"

export type ModeWorkspaceAssetContext = {
  chatDirSdk: Accessor<DirectorySDK | undefined>
  chatAssetList: Accessor<{ assets: AssetWorkbench.AssetInput[]; invalid: AssetWorkbench.AssetRow[] } | undefined>
  chatSystemData: Accessor<State | undefined>
  mergedAssetData: Accessor<{ assets: AssetWorkbench.AssetInput[]; invalid: AssetWorkbench.AssetRow[] }>
  refetchAssets: () => void
}

const ModeWorkspaceAssetCtx = createContext<ModeWorkspaceAssetContext>()

export function useModeWorkspaceAssets() {
  return useContext(ModeWorkspaceAssetCtx)
}

export { ModeWorkspaceAssetCtx }

/** Project selection shared by the Coding sidebar and main content. */
export type CodingSelectionValue = {
  selection: HomeProjectSelection
  selectServer: (key: ServerConnection.Key) => void
  selectProject: (key: ServerConnection.Key, directory: string) => void
}

export const CodingSelectionCtx = createContext<CodingSelectionValue>()

export function useCodingSelection() {
  return useContext(CodingSelectionCtx)!
}

/** Entity selection shared by the Assistant sidebar and session list. */
export type AssistantSelectionValue = {
  selection: AssistantNavSelection
  select: (selection: AssistantNavSelection) => void
}

export const AssistantSelectionCtx = createContext<AssistantSelectionValue>()

export function useAssistantSelection() {
  return useContext(AssistantSelectionCtx)!
}

/** Resolve the Chat location from the current server's last session or first project. */
export function useModeDirectory() {
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
