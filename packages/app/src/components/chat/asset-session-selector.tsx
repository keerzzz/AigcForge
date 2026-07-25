import { For, Show, createEffect, createMemo } from "solid-js"
import type { Session } from "@aigcfroge/sdk/v2/client"
import { useNavigate } from "@solidjs/router"
import { Dialog } from "@aigcfroge/ui/v2/dialog-v2"
import { useDialog } from "@aigcfroge/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import { ServerConnection } from "@/context/server"
import { useChatDirectory } from "@/components/mode-surfaces"
import { sortedRootSessions } from "@/pages/layout/helpers"
import { sessionHref } from "@/utils/session-route"
import type { AssetRow } from "./asset-workbench"

/**
 * Insert 流程会话选择器：选一个 chat 会话，将资产行的 template 注入其 Composer（PRD §9.6）。
 * 经 dialog.show 渲染（继承调用方 owner，可用 useServerSync/useNavigate/useChatDirectory）。
 * 选中后 navigate /server/:key/session/:id?insert=<relativePath>，session.tsx 检测 ?insert= 注入。
 */
export function AssetSessionSelector(props: { asset: AssetRow }) {
  const language = useLanguage()
  const dialog = useDialog()
  const navigate = useNavigate()
  const sync = useServerSync()
  const { conn, directory } = useChatDirectory()

  const serverKey = createMemo(() => {
    const current = conn()
    return current ? ServerConnection.key(current) : undefined
  })

  // bootstrap 当前 Location 的 chat 会话（与 ChatSessionList 同源）
  createEffect(() => {
    const dir = directory()
    if (!dir) return
    void sync().project.loadSessions(dir, { mode: "chat" })
  })

  const sessions = createMemo(() => {
    const dir = directory()
    if (!dir) return [] as Session[]
    const store = sync().child(dir, { bootstrap: false })[0]
    return sortedRootSessions(store, Date.now()).filter((session) => (session.mode ?? "coding") === "chat")
  })

  function insertInto(session: Session) {
    const key = serverKey()
    if (!key) return
    navigate(`${sessionHref(key, session.id)}?insert=${encodeURIComponent(props.asset.relativePath)}`)
    dialog.close()
  }

  return (
    <Dialog title={language.t("promptAsset.insert.title")} description={language.t("promptAsset.insert.description")} fit>
      <div class="flex min-h-0 flex-col gap-px p-2" style={{ "max-height": "60vh" }}>
        <Show
          when={sessions().length > 0}
          fallback={
            <p class="px-3 py-6 text-center text-v2-text-text-muted text-12-regular">
              {language.t("promptAsset.insert.noSessions")}
            </p>
          }
        >
          <For each={sessions()}>
            {(session) => (
              <button
                type="button"
                class="flex items-center gap-2 rounded-[6px] px-3 py-2 text-left text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
                onClick={() => insertInto(session)}
              >
                <span class="min-w-0 flex-1 truncate text-13-regular">{session.title || session.id}</span>
              </button>
            )}
          </For>
        </Show>
      </div>
    </Dialog>
  )
}
