import { createMemo, For, Show, type Accessor } from "solid-js"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { useLanguage } from "@/context/language"
import { ModeLocationNewSession } from "@/components/mode-location-new-session"
import { useServerSync } from "@/context/server-sync"
import { sortedRootSessions } from "@/pages/layout/helpers"
import { SessionItem, SessionSkeleton } from "@/pages/layout/sidebar-items"
import { AssistantNavTree } from "@/components/assistant-nav-tree"
import { openEntityPanel } from "@/pages/session/assistant-session-panel-open"
import { useSessionLayout } from "@/pages/session/session-layout"
import type { WorkspaceSidebarContext } from "@/pages/layout/sidebar-workspace"
import type { ServerConnection } from "@/context/server"
import type { AssistantNavSelection } from "@/components/assistant-nav-model"

/**
 * Assistant 会话详情页次级左栏（批次 2 G3，PRD §8.2）：Location + 新建 +
 * mode=assistant 会话列表 + 实体导航树。导航树选中态 ↔ 右栏面板状态
 * （openEntityPanel 开对应 Tab 并定位；面板 Tab/目标变化 → 树高亮同步）。
 */
export function AssistantSessionSidebar(props: {
  directory: Accessor<string>
  sortNow: Accessor<number>
  ctx: WorkspaceSidebarContext
  serverKey?: ServerConnection.Key
}) {
  const language = useLanguage()
  const sync = useServerSync()
  const { assistant } = useSessionLayout()

  const store = createMemo(() => {
    const directory = props.directory()
    if (!directory) return undefined
    return sync().child(directory, { bootstrap: false })[0]
  })

  const sessions = createMemo(() => {
    const current = store()
    if (!current) return []
    return sortedRootSessions(current, props.sortNow()).filter((session) => (session.mode ?? "coding") === "assistant")
  })

  // 树选中态 ↔ 右栏面板状态：Tab → kind，target → itemId；context/editor 无实体。
  const selected = createMemo<AssistantNavSelection>(() => {
    const tab = assistant().tab()
    const target = assistant().target()
    if (tab === "reminders" || tab === "memory" || tab === "kb") {
      return target ? { kind: tab, itemId: target } : { kind: tab }
    }
    if (tab === "context") return undefined
    return undefined
  })

  const onSelect = (next: AssistantNavSelection) => {
    const handle = assistant()
    if (!next) {
      handle.close()
      return
    }
    if (next.kind === "reminders" || next.kind === "memory" || next.kind === "kb") {
      openEntityPanel(handle, next.kind, next.itemId)
      return
    }
    openEntityPanel(handle, "kb")
  }

  return (
    <div class="flex min-h-0 flex-1 flex-col" data-component="assistant-session-sidebar">
      <ModeLocationNewSession directory={props.directory} mode="assistant" />
      <div class="px-3 pb-1 pt-2 text-v2-text-text-muted text-11-regular [font-weight:440]">
        {language.t("assistant.nav.sessions")}
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-2">
        <Show when={store()?.status !== "loading"} fallback={<SessionSkeleton />}>
          <Show
            when={sessions().length > 0}
            fallback={
              <p class="px-1 py-2 text-v2-text-text-muted text-12-regular">{language.t("assistant.nav.sessionsEmpty")}</p>
            }
          >
            <div class="flex min-w-0 flex-col gap-px">
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
            </div>
          </Show>
        </Show>
      </div>
      {/* 树独立滚动 + 高度上限（MEDIUM-1 修正）：知识库笔记多时树不溢出 aside、
          也不把会话列表压缩到 0。 */}
      <div
        class="min-h-0 shrink-0 overflow-y-auto border-t border-v2-border-border-base py-1"
        style={{ "max-height": "45%" }}
      >
        <AssistantNavTree selected={selected()} onSelect={onSelect} />
      </div>
    </div>
  )
}
