import { createContext, useContext, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import type { AssetKind } from "@/components/chat/asset-workbench"

/**
 * Chat 工作区跨路由状态上下文（M2 Step 5）。
 * Provider 挂 Router 外，使 AssetWorkbenchTable 的筛选/搜索/选中状态跨页面导航保持。
 */
export type ChatWorkspaceState = {
  kindFilter: AssetKind
  search: string
  selectedPath: string | undefined
}

export type ChatWorkspaceContext = {
  state: ChatWorkspaceState
  setKindFilter: (kind: AssetKind) => void
  setSearch: (value: string) => void
  select: (path: string | undefined) => void
}

const Ctx = createContext<ChatWorkspaceContext>()

export function ChatWorkspaceProvider(props: ParentProps) {
  const [state, setState] = createStore<ChatWorkspaceState>({
    kindFilter: "all",
    search: "",
    selectedPath: undefined,
  })

  const ctx: ChatWorkspaceContext = {
    state,
    setKindFilter: (kind) => setState("kindFilter", kind),
    setSearch: (value) => setState("search", value),
    select: (path) => setState("selectedPath", path),
  }

  return <Ctx.Provider value={ctx}>{props.children}</Ctx.Provider>
}

export function useChatWorkspace(): ChatWorkspaceContext | undefined {
  return useContext(Ctx)
}
