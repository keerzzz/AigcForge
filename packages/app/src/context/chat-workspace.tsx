import { createContext, onCleanup, untrack, useContext, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { useBeforeLeave } from "@solidjs/router"
import { Dialog } from "@aigcfroge/ui/v2/dialog-v2"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { useDialog } from "@aigcfroge/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { createDirtyConfirmQueue } from "./dirty-confirm"
import type { AssetKind, AssetOrigin } from "@/components/chat/asset-workbench"

export type ChatWorkspaceState = {
  kindFilter: AssetKind
  search: string
  selectedPath: string | undefined
  originFilter: AssetOrigin | "all"
}

type DirtyEntry = {
  /**
   * Evaluated at decision time, never cached: the close/leave decision must see the
   * composer as it is when the user acts, not the value an effect had flushed earlier.
   */
  isDirty: () => boolean
  token: symbol
}

type RouteIdentity = {
  key: string
  token: symbol
}

export type ChatWorkspaceContext = {
  state: ChatWorkspaceState
  setKindFilter: (kind: AssetKind) => void
  setSearch: (value: string) => void
  setOriginFilter: (origin: AssetOrigin | "all") => void
  select: (path: string | undefined) => void
  dirty: {
    register: (key: string, isDirty: () => boolean, token: symbol) => void
    has: (key: string) => boolean
    clear: (key: string, token?: symbol) => void
    confirmLeave: (key: string) => Promise<boolean>
  }
  /**
   * The top-level tab the mounted route owns, keyed by `tabKey`. Registered from the
   * route alone (never gated on data hydration) and cleared only by the registering
   * owner, so closing or leaving the routed tab never degrades to a background close.
   */
  route: {
    activeTabKey: () => string | undefined
    setActiveTabKey: (key: string, token: symbol) => void
    clearActiveTabKey: (key: string, token: symbol) => void
  }
}

const Ctx = createContext<ChatWorkspaceContext>()

export function ChatWorkspaceProvider(props: ParentProps) {
  const dialog = useDialog()
  const language = useLanguage()
  const [state, setState] = createStore<ChatWorkspaceState>({
    kindFilter: "all",
    search: "",
    selectedPath: undefined,
    originFilter: "all",
  })
  const dirty = new Map<string, DirtyEntry>()
  let activeTab: RouteIdentity | undefined

  const presentDirtyConfirmation = (key: string) =>
    new Promise<boolean>((resolve) => {
      let chosen = false
      // One settlement per presented dialog: Stay/Leave, Escape, overlay, a replacing
      // dialog, and provider unmount all funnel through here.
      const finish = (value: boolean) => {
        if (chosen) return
        chosen = true
        if (value) dirty.delete(key)
        dialog.close()
        resolve(value)
      }
      void dialog.show(
        () => (
          <Dialog
            title={language.t("chat.dirtyDraft.title")}
            description={language.t("chat.dirtyDraft.description")}
            fit
          >
            <div class="flex justify-end gap-2 p-2">
              <ButtonV2 variant="neutral" onClick={() => finish(false)}>
                {language.t("chat.dirtyDraft.stay")}
              </ButtonV2>
              <ButtonV2 variant="contrast" onClick={() => finish(true)}>
                {language.t("chat.dirtyDraft.leave")}
              </ButtonV2>
            </div>
          </Dialog>
        ),
        () => finish(false),
      )
    })

  const confirmations = createDirtyConfirmQueue(presentDirtyConfirmation)

  const ctx: ChatWorkspaceContext = {
    state,
    setKindFilter: (kind) => setState("kindFilter", kind),
    setSearch: (value) => setState("search", value),
    setOriginFilter: (origin) => setState("originFilter", origin),
    select: (path) => setState("selectedPath", path),
    dirty: {
      register: (key, isDirty, token) => dirty.set(key, { isDirty, token }),
      // Untracked on purpose: callers are event handlers (close, route leave), and a
      // tracked read here would make unrelated reactive scopes depend on the composer.
      has: (key) => untrack(() => dirty.get(key)?.isDirty() ?? false),
      clear: (key, token) => {
        const current = dirty.get(key)
        if (!current) return
        if (token && current.token !== token) return
        dirty.delete(key)
      },
      confirmLeave: (key) => (ctx.dirty.has(key) ? confirmations.confirm(key) : Promise.resolve(true)),
    },
    route: {
      activeTabKey: () => activeTab?.key,
      setActiveTabKey: (key, token) => {
        activeTab = { key, token }
      },
      clearActiveTabKey: (key, token) => {
        if (activeTab?.key !== key || activeTab.token !== token) return
        activeTab = undefined
      },
    },
  }

  onCleanup(() => confirmations.dispose())

  return <Ctx.Provider value={ctx}>{props.children}</Ctx.Provider>
}

export function useChatWorkspace(): ChatWorkspaceContext | undefined {
  return useContext(Ctx)
}

export function DirtyDraftGuard() {
  const workspace = useChatWorkspace()

  useBeforeLeave((event) => {
    if (event.defaultPrevented) return
    if (!workspace) return
    const key = workspace.route.activeTabKey()
    if (!key || !workspace.dirty.has(key)) return
    event.preventDefault()
    void workspace.dirty.confirmLeave(key).then((leave) => {
      if (leave) event.retry(true)
    })
  })

  return null
}
