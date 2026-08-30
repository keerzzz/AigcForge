import { createContext, createEffect, useContext, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocation, useNavigate } from "@solidjs/router"
import { Dialog } from "@aigcfroge/ui/v2/dialog-v2"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { useDialog } from "@aigcfroge/ui/context/dialog"
import { useLanguage } from "@/context/language"
import type { AssetKind, AssetOrigin } from "@/components/chat/asset-workbench"

/**
 * Chat 工作区跨路由状态上下文（M2 Step 5）。
 * Provider 挂 Router 外，使 AssetWorkbenchTable 的筛选/搜索/选中状态跨页面导航保持。
 */
export type ChatWorkspaceState = {
  kindFilter: AssetKind
  search: string
  selectedPath: string | undefined
  originFilter: AssetOrigin | "all"
}

export type ChatWorkspaceContext = {
  state: ChatWorkspaceState
  setKindFilter: (kind: AssetKind) => void
  setSearch: (value: string) => void
  setOriginFilter: (origin: AssetOrigin | "all") => void
  select: (path: string | undefined) => void
  /** Composer 是否有未发送内容（Dirty Draft 用） */
  dirty: boolean
  setDirty: (value: boolean) => void
}

const Ctx = createContext<ChatWorkspaceContext>()

export function ChatWorkspaceProvider(props: ParentProps) {
  const [state, setState] = createStore<ChatWorkspaceState>({
    kindFilter: "all",
    search: "",
    selectedPath: undefined,
    originFilter: "all",
  })
  const [dirty, setDirty] = createStore({ value: false })

  const ctx: ChatWorkspaceContext = {
    state,
    setKindFilter: (kind) => setState("kindFilter", kind),
    setSearch: (value) => setState("search", value),
    setOriginFilter: (origin) => setState("originFilter", origin),
    select: (path) => setState("selectedPath", path),
    get dirty() {
      return dirty.value
    },
    setDirty: (v) => setDirty("value", v),
  }

  return <Ctx.Provider value={ctx}>{props.children}</Ctx.Provider>
}

export function useChatWorkspace(): ChatWorkspaceContext | undefined {
  return useContext(Ctx)
}

/**
 * Dirty Draft 路由守卫：监听 Composer dirty 状态 + location 变化。
 * 必须在 Router 内部渲染（需 useLocation）。
 * 当 dirty=true 且路由变化时，弹确认对话框：
 *   "Stay" → navigate 回原路由 + 不清 dirty
 *   "Leave" → 清 dirty + 保持新路由
 */
export function DirtyDraftGuard() {
  const language = useLanguage()
  const dialog = useDialog()
  const location = useLocation()
  const navigate = useNavigate()
  const workspace = useChatWorkspace()

  let prevPath = location.pathname
  let pending: "stay" | "leave" | null = null

  createEffect(() => {
    const path = location.pathname
    const isDirty = workspace?.dirty ?? false
    if (pending) {
      pending = null
      prevPath = path
      return
    }
    if (!isDirty) {
      prevPath = path
      return
    }
    if (path === prevPath) return

    const from = prevPath
    prevPath = path

    void dialog.show(() => (
      <Dialog title={language.t("chat.dirtyDraft.title")} description={language.t("chat.dirtyDraft.description")} fit>
        <div class="flex justify-end gap-2 p-2">
          <ButtonV2
            variant="neutral"
            onClick={() => {
              pending = "stay"
              navigate(from, { replace: true })
              dialog.close()
            }}
          >
            {language.t("chat.dirtyDraft.stay")}
          </ButtonV2>
          <ButtonV2
            variant="contrast"
            onClick={() => {
              pending = "leave"
              workspace?.setDirty(false)
              dialog.close()
            }}
          >
            {language.t("chat.dirtyDraft.leave")}
          </ButtonV2>
        </div>
      </Dialog>
    ))
  })

  return null
}
