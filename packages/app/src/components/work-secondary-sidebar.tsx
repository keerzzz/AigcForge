import { createEffect, createMemo, Show, For, type Accessor } from "solid-js"
import { useParams } from "@solidjs/router"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { TabsV2 } from "@aigcfroge/ui/v2/tabs-v2"
import { useLanguage } from "@/context/language"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { ModeLocationNewSession } from "@/components/mode-location-new-session"
import { isMode, modeDefinition } from "@/context/mode"
import { ServerConnection } from "@/context/server"
import { useServerSync } from "@/context/server-sync"
import { useWorkSecondaryTab } from "@/context/work-secondary-tab"
import { computeWorkSidebarGroups } from "@/pages/work-sidebar-groups"
import { SessionItem, SessionSkeleton } from "@/pages/layout/sidebar-items"
import { sortedRootSessions } from "@/pages/layout/helpers"
import type { WorkspaceSidebarContext } from "@/pages/layout/sidebar-workspace"

/** Work session sidebar with category tabs and mode-scoped Sessions. */
export function WorkSecondarySidebar(props: {
  directory: Accessor<string>
  sortNow: Accessor<number>
  ctx: WorkspaceSidebarContext
  serverKey?: ServerConnection.Key
}) {
  const language = useLanguage()
  const sync = useServerSync()
  const params = useParams()
  const { selected: tab, set: setTab } = useWorkSecondaryTab()

  const store = createMemo(() => {
    const directory = props.directory()
    if (!directory) return undefined
    return sync().child(directory, { bootstrap: false })[0]
  })

  // The shell cannot use the directory SDK context, so read Session mode from
  // the server-scoped child store keyed by the routed Session ID.
  const sessionMode = createMemo(() => {
    if (!params.id) return undefined
    const current = store()
    if (!current) return undefined
    return current.session.find((item) => item.id === params.id)?.mode
  })

  const modeLabel = createMemo(() => {
    const m = sessionMode()
    return m && isMode(m) ? language.t(modeDefinition(m).labelKey) : language.t("mode.coding")
  })

  const sessions = createMemo(() => {
    const current = store()
    if (!current) return []
    return sortedRootSessions(current, props.sortNow()).filter((session) => (session.mode ?? "coding") === "work")
  })

  const groups = createMemo(() => computeWorkSidebarGroups(sessions()))

  createEffect(() => {
    const directory = props.directory()
    if (!directory) return
    void sync().project.loadSessions(directory, { mode: "work" })
  })

  const switchTab = (value: string | number) => {
    if (value === "trade" || value === "taskSet" || value === "agent") setTab(value)
  }

  return (
    <div class="flex min-h-0 flex-1 flex-col" data-component="work-secondary-sidebar">
      <ModeLocationNewSession directory={props.directory} mode="work" />
      <Show when={sessionMode() !== undefined && sessionMode() !== "work"}>
        <div
          data-component="work-sidebar-mode-mismatch"
          class="border-b border-v2-border-border-base bg-v2-background-bg-layer-02 px-3 py-1.5 text-v2-text-text-muted text-11-regular"
        >
          {language.t("work.sidebar.modeMismatch", { mode: modeLabel() })}
        </div>
      </Show>
      <TabsV2 value={tab()} onChange={switchTab}>
        <TabsV2.List
          class="shrink-0 gap-0 border-b border-v2-border-border-base px-2 pt-1"
          aria-label={language.t("work.sidebar.tab.trade")}
        >
          <TabsV2.Trigger value="trade">
            <span>{language.t("work.sidebar.tab.trade")}</span>
            <span class="min-w-[2ch] text-v2-text-text-faint text-11-regular">{sessions().length}</span>
          </TabsV2.Trigger>
          <TabsV2.Trigger value="taskSet">{language.t("work.sidebar.tab.taskSet")}</TabsV2.Trigger>
          <TabsV2.Trigger value="agent">{language.t("work.sidebar.tab.agent")}</TabsV2.Trigger>
        </TabsV2.List>
      </TabsV2>
      <div class="min-h-0 flex-1 overflow-y-auto px-2">
        <Show when={tab() === "trade"}>
          <Show when={store()?.status !== "loading"} fallback={<SessionSkeleton />}>
            <Show
              when={sessions().length > 0}
              fallback={
                <div class="flex flex-col items-center gap-2 px-4 py-10 text-center">
                  <p class="text-v2-text-text-muted text-12-regular">{language.t("work.sidebar.empty")}</p>
                </div>
              }
            >
              <For each={groups()}>
                {(group) => (
                  <div class="flex min-w-0 flex-col gap-px">
                    <div class="flex items-baseline gap-1.5 px-1 pb-1 pt-2">
                      <span class="text-v2-text-text-muted text-11-regular [font-weight:440]">
                        {language.t(group.labelKey)}
                      </span>
                      <span class="min-w-[2ch] text-v2-text-text-faint text-11-regular">{group.sessions.length}</span>
                    </div>
                    <For each={group.sessions}>
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
                )}
              </For>
            </Show>
          </Show>
        </Show>
        <Show when={tab() === "taskSet"}>
          <div class="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <Icon name="mode-work" size="small" class="text-v2-icon-icon-muted opacity-40" />
            <p class="text-v2-text-text-muted text-12-regular">{language.t("work.sidebar.taskSet.empty")}</p>
          </div>
        </Show>
        <Show when={tab() === "agent"}>
          <div class="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <Icon name="mode-work" size="small" class="text-v2-icon-icon-muted opacity-40" />
            <p class="text-v2-text-text-muted text-12-regular">{language.t("work.sidebar.agent.empty")}</p>
          </div>
        </Show>
      </div>
    </div>
  )
}
