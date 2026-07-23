import { For, Show, createEffect, createMemo } from "solid-js"
import type { Accessor } from "solid-js"
import { SessionItem } from "@/pages/layout/sidebar-items"
import type { WorkspaceSidebarContext } from "@/pages/layout/sidebar-workspace"
import { sortedRootSessions } from "@/pages/layout/helpers"
import { useServerSync } from "@/context/server-sync"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { useLanguage } from "@/context/language"
import type { ServerConnection } from "@/context/server"

/** Chat 对话列表：加载并展示当前 Location 的根 chat Sessions。 */
export function ChatSessionList(props: {
  directory: Accessor<string>
  sortNow: Accessor<number>
  ctx: WorkspaceSidebarContext
  serverKey?: ServerConnection.Key
}) {
  const language = useLanguage()
  const sync = useServerSync()
  const store = createMemo(() => {
    const directory = props.directory()
    if (!directory) return
    return sync().child(directory, { bootstrap: false })[0]
  })
  const sessions = createMemo(() => {
    const current = store()
    if (!current) return []
    return sortedRootSessions(current, props.sortNow()).filter((session) => (session.mode ?? "coding") === "chat")
  })

  createEffect(() => {
    const directory = props.directory()
    if (!directory) return
    void sync().project.loadSessions(directory, { mode: "chat" })
  })

  return (
    <div class="flex min-h-0 flex-1 flex-col border-t border-v2-border-border-base">
      <div class="px-3 pb-1 pt-2 text-v2-text-text-muted text-11-regular [font-weight:440]">
        {language.t("sidebar.secondary.projectList")}
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-2">
        <Show
          when={sessions().length > 0}
          fallback={
            <div class="py-4 text-center text-v2-text-text-muted text-12-regular">
              {language.t("sidebar.secondary.noResults")}
            </div>
          }
        >
          <For each={sessions()}>
            {(session) => (
              <SessionItem
                session={session}
                list={sessions()}
                navList={props.ctx.navList}
                slug={base64Encode(props.directory())}
                serverKey={props.serverKey}
                sidebarExpanded={props.ctx.sidebarExpanded}
                clearHoverProjectSoon={props.ctx.clearHoverProjectSoon}
                prefetchSession={props.ctx.prefetchSession}
                archiveSession={props.ctx.archiveSession}
              />
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}
